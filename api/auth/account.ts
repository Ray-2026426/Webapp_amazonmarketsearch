import crypto from 'node:crypto';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}[A-Za-z0-9]$/;

export interface NormalizedAccount {
  account: string;
  authEmail: string;
  isEmail: boolean;
}

export function normalizeAccount(raw: unknown): NormalizedAccount | null {
  const account = String(raw || '').trim().toLowerCase();
  if (!account) return null;
  if (EMAIL_RE.test(account)) return { account, authEmail: account, isEmail: true };
  if (!ACCOUNT_RE.test(account)) return null;

  const digest = crypto.createHash('sha256').update(account).digest('hex').slice(0, 32);
  return {
    account,
    authEmail: `acct-${digest}@users.amzdev.dev`,
    isEmail: false,
  };
}

export function accountError(): string {
  return '账号格式无效，请使用邮箱、纯数字，或 3-64 位字母/数字/._- 组合';
}
