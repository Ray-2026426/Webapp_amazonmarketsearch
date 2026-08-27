import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createDocxWithMarkdown, getAppCredentials, sendJson } from '../_shared.js';

/**
 * 用用户 token 创建飞书文档并写入 Markdown 正文
 * POST { title, markdown, access_token }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (!getAppCredentials()) {
    return sendJson(res, 503, {
      error: '服务端未配置 FEISHU_APP_ID / FEISHU_APP_SECRET。请到 Vercel 环境变量填写后再试。',
      needConfig: true,
    });
  }

  const title = String(req.body?.title || 'Kairo 报告').slice(0, 100);
  const markdown = String(req.body?.markdown || '');
  const access_token = String(req.body?.access_token || '');

  if (!access_token) {
    return sendJson(res, 401, { error: '缺少 access_token', needAuth: true });
  }
  if (!markdown.trim()) {
    return sendJson(res, 400, { error: '报告内容为空' });
  }

  try {
    const result = await createDocxWithMarkdown(access_token, title, markdown);
    return sendJson(res, 200, {
      url: result.url,
      document_id: result.documentId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建文档失败';
    const needAuth = /token|auth|401|99991663|99991668/i.test(msg);
    return sendJson(res, needAuth ? 401 : 500, {
      error: msg,
      needAuth,
    });
  }
}
