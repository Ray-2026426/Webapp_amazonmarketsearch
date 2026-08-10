/**
 * 解析单个竞品压缩包：提取主图、A+、五点文案。
 * 每个竞品独立上传一个 zip，避免多文件夹识别错误。
 */

export interface ParsedArchiveImage {
  path: string;
  fileName: string;
  blob: Blob;
  sortKey: string;
}

export interface ParsedArchiveCompetitor {
  folderName: string;
  mainImages: ParsedArchiveImage[];
  aplusImages: ParsedArchiveImage[];
  bulletPoints: string;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;
const TEXT_EXT = /\.(txt|md|csv|json)$/i;
const SKIP_NAMES = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

const CATEGORY_FOLDER_MAIN = /主图|附图|商品图|main|gallery|pdp|hero|listing[\s_-]?image/i;
const CATEGORY_FOLDER_APLUS = /a\s*\+|aplus|ebc|品牌故事|增强|premium|brand[\s_-]?story|content[\s_-]?module|模块/i;
const CATEGORY_FOLDER_BULLET = /五点|bullet|卖点|描述|文案|listing[\s_-]?text|features/i;

const MAIN_FILE_PATTERNS = [/主图/i, /附图/i, /\bmain\b/i, /gallery/i, /pdp/i, /hero/i, /thumb/i, /_01\b/i];
const APLUS_FILE_PATTERNS = [/a\s*\+/i, /aplus/i, /ebc/i, /brand/i, /模块/i, /module/i, /story/i];

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function naturalSortKey(name: string): string {
  return name.toLowerCase().replace(/(\d+)/g, (_, n) => n.padStart(8, '0'));
}

function isSkippablePath(path: string): boolean {
  return path.split('/').some((seg) => SKIP_NAMES.has(seg) || seg.startsWith('.'));
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/** 若 zip 内所有文件都在同一顶层文件夹下，剥掉这一层 */
function unwrapCommonRoot(paths: string[]): { strip: string; paths: string[] } {
  if (paths.length === 0) return { strip: '', paths };
  const firstSegs = paths.map((p) => p.split('/')[0]).filter(Boolean);
  if (firstSegs.length === 0) return { strip: '', paths };
  const root = firstSegs[0];
  const allSame = firstSegs.every((s) => s === root);
  if (!allSame || paths.every((p) => !p.includes('/'))) {
    return { strip: '', paths };
  }
  const stripped = paths.map((p) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p));
  return { strip: root, paths: stripped };
}

function classifyByPath(relativePath: string): 'main' | 'aplus' | 'unknown' {
  const parts = relativePath.split('/');
  const fileName = parts[parts.length - 1] ?? '';
  const dirs = parts.slice(0, -1);

  for (const dir of dirs) {
    if (CATEGORY_FOLDER_APLUS.test(dir)) return 'aplus';
    if (CATEGORY_FOLDER_MAIN.test(dir)) return 'main';
  }
  if (matchesAny(fileName, APLUS_FILE_PATTERNS)) return 'aplus';
  if (matchesAny(fileName, MAIN_FILE_PATTERNS)) return 'main';
  return 'unknown';
}

function isBulletPath(path: string): boolean {
  const parts = path.split('/');
  const fileName = parts[parts.length - 1] ?? '';
  if (!TEXT_EXT.test(fileName)) return false;
  if (parts.some((d) => CATEGORY_FOLDER_BULLET.test(d))) return true;
  return /五点|bullet|卖点|描述|文案|feature|listing/i.test(fileName);
}

function isGenericTextPath(path: string): boolean {
  return TEXT_EXT.test(path) && !IMAGE_EXT.test(path);
}

async function loadZipEntries(file: File): Promise<Map<string, Blob>> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const map = new Map<string, Blob>();

  for (const rawPath of Object.keys(zip.files)) {
    const entry = zip.files[rawPath];
    if (!entry || entry.dir) continue;
    const path = normalizePath(rawPath);
    if (isSkippablePath(path)) continue;
    map.set(path, await entry.async('blob'));
  }
  return map;
}

function distributeUnknown(
  unknown: ParsedArchiveImage[],
  main: ParsedArchiveImage[],
  aplus: ParsedArchiveImage[]
): { main: ParsedArchiveImage[]; aplus: ParsedArchiveImage[] } {
  if (unknown.length === 0) return { main, aplus };
  const sorted = [...unknown].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  if (main.length === 0 && aplus.length === 0) {
    const split = Math.max(1, Math.ceil(sorted.length / 2));
    return { main: [...main, ...sorted.slice(0, split)], aplus: [...aplus, ...sorted.slice(split)] };
  }
  if (main.length === 0) return { main: sorted, aplus };
  return { main, aplus: [...aplus, ...sorted] };
}

/**
 * 解析「单个竞品」的 zip 压缩包。
 * @param defaultName 展示名称（如「竞品 1」）
 */
export async function parseSingleCompetitorZip(
  file: File,
  defaultName: string
): Promise<{ competitor: ParsedArchiveCompetitor; warnings: string[] }> {
  const warnings: string[] = [];

  if (!file.name.toLowerCase().endsWith('.zip')) {
    throw new Error('请上传 .zip 格式压缩包');
  }

  const entries = await loadZipEntries(file);
  const rawPaths = [...entries.keys()].map(normalizePath);
  if (rawPaths.length === 0) throw new Error('压缩包为空');

  const { strip: rootName, paths } = unwrapCommonRoot(rawPaths);
  const pathMap = new Map<string, Blob>();
  for (const rawPath of [...entries.keys()]) {
    const norm = normalizePath(rawPath);
    let relative = norm;
    if (rootName && norm.startsWith(`${rootName}/`)) {
      relative = norm.slice(rootName.length + 1);
    }
    const blob = entries.get(rawPath);
    if (blob) pathMap.set(relative, blob);
  }

  const displayName = rootName || defaultName.replace(/\.zip$/i, '') || defaultName;

  let mainImages: ParsedArchiveImage[] = [];
  let aplusImages: ParsedArchiveImage[] = [];
  let unclassified: ParsedArchiveImage[] = [];
  let bulletPoints = '';
  const textCandidates: { path: string; content: string }[] = [];

  for (const path of paths) {
    const blob = pathMap.get(path);
    if (!blob) continue;

    if (IMAGE_EXT.test(path)) {
      const item: ParsedArchiveImage = {
        path,
        fileName: path.split('/').pop() ?? path,
        blob,
        sortKey: naturalSortKey(path),
      };
      const cat = classifyByPath(path);
      if (cat === 'main') mainImages.push(item);
      else if (cat === 'aplus') aplusImages.push(item);
      else unclassified.push(item);
      continue;
    }

    if (isGenericTextPath(path)) {
      try {
        const content = (await blob.text()).trim();
        if (!content) continue;
        if (isBulletPath(path)) {
          bulletPoints = bulletPoints ? `${bulletPoints}\n\n${content}` : content;
        } else {
          textCandidates.push({ path, content });
        }
      } catch {
        warnings.push(`无法读取：${path}`);
      }
    }
  }

  // 未命中「五点」关键词时，使用最长的文本文件作为五点
  if (!bulletPoints && textCandidates.length > 0) {
    textCandidates.sort((a, b) => b.content.length - a.content.length);
    bulletPoints = textCandidates[0].content;
    warnings.push(`五点文案取自：${textCandidates[0].path}`);
  }

  const distributed = distributeUnknown(unclassified, mainImages, aplusImages);
  mainImages = distributed.main.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  aplusImages = distributed.aplus.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (unclassified.length > 0 && mainImages.length + aplusImages.length > 0) {
    warnings.push(`${unclassified.length} 张图片路径未标明类型，已按规则自动归类`);
  }

  if (mainImages.length === 0 && aplusImages.length === 0 && !bulletPoints) {
    throw new Error('未识别到图片或文案。请确保 zip 内含 主图/A+ 文件夹或图片文件');
  }

  return {
    competitor: {
      folderName: displayName,
      mainImages,
      aplusImages,
      bulletPoints,
    },
    warnings,
  };
}
