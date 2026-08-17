import { getCurrentUser, isAdminSession, type SessionUser } from './auth';

/** 使用者背景信息：让 AI 更懂「谁在用这个 App」。 */

const LEGACY_PROFILE_KEY = 'amzdev_user_background';
const PROFILE_KEY_PREFIX = 'amzdev_user_background:';

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

export const ADMIN_DEFAULT_USER_BACKGROUND: UserBackgroundProfile = {
  displayName: 'Ray',
  role: '项目负责人 / 亚马逊市场调研与选品决策负责人',
  company: 'OG 项目组 / 跨境电商团队',
  brands: 'OG 项目组、Kairo 市场调研工具',
  categories: '亚马逊新品选品、用户洞察、关键词分析、评论洞察、竞品分析、Listing 优化',
  marketplaces: 'US、UK、DE 为主，兼顾其他亚马逊站点',
  experience: '持续搭建亚马逊市场调研 Web App，关注选品判断、用户洞察、竞品拆解、数据抓取与 AI 报告质量。',
  goals:
    '把 Kairo 打造成更好用、更准确的亚马逊市场调研和选品决策工作台；提升交互体验、数据洞察准确性、报告可审计性，并支持新品机会判断、老品改版、关键词机会和评论洞察。',
  constraints:
    '结论必须有数据证据和置信度说明；避免空泛建议；优先复用现有供应链与可执行动作；关注 MOQ、利润空间、FBA 成本、广告预算、合规风险和团队执行成本。',
  analysisStyle:
    '结论先行，直接务实；先讲判断和必要性，再给证据、风险和行动清单；用中文输出，明确样本口径、数据不足和优先级。',
  extraNotes:
    '用户重视深入审查和讲清楚优化必要性；不满意时需要可回退。AI 不要复述整段背景，只把这些信息用于更贴近业务场景的判断。',
};

function readProfile(key: string): Partial<UserBackgroundProfile> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserBackgroundProfile>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function profileStorageKey(user?: SessionUser | null): string {
  const u = user ?? getCurrentUser();
  return u?.id ? `${PROFILE_KEY_PREFIX}${u.id}` : LEGACY_PROFILE_KEY;
}

function defaultProfileFor(user?: SessionUser | null): UserBackgroundProfile {
  return isAdminSession(user ?? getCurrentUser())
    ? { ...ADMIN_DEFAULT_USER_BACKGROUND }
    : { ...EMPTY_USER_BACKGROUND };
}

function normalizeProfile(
  profile: Partial<UserBackgroundProfile> | null | undefined,
  defaults: UserBackgroundProfile
): UserBackgroundProfile {
  return { ...defaults, ...(profile ?? {}) };
}

export function loadUserBackground(user?: SessionUser | null): UserBackgroundProfile {
  const defaults = defaultProfileFor(user);
  try {
    const key = profileStorageKey(user);
    const accountProfile = readProfile(key);
    if (accountProfile) return normalizeProfile(accountProfile, defaults);

    const legacyProfile = readProfile(LEGACY_PROFILE_KEY);
    if (legacyProfile) {
      const migrated = normalizeProfile(legacyProfile, defaults);
      if (key !== LEGACY_PROFILE_KEY) {
        localStorage.setItem(key, JSON.stringify(migrated));
      }
      return migrated;
    }

    return defaults;
  } catch {
    return defaults;
  }
}

export function saveUserBackground(
  profile: UserBackgroundProfile,
  user?: SessionUser | null
): void {
  localStorage.setItem(profileStorageKey(user), JSON.stringify(profile));
}

export function hasUserBackground(profile?: UserBackgroundProfile | null): boolean {
  const p = profile ?? loadUserBackground();
  return Object.values(p).some((v) => String(v || '').trim().length > 0);
}

/** 拼成给 AI 的系统提示片段（无内容则返回空串）。 */
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
