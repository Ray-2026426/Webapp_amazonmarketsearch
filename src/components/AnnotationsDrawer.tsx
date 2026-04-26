import React, { useMemo, useState } from 'react';
import { MapPin, Pencil, Trash2, X } from 'lucide-react';
import type { AnchorAnnotation, AnnotationView } from '../utils/anchorAnnotations';
import { getAnchorDisplayName, getViewTabLabel } from '../utils/anchorAnnotations';

type Props = {
  open: boolean;
  onClose: () => void;
  annotations: AnchorAnnotation[];
  onChange: (next: AnchorAnnotation[]) => void;
  /** 切换到对应 Tab 并滚动到锚点 */
  onJumpTo: (a: AnchorAnnotation) => void;
};

/** 右侧抽屉：全部批注列表、定位、编辑、删除 */
export function AnnotationsDrawer({ open, onClose, annotations, onChange, onJumpTo }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const sorted = useMemo(
    () => [...annotations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [annotations]
  );

  const byView = useMemo(() => {
    const order: AnnotationView[] = ['market', 'insights', 'keywords', 'profit'];
    const m = new Map<AnnotationView, AnchorAnnotation[]>();
    for (const v of order) m.set(v, []);
    for (const a of sorted) {
      const list = m.get(a.view);
      if (list) list.push(a);
    }
    return order.map((v) => ({ view: v, items: m.get(v)! }));
  }, [sorted]);

  const startEdit = (a: AnchorAnnotation) => {
    setEditingId(a.id);
    setEditText(a.text);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const t = editText.trim();
    if (!t) return;
    onChange(annotations.map((x) => (x.id === editingId ? { ...x, text: t } : x)));
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const remove = (id: string) => {
    onChange(annotations.filter((x) => x.id !== id));
    if (editingId === id) cancelEdit();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex justify-end" role="dialog" aria-modal="true" aria-label="全部批注">
      <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-label="关闭遮罩" />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-black/10 bg-white shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">全部批注</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-[#86868b] hover:bg-[#f5f5f7]" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {annotations.length === 0 ? (
            <p className="py-12 text-center text-sm text-[#86868b]">暂无批注</p>
          ) : (
            <div className="space-y-6">
              {byView.map(({ view, items }) =>
                items.length === 0 ? null : (
                  <div key={view}>
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">{getViewTabLabel(view)}</div>
                    <ul className="space-y-3">
                      {items.map((a) => (
                        <li key={a.id} className="rounded-2xl border border-black/5 bg-[#f5f5f7]/80 p-3">
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[#86868b]">
                            <span className="font-medium text-[#1d1d1f]">{getAnchorDisplayName(a.anchorId)}</span>
                            <span>·</span>
                            <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time>
                          </div>
                          {editingId === a.id ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={4}
                                className="w-full resize-none rounded-xl border border-black/10 bg-white p-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                              />
                              <div className="flex justify-end gap-2">
                                <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-[#86868b] hover:bg-white" onClick={cancelEdit}>
                                  取消
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                                  onClick={saveEdit}
                                >
                                  保存
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#1d1d1f]">{a.text}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => onJumpTo(a)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7]"
                                >
                                  <MapPin className="h-3.5 w-3.5 text-indigo-600" />
                                  定位
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startEdit(a)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7]"
                                >
                                  <Pencil className="h-3.5 w-3.5 text-indigo-600" />
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => remove(a.id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  删除
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
