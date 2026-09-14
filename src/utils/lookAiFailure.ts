// 五看 AI「为什么没结果」的归类（纯函数，无浏览器依赖，便于确定性测试）。
//
// 背景（真实用户反馈）：用户点「开始分析」后看到"四步都被跳过"，误以为流程正常。
// 真实原因是**没有配置 AI 模型 Key**，而旧逻辑用 /尚未|请先/ 正则一刀切，
// 把"缺配置"也归成"跳过"——两者的下一步动作完全不同（去设置 vs 去取数）。
// 因此这里把失败收敛成 4 类，并把分类权从组件里搬出来，让测试能锁住行为。

export type LookAiFailKind = 'no-key' | 'no-data' | 'parse' | 'other';

export const LOOK_FAIL_LABELS: Record<LookAiFailKind, string> = {
  'no-key': '缺模型 Key',
  'no-data': '缺数据',
  parse: 'AI 返回无法解析',
  other: '其他错误',
};

/** 只有这一类才算「跳过」（数据还没准备好）；其余都是需要用户动手的错误 */
export function isSkipKind(kind: LookAiFailKind): boolean {
  return kind === 'no-data';
}

/**
 * 归类一次五看分析失败。
 * 优先信任 `reason`（由 lookAi 显式给出）；没有时按错误文案兜底推断，
 * 保证旧调用点/存量文案也不会被误判成"跳过"。
 */
export function classifyLookFailure(input: { reason?: LookAiFailKind; error?: string }): LookAiFailKind {
  if (input.reason) return input.reason;
  const msg = input.error ?? '';
  if (/模型\s*Key|API\s*Key|密钥/i.test(msg)) return 'no-key';
  if (/尚未加载|尚未选择|尚未捕获|请先回答|请先到|没有数据/.test(msg)) return 'no-data';
  if (/无法解析|格式/.test(msg)) return 'parse';
  return 'other';
}

/** 给用户的一句人话结论（四步全没跑时用） */
export function describeBlockReason(kind: LookAiFailKind | null): string | null {
  if (kind === 'no-key') {
    return '四步都没跑：还没有配置 AI 模型 Key（这不是"跳过"）。配好后回到本页再点一次「开始分析」即可。';
  }
  if (kind === 'no-data') {
    return '四步都没跑：项目还没有数据。先加载示例数据或去工具取数，再点「开始分析」。';
  }
  return null;
}
