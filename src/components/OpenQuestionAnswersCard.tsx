import { HelpCircle, CheckCircle2 } from 'lucide-react';
import { Card } from './ui/Card';
import {
  alignOpenQuestionAnswers,
  countAnswered,
  describeOpenQuestionProgress,
  type OpenQuestionAnswer,
} from '../utils/openQuestions';

/**
 * M2⑤ · 修断链 #7：把「看市场」留下的待验证问题带到下游那一看，并允许就地回答。
 * 回答存在**当前这一看**的数据里（谁验证、谁负责写结论）。
 */
export function OpenQuestionAnswersCard({
  questions,
  answers,
  onChange,
  hint,
  inputCls,
}: {
  questions: string[];
  answers: OpenQuestionAnswer[] | undefined;
  onChange: (next: OpenQuestionAnswer[]) => void;
  /** 例如：这些问题来自「看市场」，请在此给出验证结论 */
  hint: string;
  inputCls: string;
}) {
  const rows = alignOpenQuestionAnswers(questions, answers);
  if (rows.length === 0) return null;
  const answered = countAnswered(rows);

  const setAnswer = (index: number, value: string) => {
    const next = rows.map((r, i) =>
      i === index ? { ...r, answer: value, answeredAt: value.trim() ? new Date().toISOString() : undefined } : r
    );
    onChange(next);
  };

  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">看市场留下的待验证问题</p>
          </div>
          <span
            className={
              answered === rows.length
                ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600'
                : 'text-[11px] font-semibold text-[#86868b]'
            }
          >
            {answered === rows.length && <CheckCircle2 className="w-3.5 h-3.5" />}
            {answered}/{rows.length} 已回答
          </span>
        </div>
        <p className="text-xs text-[#aeaeb2] mb-3">{hint}</p>
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={r.question} className="rounded-xl border border-black/8 bg-[#f8f9fb] p-3">
              <p className="text-xs font-semibold text-[#1d1d1f] mb-1.5">
                {i + 1}. {r.question}
              </p>
              <textarea
                value={r.answer}
                onChange={(e) => setAnswer(i, e.target.value)}
                rows={2}
                placeholder="用这一看的数据给出结论（例如：样本里 12 个竞品只有 2 个标注可调高度，且这 2 个差评集中在…）"
                className={inputCls}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#aeaeb2] mt-2.5">{describeOpenQuestionProgress(questions, rows)}</p>
      </div>
    </Card>
  );
}
