import type { AiInsight } from '../components/KeywordAnalysis';

/** 把 HTML 粗转成可读 Markdown（不做 1:1 样式还原） */
export function htmlToMarkdown(html: string): string {
  if (!html?.trim()) return '';
  let s = html
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');

  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${stripTags(t).trim()}\n\n`);

  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripTags(t).trim()}\n`);
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<p[^>]*>/gi, '');
  s = s.replace(/<\/div>/gi, '\n');
  s = s.replace(/<div[^>]*>/gi, '');
  s = s.replace(/<\/tr>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, ' | ');
  s = s.replace(/<(td|th)[^>]*>/gi, '');
  s = s.replace(/<\/?(table|thead|tbody|tr)[^>]*>/gi, '\n');

  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  s = s.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  s = stripTags(s);
  s = decodeHtmlEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function stripTags(input: string): string {
  return String(input || '').replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function bullets(items: unknown, prefix = '- '): string {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .map((x) => `${prefix}${x}`)
    .join('\n');
}

/** 结构化用户洞察 → Markdown（关键词报告 / VOC 深度洞察共用） */
export function aiInsightToMarkdown(ins: AiInsight, title = 'AI 用户洞察报告'): string {
  const lines: string[] = [`# ${title}`, ''];

  lines.push('## 用户画像', '', ins.userPersona || '—', '');

  lines.push('### 核心场景', bullets(ins.userScenes) || '- —', '');
  lines.push('### 核心需求', bullets(ins.userNeeds) || '- —', '');
  lines.push('### 主要痛点', bullets(ins.userPainPoints) || '- —', '');

  lines.push('## 决策路径', '');
  if (Array.isArray(ins.decisionStages) && ins.decisionStages.length) {
    for (const st of ins.decisionStages) {
      lines.push(`### ${st.name || '阶段'}`, '', st.desc || '', '');
      if (st.signals) lines.push(`**信号/证据：** ${st.signals}`, '');
    }
  } else {
    lines.push('—', '');
  }
  if (ins.decisionSummary) {
    lines.push('### 路径小结', '', ins.decisionSummary, '');
  }

  if (ins.insightAnalysis) {
    lines.push('## 洞察结论', '', ins.insightAnalysis, '');
  }

  const listing = ins.listingPlan;
  if (listing) {
    lines.push('## Listing 方案建议', '');
    if (listing.title) lines.push(`**标题方向：** ${listing.title}`, '');
    if (listing.bullets?.length) {
      lines.push('**五点：**', bullets(listing.bullets), '');
    }
    if (listing.keywords) lines.push(`**关键词：** ${listing.keywords}`, '');
    if (listing.visual) lines.push(`**视觉：** ${listing.visual}`, '');
  }

  const product = ins.productPlan;
  if (product) {
    lines.push('## 产品方案', '');
    if (product.core) lines.push(`**核心：** ${product.core}`, '');
    if (product.differentiation) lines.push(`**差异化：** ${product.differentiation}`, '');
    if (product.priceRange) lines.push(`**价格带：** ${product.priceRange}`, '');
    if (product.mustFix?.length) lines.push('**必须修：**', bullets(product.mustFix), '');
    if (product.parentStructure) {
      lines.push('### 父体变体结构', '', product.parentStructure.summary || '', '');
      for (const v of product.parentStructure.variants || []) {
        lines.push(`- **${v.name}**（${v.role} · ${v.priority}）：${v.rationale || ''}`);
      }
      lines.push('');
    }
  }

  if (Array.isArray(ins.productRoadmap) && ins.productRoadmap.length) {
    lines.push('## 产品路线图', '');
    for (const r of ins.productRoadmap) {
      lines.push(`### ${r.phase || ''} ${r.name || ''}`.trim(), '');
      lines.push(`- 目标：${r.target || '—'}`);
      lines.push(`- 优先级：${r.priority || '—'}`);
      if (r.rationale) lines.push(`- 理由：${r.rationale}`);
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 市场报告已是 Markdown，原样返回 */
export function marketReportToMarkdown(markdown: string, title = 'AI 深度市场分析报告'): string {
  const body = (markdown || '').trim();
  if (!body) return '';
  if (/^#\s/.test(body)) return body;
  return `# ${title}\n\n${body}`;
}

export function competitorReportToMarkdown(html: string, title = '竞品 AI 综合报告'): string {
  const body = htmlToMarkdown(html);
  if (!body) return '';
  if (/^#\s/.test(body)) return body;
  return `# ${title}\n\n${body}`;
}

export function vocReportToMarkdown(opts: {
  insight?: AiInsight | null;
  html?: string;
  markdown?: string;
  title?: string;
}): string {
  const title = opts.title || 'VOC 深度洞察报告';
  if (opts.insight) return aiInsightToMarkdown(opts.insight, title);
  if (opts.html?.trim()) {
    const body = htmlToMarkdown(opts.html);
    return body.startsWith('#') ? body : `# ${title}\n\n${body}`;
  }
  if (opts.markdown?.trim()) {
    const body = opts.markdown.trim();
    return body.startsWith('#') ? body : `# ${title}\n\n${body}`;
  }
  return '';
}

export function downloadMarkdownFile(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function safeDownloadBasename(title: string): string {
  const base = (title || 'report')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return base || 'report';
}
