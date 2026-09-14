// M2⑤ · 修断链 #7：看市场提出的「待验证问题」原本没有任何下游消费者。
//
// 现在把这些问题带到「看用户」和「看竞对」页面顶部，并且**可回答**——
// 回答存在下游那一看自己的数据里（不是存回看市场），因为"验证结论"属于做验证的那一步。
//
// 规则：
// - 问题以文本为键（用户可能在看市场里改字），对齐时按文本匹配，匹配不到的旧回答保留不删；
// - 不编造回答：没填就是空字符串。

export interface OpenQuestionAnswer {
  question: string;
  answer: string;
  answeredAt?: string;
}

/** 把「问题列表」和「已有回答」对齐成可编辑的行（问题为准，旧回答按文本匹配保留） */
export function alignOpenQuestionAnswers(
  questions: string[],
  answers: OpenQuestionAnswer[] | undefined
): OpenQuestionAnswer[] {
  const list = Array.isArray(questions) ? questions.filter((q) => q.trim().length > 0) : [];
  const prev = Array.isArray(answers) ? answers : [];
  const byQuestion = new Map(prev.map((a) => [a.question, a]));
  return list.map((q) => {
    const hit = byQuestion.get(q);
    return hit ? { ...hit, question: q } : { question: q, answer: '' };
  });
}

/** 已回答条数（去空白） */
export function countAnswered(answers: OpenQuestionAnswer[] | undefined): number {
  return (Array.isArray(answers) ? answers : []).filter((a) => (a.answer || '').trim().length > 0).length;
}

/** 一句话说明：给主屏结论/徽章用（诚实：没答完就说没答完） */
export function describeOpenQuestionProgress(questions: string[], answers: OpenQuestionAnswer[] | undefined): string {
  const total = (Array.isArray(questions) ? questions : []).filter((q) => q.trim().length > 0).length;
  if (total === 0) return '看市场还没有留下待验证问题';
  return `看市场留下的 ${total} 个待验证问题，已回答 ${countAnswered(answers)} 个`;
}

/** 给 AI 的上下文：让下游那一看的 AI 必须正面回答这些问题（AI 只答，不改分数） */
export function openQuestionsForPrompt(questions: string[], answers: OpenQuestionAnswer[] | undefined): string {
  const rows = alignOpenQuestionAnswers(questions, answers);
  if (rows.length === 0) return '';
  const lines = rows.map((r, i) =>
    r.answer.trim() ? `${i + 1}. ${r.question}（用户已有初步回答：${r.answer.trim()}）` : `${i + 1}. ${r.question}`
  );
  return `\n\n【来自「看市场」的待验证问题（必须在本步结论中正面回应，不要编造数据）】\n${lines.join('\n')}`;
}

/** 传给 AI 的可回填结构（下游那一看可以给 AI 让它回答） */
export function buildAnswersForAi(answers: OpenQuestionAnswer[] | undefined): { question: string; answer: string }[] {
  return (Array.isArray(answers) ? answers : []).map((a) => ({ question: a.question, answer: a.answer || '' }));
}
