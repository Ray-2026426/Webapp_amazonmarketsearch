import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { updateProject } from '../utils/projectStore';
import type { ResearchProject } from '../types/researchProject';

const MARKETPLACES = [
  { code: 'US', label: 'US · 美国' },
  { code: 'UK', label: 'UK · 英国' },
  { code: 'DE', label: 'DE · 德国' },
  { code: 'FR', label: 'FR · 法国' },
  { code: 'IT', label: 'IT · 意大利' },
  { code: 'ES', label: 'ES · 西班牙' },
  { code: 'CA', label: 'CA · 加拿大' },
  { code: 'JP', label: 'JP · 日本' },
  { code: 'AU', label: 'AU · 澳大利亚' },
  { code: 'MX', label: 'MX · 墨西哥' },
  { code: 'IN', label: 'IN · 印度' },
  { code: 'BR', label: 'BR · 巴西' },
];

const OBJECTIVES = ['新品开发', '市场进入', '存量优化', '产品迭代', '竞品突破', '利润验证'];
function splitList(s: string): string[] | undefined {
  const list = s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

export function EditProjectModal({
  userId,
  project,
  onClose,
  onSaved,
}: {
  userId: string;
  project: ResearchProject;
  onClose: () => void;
  onSaved: (updated: ResearchProject) => void;
}) {
  const [name, setName] = useState(project.name);
  const [marketplace, setMarketplace] = useState(project.marketplace);
  const [objective, setObjective] = useState(project.objective || '新品开发');
  const [description, setDescription] = useState(project.description ?? '');
  const [coreKeywords, setCoreKeywords] = useState((project.coreKeywords ?? []).join(', '));
  const [seedAsins, setSeedAsins] = useState((project.seedAsins ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  const canSave = name.trim().length > 0 && marketplace.trim().length > 0 && objective.trim().length > 0;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await updateProject(userId, project.id, {
        name: name.trim(),
        marketplace: marketplace.trim(),
        objective: objective.trim(),
        description: description.trim() || undefined,
        coreKeywords: splitList(coreKeywords),
        seedAsins: splitList(seedAsins),
      });
      if (updated) {
        onSaved(updated);
      } else {
        toast.error('保存失败');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-[32px] shadow-[0_12px_40px_rgba(15,23,42,0.14)] border border-black/8 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-7 pt-6">
          <div>
            <h3 className="text-xl font-bold text-[#1d1d1f]">编辑项目</h3>
            <p className="text-sm text-[#86868b] mt-0.5">修改后保存</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-7 py-5 space-y-4">
          <Field label="项目名称" required>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="站点" required>
              <PresetDropdownInput
                value={marketplace}
                placeholder="选择或输入站点"
                open={marketplaceOpen}
                onOpenChange={setMarketplaceOpen}
                onChange={setMarketplace}
                items={MARKETPLACES.map((m) => ({ value: m.code, label: m.label }))}
              />
            </Field>
            <Field label="研究目标" required>
              <PresetDropdownInput
                value={objective}
                placeholder="选择或输入研究目标"
                open={objectiveOpen}
                onOpenChange={setObjectiveOpen}
                onChange={setObjective}
                items={OBJECTIVES.map((o) => ({ value: o, label: o }))}
              />
            </Field>
          </div>
          <Field label="核心关键词（逗号分隔）">
            <input value={coreKeywords} onChange={(e) => setCoreKeywords(e.target.value)} className={inputCls} />
          </Field>
          <Field label="对标 ASIN（逗号分隔）">
            <input value={seedAsins} onChange={(e) => setSeedAsins(e.target.value)} className={inputCls} />
          </Field>
          <Field label="项目说明">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(inputCls, 'resize-none')} />
          </Field>
        </div>

        <div className="px-7 pb-7 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-black/8 text-sm font-medium text-[#424245] hover:bg-[#f5f5f7] transition-all">取消</button>
          <button type="button" disabled={!canSave || saving} onClick={submit} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold hover:from-indigo-600 hover:to-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#424245] mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function PresetDropdownInput({
  items,
  value,
  placeholder,
  open,
  onOpenChange,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  placeholder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const visibleItems = items.filter((item) => {
    const kw = value.trim().toLowerCase();
    if (!kw) return true;
    return item.value.toLowerCase().includes(kw) || item.label.toLowerCase().includes(kw);
  });
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onOpenChange(true);
        }}
        onFocus={() => onOpenChange(true)}
        onBlur={() => window.setTimeout(() => onOpenChange(false), 120)}
        className={inputCls}
        placeholder={placeholder}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-black/8 bg-white shadow-xl p-1">
          {visibleItems.length ? (
            visibleItems.map((item) => (
              <button
                key={item.value}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(item.value);
                  onOpenChange(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-all',
                  value === item.value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-[#424245] hover:bg-[#f5f5f7]'
                )}
              >
                {item.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-[#86868b]">按当前输入作为自定义值保存</div>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';
