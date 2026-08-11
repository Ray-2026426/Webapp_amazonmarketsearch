/** 使用者背景信息：让 AI 更懂「谁在用这个 App」 */

const PROFILE_KEY = 'amzdev_user_background';

export interface UserBackgroundProfile {
  /** 怎么称呼你 */
  displayName: string;
  /** 岗位角色，如：项目经理 / 运营 / 开发 */
  role: string;
  /** 公司或团队 */
  company: string;
  /** 负责品牌 */
  brands: string;
  /** 常做品类 */
  categories: string;
  /** 主做站点，如 US / UK / DE */
  marketplaces: string;
  /** 亚马逊从业年限或经验简述 */
  experience: string;
  /** 近期目标（选品、改版、冲量等） */
  goals: string;
  /** 约束条件（预算、供应链、合规等） */
  constraints: string;
  /** 希望 AI 怎么表达（结论先行、偏数据、偏动作清单等） */
  analysisStyle: string;
  /** 其他补充 */
  extraNotes: string;
}

export const EMPTY_USER_BACKGROUND: UserBackgroundProfile = {
  displayName: '',
  role: '',
  company: '',
  brands: '',
  categories: '',
  marketplaces: '',
  experience: '',
  goals: '',
  constraints: '',
  analysisStyle: '',
  extraNotes: '',
};

export function loadUserBackground(): UserBackgroundProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...EMPTY_USER_BACKGROUND };
    const parsed = JSON.parse(raw) as Partial<UserBackgroundProfile>;
    return { ...EMPTY_USER_BACKGROUND, ...parsed };
  } catch {
    return { ...EMPTY_USER_BACKGROUND };
  }
}

export function saveUserBackground(profile: UserBackgroundProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function hasUserBackground(profile?: UserBackgroundProfile | null): boolean {
  const p = profile ?? loadUserBackground();
  return Object.values(p).some((v) => String(v || '').trim().length > 0);
}

/** 拼成给 AI 的系统提示片段（无内容则返回空串） */
export function buildUserBackgroundSystemPrompt(profile?: UserBackgroundProfile | null): string {
  const p = profile ?? loadUserBackground();
  if (!hasUserBackground(p)) return '';

  const lines: string[] = [
    '【使用者背景】以下信息描述正在使用本亚马逊市场调研工具的人。请据此调整分析视角、术语深度与建议可执行性；不要复述整段背景，除非对结论有直接帮助。',
  ];
  const add = (label: string, value: string) => {
    const v = value.trim();
    if (v) lines.push(`- ${label}：${v}`);
  };
  add('称呼', p.displayName);
  add('角色', p.role);
  add('公司/团队', p.company);
  add('负责品牌', p.brands);
  add('关注品类', p.categories);
  add('主做站点', p.marketplaces);
  add('经验', p.experience);
  add('近期目标', p.goals);
  add('约束条件', p.constraints);
  add('期望表达风格', p.analysisStyle);
  add('其他补充', p.extraNotes);
  return lines.join('\n');
}
