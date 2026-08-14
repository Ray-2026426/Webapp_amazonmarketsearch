import type { VercelRequest, VercelResponse } from '@vercel/node';

export function getAppCredentials(): { appId: string; appSecret: string } | null {
  const appId = (process.env.FEISHU_APP_ID || '').trim();
  const appSecret = (process.env.FEISHU_APP_SECRET || '').trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function getRedirectUri(req: VercelRequest): string {
  const fromEnv = (process.env.FEISHU_REDIRECT_URI || '').trim();
  if (fromEnv) return fromEnv;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}/api/feishu/oauth/callback`;
}

export function sendJson(res: VercelResponse, status: number, body: Record<string, unknown>) {
  res.status(status).json(body);
}

export async function getAppAccessToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = (await res.json()) as { code?: number; app_access_token?: string; msg?: string };
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(data.msg || '获取 app_access_token 失败');
  }
  return data.app_access_token;
}

/** Markdown → 飞书 docx children 块（标题/段落/列表） */
export function markdownToFeishuChildren(markdown: string): Record<string, unknown>[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Record<string, unknown>[] = [];

  const pushText = (blockType: number, text: string) => {
    const t = text.trimEnd();
    if (!t.trim() && blockType === 2) return;
    blocks.push({
      block_type: blockType,
      ...(blockType === 3
        ? { heading1: textEl(t.replace(/^#\s*/, '')) }
        : blockType === 4
          ? { heading2: textEl(t.replace(/^##\s*/, '')) }
          : blockType === 5
            ? { heading3: textEl(t.replace(/^###\s*/, '')) }
            : blockType === 12
              ? { bullet: textEl(t.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')) }
              : { text: textEl(t) }),
    });
  };

  let paraBuf: string[] = [];
  const flushPara = () => {
    if (!paraBuf.length) return;
    pushText(2, paraBuf.join('\n'));
    paraBuf = [];
  };

  for (const raw of lines) {
    const line = raw;
    if (/^###\s+/.test(line)) {
      flushPara();
      pushText(5, line);
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushPara();
      pushText(4, line);
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushPara();
      pushText(3, line);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara();
      pushText(12, line.trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    paraBuf.push(line);
  }
  flushPara();

  // 飞书单次写入有数量限制，截断保护
  return blocks.slice(0, 400);
}

function textEl(content: string) {
  return {
    elements: [
      {
        text_run: {
          content: content.slice(0, 8000) || ' ',
        },
      },
    ],
    style: {},
  };
}

export async function createDocxWithMarkdown(
  userAccessToken: string,
  title: string,
  markdown: string
): Promise<{ documentId: string; url: string }> {
  const createRes = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: title.slice(0, 100) || 'Kairo 报告' }),
  });
  const createData = (await createRes.json()) as {
    code?: number;
    msg?: string;
    data?: { document?: { document_id?: string } };
  };
  if (createData.code !== 0 || !createData.data?.document?.document_id) {
    throw new Error(createData.msg || '创建飞书文档失败');
  }
  const documentId = createData.data.document.document_id;

  const children = markdownToFeishuChildren(markdown);
  if (children.length > 0) {
    // 分批写入，每批最多 40 块
    const batchSize = 40;
    for (let i = 0; i < children.length; i += batchSize) {
      const chunk = children.slice(i, i + batchSize);
      const writeRes = await fetch(
        `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ children: chunk, index: -1 }),
        }
      );
      const writeData = (await writeRes.json()) as { code?: number; msg?: string };
      if (writeData.code !== 0) {
        // 文档已创建，正文部分失败也返回链接
        console.error('feishu write blocks', writeData);
        break;
      }
    }
  }

  return {
    documentId,
    url: `https://feishu.cn/docx/${documentId}`,
  };
}
