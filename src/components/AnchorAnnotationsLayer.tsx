import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, MessageCircle, Plus, Trash2, X } from 'lucide-react';
import type { AnchorAnnotation, AnnotationView } from '../utils/anchorAnnotations';
import {
  ANNOTATION_PIN_PASS_THROUGH_CLASS,
  createAnchorAnnotationId,
  resolveAnchorFromEvent,
} from '../utils/anchorAnnotations';
import { AnnotationsDrawer } from './AnnotationsDrawer';

type Props = {
  scrollRootRef: React.RefObject<HTMLElement | null>;
  scrollLayoutKey: boolean;
  activeView: AnnotationView;
  annotations: AnchorAnnotation[];
  onChange: (next: AnchorAnnotation[]) => void;
  annotateMode: boolean;
  onAnnotateModeChange: (v: boolean) => void;
  /** 侧栏「定位」：切换 Tab 并滚动到锚点 */
  onJumpToAnnotation: (a: AnchorAnnotation) => void;
};

function computePinViewportPositions(
  list: AnchorAnnotation[],
  activeView: AnnotationView
): Record<string, { left: number; top: number; ok: boolean }> {
  const map: Record<string, { left: number; top: number; ok: boolean }> = {};
  for (const a of list) {
    if (a.view !== activeView) continue;
    const sel = `[data-annotate-anchor="${CSS.escape(a.anchorId)}"]`;
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) {
      map[a.id] = { left: 0, top: 0, ok: false };
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) {
      map[a.id] = { left: 0, top: 0, ok: false };
      continue;
    }
    map[a.id] = {
      left: r.left + a.u * r.width,
      top: r.top + a.v * r.height,
      ok: true,
    };
  }
  return map;
}

export function AnchorAnnotationsLayer({
  scrollRootRef,
  scrollLayoutKey,
  activeView,
  annotations,
  onChange,
  annotateMode,
  onAnnotateModeChange,
  onJumpToAnnotation,
}: Props) {
  const [layoutTick, setLayoutTick] = useState(0);
  const [draft, setDraft] = useState<{
    anchorId: string;
    u: number;
    v: number;
    x: number;
    y: number;
  } | null>(null);
  const [draftText, setDraftText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragVisual, setDragVisual] = useState<{
    id: string;
    grabDx: number;
    grabDy: number;
    x: number;
    y: number;
  } | null>(null);

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  /** 指针在图标上按下后的拖拽会话（用 ref 避免阈值判断与 state 不同步） */
  const pinDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    grabDx: number;
    grabDy: number;
    dragging: boolean;
  } | null>(null);

  const bumpLayout = useCallback(() => {
    setLayoutTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;
    const onScroll = () => bumpLayout();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', bumpLayout);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => bumpLayout()) : null;
    if (ro) ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', bumpLayout);
      if (ro) ro.disconnect();
    };
  }, [scrollRootRef, bumpLayout, scrollLayoutKey]);

  useEffect(() => {
    const id = requestAnimationFrame(() => bumpLayout());
    return () => cancelAnimationFrame(id);
  }, [activeView, annotations, bumpLayout, scrollLayoutKey]);

  const positions = useMemo(
    () => computePinViewportPositions(annotations, activeView),
    [annotations, activeView, layoutTick]
  );

  const onScrollCaptureClick = useCallback(
    (e: React.MouseEvent<HTMLElement> | MouseEvent) => {
      if (!annotateMode) return;
      const root = scrollRootRef.current;
      if (!root) return;
      const t = e.target as Element | null;
      if (t?.closest('[data-annotation-pin]')) return;
      if (t?.closest('[data-annotation-draft]')) return;
      const resolved = resolveAnchorFromEvent(root, t, e.clientX, e.clientY);
      if (!resolved) return;
      e.preventDefault();
      e.stopPropagation();
      setDraft({
        anchorId: resolved.anchorId,
        u: resolved.u,
        v: resolved.v,
        x: e.clientX,
        y: e.clientY,
      });
      setDraftText('');
    },
    [annotateMode, scrollRootRef]
  );

  useAnnotateScrollCapture(scrollRootRef, annotateMode && scrollLayoutKey, onScrollCaptureClick);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const text = draftText.trim();
    if (!text) {
      setDraft(null);
      return;
    }
    const next: AnchorAnnotation = {
      id: createAnchorAnnotationId(),
      view: activeView,
      anchorId: draft.anchorId,
      u: draft.u,
      v: draft.v,
      text,
      createdAt: new Date().toISOString(),
    };
    onChange([...annotationsRef.current, next]);
    setDraft(null);
    setDraftText('');
  }, [draft, draftText, activeView, onChange]);

  const removeOne = useCallback(
    (id: string) => {
      onChange(annotationsRef.current.filter((a) => a.id !== id));
      setOpenId(null);
    },
    [onChange]
  );

  const handlePinPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, a: AnchorAnnotation, pos: { left: number; top: number }) => {
      e.stopPropagation();
      const pinLeft = pos.left - 10;
      const pinTop = pos.top - 10;
      const grabDx = e.clientX - pinLeft;
      const grabDy = e.clientY - pinTop;
      pinDragRef.current = {
        id: a.id,
        startX: e.clientX,
        startY: e.clientY,
        grabDx,
        grabDy,
        dragging: false,
      };

      const pid = e.pointerId;
      /** 在 document 捕获阶段监听，指针移到图表/滚动区外仍能收到 move（不依赖 setPointerCapture） */
      const capMove: AddEventListenerOptions = { capture: true, passive: false };
      const capEnd: AddEventListenerOptions = { capture: true, passive: true };
      let finished = false;

      const teardown = () => {
        if (finished) return;
        finished = true;
        document.removeEventListener('pointermove', move, capMove);
        document.removeEventListener('pointerup', end, capEnd);
        document.removeEventListener('pointercancel', end, capEnd);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        const s = pinDragRef.current;
        if (!s || s.id !== a.id) return;
        const dx = ev.clientX - s.startX;
        const dy = ev.clientY - s.startY;
        if (!s.dragging && dx * dx + dy * dy > 36) {
          s.dragging = true;
          setOpenId(null);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'grabbing';
        }
        if (s.dragging) {
          ev.preventDefault();
          setDragVisual({ id: a.id, grabDx: s.grabDx, grabDy: s.grabDy, x: ev.clientX, y: ev.clientY });
        }
      };

      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        teardown();
        const s = pinDragRef.current;
        pinDragRef.current = null;
        if (!s || s.id !== a.id) return;

        if (s.dragging) {
          setDragVisual(null);
          const root = scrollRootRef.current;
          if (!root) return;
          document.body.classList.add(ANNOTATION_PIN_PASS_THROUGH_CLASS);
          let top: Element | null = null;
          try {
            top = document.elementFromPoint(ev.clientX, ev.clientY);
          } finally {
            document.body.classList.remove(ANNOTATION_PIN_PASS_THROUGH_CLASS);
          }
          if (!top || !root.contains(top)) return;
          const resolved = resolveAnchorFromEvent(root, top, ev.clientX, ev.clientY);
          if (!resolved) return;
          const cur = annotationsRef.current;
          onChange(cur.map((ann) => (ann.id === a.id ? { ...ann, ...resolved } : ann)));
        } else {
          setOpenId((cur) => (cur === a.id ? null : a.id));
        }
      };

      document.addEventListener('pointermove', move, capMove);
      document.addEventListener('pointerup', end, capEnd);
      document.addEventListener('pointercancel', end, capEnd);
    },
    [scrollRootRef, onChange]
  );

  const draftStyle: React.CSSProperties | undefined = draft
    ? {
        position: 'fixed',
        left: Math.min(window.innerWidth - 280, Math.max(8, draft.x - 140)),
        top: Math.min(window.innerHeight - 200, Math.max(8, draft.y + 12)),
        zIndex: 45,
      }
    : undefined;

  const list = annotations.filter((a) => a.view === activeView);

  return (
    <>
      <AnnotationsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        annotations={annotations}
        onChange={onChange}
        onJumpTo={(a) => {
          onJumpToAnnotation(a);
        }}
      />

      {annotateMode && (
        <div
          className="pointer-events-none fixed inset-0 z-[35] border-2 border-dashed border-amber-400/40 bg-amber-400/5"
          aria-hidden
        />
      )}

      {list.map((a) => {
        const pos = positions[a.id];
        if (!pos?.ok) return null;
        const expanded = openId === a.id;
        const dragging = dragVisual?.id === a.id;
        const leftPx = dragging ? dragVisual!.x - dragVisual!.grabDx : pos.left - 10;
        const topPx = dragging ? dragVisual!.y - dragVisual!.grabDy : pos.top - 10;
        return (
          <div
            key={a.id}
            data-annotation-pin="1"
            className={`fixed z-[40] flex flex-col items-start ${dragging ? 'z-[46]' : ''}`}
            style={{ left: leftPx, top: topPx }}
          >
            <button
              type="button"
              title="点击查看；按住略拖动可移动位置"
              onPointerDown={(e) => handlePinPointerDown(e, a, pos)}
              className="pointer-events-auto flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-md hover:bg-amber-100 active:cursor-grabbing"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </button>
            {expanded && (
              <div className="pointer-events-auto mt-1 max-w-xs rounded-xl border border-black/10 bg-white p-3 text-xs text-[#1d1d1f] shadow-xl">
                <p className="whitespace-pre-wrap leading-relaxed">{a.text}</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-[11px] text-[#86868b] hover:bg-[#f5f5f7]"
                    onClick={() => setOpenId(null)}
                  >
                    关闭
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-100"
                    onClick={() => removeOne(a.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {draft && (
        <div data-annotation-draft="1" className="rounded-2xl border border-black/10 bg-white p-3 shadow-2xl" style={draftStyle}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-amber-700">新批注（锚点：{draft.anchorId}）</span>
            <button type="button" className="rounded-lg p-1 text-[#86868b] hover:bg-[#f5f5f7]" onClick={() => setDraft(null)} aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={4}
            className="mb-2 w-64 resize-none rounded-xl border border-black/10 p-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            placeholder="输入批注内容…"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-xl px-3 py-1.5 text-xs text-[#86868b] hover:bg-[#f5f5f7]" onClick={() => setDraft(null)}>
              取消
            </button>
            <button type="button" className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700" onClick={saveDraft}>
              完成
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-6 right-6 z-[44] flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => {
            setDrawerOpen(true);
            setDraft(null);
            setOpenId(null);
          }}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#1d1d1f] shadow-lg hover:bg-[#f5f5f7]"
        >
          <List className="h-4 w-4 text-indigo-600" />
          全部批注
        </button>
        <button
          type="button"
          onClick={() => {
            onAnnotateModeChange(!annotateMode);
            setDraft(null);
            setOpenId(null);
          }}
          className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg transition-colors ${
            annotateMode ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-white text-[#1d1d1f] border border-black/10 hover:bg-[#f5f5f7]'
          }`}
        >
          {annotateMode ? (
            <>
              <X className="h-4 w-4" />
              退出批注
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              添加批注
            </>
          )}
        </button>
        {annotateMode && (
          <p className="pointer-events-none max-w-[220px] rounded-xl bg-black/75 px-3 py-2 text-[11px] leading-snug text-white shadow-md">
            在下方主内容区点击任意位置；按住批注图标略拖动可移动并重新贴附模块。
          </p>
        )}
      </div>
    </>
  );
}

function useAnnotateScrollCapture(
  scrollRootRef: React.RefObject<HTMLElement | null>,
  annotateMode: boolean,
  onCaptureClick: (e: React.MouseEvent<HTMLElement> | MouseEvent) => void
) {
  const handlerRef = useRef(onCaptureClick);
  handlerRef.current = onCaptureClick;
  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el || !annotateMode) return;
    const fn = (ev: MouseEvent) => {
      handlerRef.current(ev);
    };
    el.addEventListener('click', fn, true);
    return () => el.removeEventListener('click', fn, true);
  }, [scrollRootRef, annotateMode]);
}
