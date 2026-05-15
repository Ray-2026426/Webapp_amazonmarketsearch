import * as XLSX from 'xlsx';

// Currency utility based on marketplace domain
export const getCurrencySymbol = (domain: string): string => {
  const map: Record<string, string> = {
    'amazon.com': '$',
    'amazon.co.uk': '£',
    'amazon.de': '€',
    'amazon.fr': '€',
    'amazon.it': '€',
    'amazon.es': '€',
    'amazon.nl': '€',
    'amazon.se': 'kr',
    'amazon.pl': 'zł',
    'amazon.com.be': '€',
    'amazon.ca': 'CA$',
    'amazon.co.jp': '¥',
    'amazon.com.au': 'A$',
    'amazon.com.mx': 'MX$',
    'amazon.in': '₹',
    'amazon.com.br': 'R$',
    'amazon.sg': 'S$',
    'amazon.ae': 'AED',
    'amazon.sa': 'SAR',
    'amazon.com.tr': '₺',
  };
  return map[domain] ?? '$';
};


export interface Product {
  asin: string;
  sku: string;
  brand: string;
  title: string;
  image: string;
  monthlySales: number;
  monthlyRevenue: number;
  price: number;
  rating: number;
  reviewCount: number;
  reviewGrowth: number;
  sellerCount: number;
  weight: number;
  volume: number;
  launchDate: string;
  daysSinceLaunch: number;
  buyBoxType: string;
  sellerLocation: string;
  fbaFee: number;      // FBA费用
  subBsr: number;      // 小类BSR排名
  subCategory: string; // 小类类目名
}

export interface HistoryRecord {
  asin: string;
  history: Record<string, { sales: number; revenue: number; price: number }>;
}

const findCol = (header: any[], keywords: string[], fallback: number, exclude: number[] = []) => {
  if (!header) return fallback;
  
  // First try exact match, prioritizing keywords
  for (const keyword of keywords) {
    for (let i = 0; i < header.length; i++) {
      if (exclude.includes(i)) continue;
      const col = String(header[i] || '').toLowerCase().trim();
      if (col === keyword.toLowerCase()) return i;
    }
  }
  
  // Then try partial match, prioritizing keywords
  for (const keyword of keywords) {
    for (let i = 0; i < header.length; i++) {
      if (exclude.includes(i)) continue;
      const col = String(header[i] || '').toLowerCase();
      if (col.includes(keyword.toLowerCase())) return i;
    }
  }
  
  return fallback;
};

const parseWeightToKg = (weightStr: any): number => {
  if (!weightStr) return 0;
  const str = String(weightStr).toLowerCase();
  const match = str.match(/([\d.]+)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (str.includes('kg') || str.includes('千克') || str.includes('公斤')) return val;
  if (str.includes('g') || str.includes('克')) return val / 1000;
  if (str.includes('lb') || str.includes('磅') || str.includes('pounds')) return val * 0.453592;
  if (str.includes('oz') || str.includes('盎司') || str.includes('ounces')) return val * 0.0283495;
  return val; // default to just the number if no unit
};

const parseVolumeToCm3 = (dimStr: any): number => {
  if (!dimStr) return 0;
  const str = String(dimStr).toLowerCase();
  const matches = str.match(/([\d.]+)/g);
  if (!matches || matches.length < 3) return 0;
  const l = parseFloat(matches[0]);
  const w = parseFloat(matches[1]);
  const h = parseFloat(matches[2]);
  let vol = l * w * h;
  if (str.includes('in') || str.includes('英寸')) {
    vol = vol * 16.387064; // 2.54^3
  } else if (str.includes('mm') || str.includes('毫米')) {
    vol = vol / 1000;
  }
  return vol; // default to cm3
};

const parseRating = (ratingStr: any): number => {
  if (!ratingStr) return 0;
  const normalized = String(ratingStr).replace(',', '.');
  const match = normalized.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
};

const readWorkbook = async (file: File) => {
  const data = await file.arrayBuffer();
  
  if (file.name.toLowerCase().endsWith('.csv')) {
    const uint8Array = new Uint8Array(data);
    let csvStr = '';
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      csvStr = decoder.decode(uint8Array);
    } catch (e) {
      const decoder = new TextDecoder('gbk');
      csvStr = decoder.decode(uint8Array);
    }
    return XLSX.read(csvStr, { type: 'string' });
  }
  
  // Standard xlsx read - xlsx format is always Unicode internally
  return XLSX.read(data, { type: 'array' });
};

const findHeaderRow = (rows: any[][], keywords: string[]) => {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row)) continue;
    const rowStr = row.map(cell => String(cell || '').toLowerCase()).join('|');
    if (keywords.some(k => rowStr.includes(k.toLowerCase()))) {
      return i;
    }
  }
  return 0;
};

const parseNumber = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = String(val).replace(/[$,\s]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

export const parseProducts = async (file: File): Promise<Product[]> => {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const products: Product[] = [];
  if (rows.length < 2) return products;

  // Find the actual header row - search up to row 10
  const headerRowIdx = findHeaderRow(rows, ['asin', '商品标题', '月销量', '品牌', 'title']);
  const header = rows[headerRowIdx] || [];

  console.log('[parseProducts] headerRowIdx:', headerRowIdx, '| cols:', header.length);
  console.log('[parseProducts] header sample:', header.slice(0, 15).map((h: any, i: number) => `${i}:"${String(h||'').slice(0,10)}"`).join(', '));

  // Pure keyword-based detection - no hardcoded fallback indexes for key fields
  const asinIdx = findCol(header, ['asin'], -1);
  if (asinIdx === -1) {
    console.error('[parseProducts] Cannot find ASIN column!');
    return products;
  }

  const reviewCountIdx = findCol(header, ['评分数', '评论数', 'review count', 'reviews'], -1);
  const ratingIdx = findCol(header, ['评分', 'rating', '星级', 'stars'], -1, reviewCountIdx >= 0 ? [reviewCountIdx] : []);

  const idx = {
    asin:           asinIdx,
    sku:            findCol(header, ['sku'], asinIdx + 1),
    brand:          findCol(header, ['品牌', 'brand'], -1),
    title:          findCol(header, ['商品标题', '标题', 'title', '商品名称'], -1),
    image:          findCol(header, ['商品主图', '主图', '图片链接', 'image url', 'main image'], -1),
    subCategory:    findCol(header, ['小类目', 'sub category'], -1),
    subBsr:         findCol(header, ['小类bsr', '小类BSR', '小类排名'], -1),
    sales:          findCol(header, ['月销量', '月均销量', 'monthly sales', '销量'], -1),
    revenue:        findCol(header, ['月销售额', '月均销售额', 'monthly revenue', '销售额'], -1),
    price:          findCol(header, ['价格', 'price', '售价', 'CDN$'], -1),
    reviewCount:    reviewCountIdx,
    reviewGrowth:   findCol(header, ['月新增评分', '新增评分', '评分增长', 'review growth'], -1),
    rating:         ratingIdx,
    launchDate:     findCol(header, ['上架时间', 'date first available', 'launch date', '首次上架'], -1),
    daysSinceLaunch:findCol(header, ['上架天数', 'days since launch', '天数'], -1),
    sellerCount:    findCol(header, ['卖家数', 'seller count', 'sellers', '卖家数量'], -1),
    buyBoxType:     findCol(header, ['buybox类型', 'BuyBox类型', 'buy box type', 'buybox'], -1),
    sellerLocation: findCol(header, ['卖家所属地', '所属地', 'seller location', '卖家国家'], -1),
    fbaFee:         findCol(header, ['fba', 'FBA', 'fba费用', 'FBA(CDN$)'], -1),
    weight:         findCol(header, ['包装重量（单位换算）', '包装重量', 'package weight', '重量'], -1),
    volume:         findCol(header, ['包装尺寸（单位换算）', '包装尺寸', 'package dimensions', '尺寸'], -1),
  };

  console.log('[parseProducts] idx:', JSON.stringify(idx));

  // Process in chunks to avoid blocking main thread
  const CHUNK_SIZE = 500;
  for (let i = headerRowIdx + 1; i < rows.length; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, rows.length);
    for (let j = i; j < end; j++) {
      const row = rows[j];
      if (!row || !row[idx.asin] || String(row[idx.asin]).trim() === '' || String(row[idx.asin]).toLowerCase() === 'asin') continue;

      const getStr = (i: number) => i >= 0 && row[i] !== undefined ? String(row[i] || '') : '';
      const getNum = (i: number) => i >= 0 ? parseNumber(row[i]) : 0;
      
      let imageUrl = getStr(idx.image);
      if (imageUrl.includes('|')) imageUrl = imageUrl.split('|')[0];
      else if (imageUrl.includes(',')) imageUrl = imageUrl.split(',')[0];
      imageUrl = imageUrl.trim();

      let titleRaw = getStr(idx.title);
      const garbledCount = (titleRaw.match(/[\ufffd\u0000-\u001f]/g) || []).length;
      if (titleRaw.startsWith('http') || titleRaw.startsWith('data:') || titleRaw.length > 500 || (titleRaw.length > 0 && garbledCount / titleRaw.length > 0.3)) {
        titleRaw = '';
      }
      
      products.push({
        asin: String(row[idx.asin] || ''),
        sku: getStr(idx.sku),
        brand: getStr(idx.brand) || '未知',
        title: titleRaw,
        image: imageUrl,
        monthlySales: getNum(idx.sales),
        monthlyRevenue: getNum(idx.revenue),
        price: getNum(idx.price),
        rating: idx.rating >= 0 ? parseRating(row[idx.rating]) : 0,
        reviewCount: getNum(idx.reviewCount),
        reviewGrowth: getNum(idx.reviewGrowth),
        sellerCount: getNum(idx.sellerCount),
        weight: parseWeightToKg(idx.weight >= 0 ? row[idx.weight] : undefined),
        volume: parseVolumeToCm3(idx.volume >= 0 ? row[idx.volume] : undefined),
        launchDate: getStr(idx.launchDate),
        daysSinceLaunch: getNum(idx.daysSinceLaunch),
        buyBoxType: getStr(idx.buyBoxType) || '未知',
        sellerLocation: getStr(idx.sellerLocation) || '未知',
        fbaFee: getNum(idx.fbaFee),
        subBsr: getNum(idx.subBsr),
        subCategory: getStr(idx.subCategory),
      });
    }
    // Yield to main thread
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return products;
};

export interface Review {
  id: string;
  asin: string;
  childAsin?: string;
  parentAsin?: string;
  country?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  hasImage?: boolean;
  hasVideo?: boolean;
  isVp?: boolean;
  title: string;
  content: string;
  rating: number;
  date: string;
  helpful: number;
  tags?: {
    positive: string[];
    negative: string[];
    scenarios: string[];
    audience: string[];
  };
}

export interface ReviewColumnMapping {
  asin: number;
  childAsin: number;
  parentAsin: number;
  country: number;
  imageCount: number;
  imageUrls: number;
  hasImage: number;
  hasVideo: number;
  videoUrls: number;
  isVp: number;
  title: number;
  content: number;
  rating: number;
  date: number;
  helpful: number;
}

export interface ReviewColumnScanItem {
  field: keyof ReviewColumnMapping;
  label: string;
  mappedIndex: number;
  mappedHeader: string;
  coverage: number;
}

export interface ReviewFileScanResult {
  header: string[];
  mapping: ReviewColumnMapping;
  scanItems: ReviewColumnScanItem[];
}

const REVIEW_FIELD_LABELS: Record<keyof ReviewColumnMapping, string> = {
  asin: 'ASIN',
  childAsin: '型号',
  parentAsin: '父体ASIN',
  country: '国家/站点',
  imageCount: '图片数量',
  imageUrls: '图片链接',
  hasImage: '是否含图片',
  hasVideo: '是否含视频',
  videoUrls: '视频地址',
  isVp: '是否VP评论',
  title: '评论标题',
  content: '评论内容',
  rating: '星级',
  date: '评论日期',
  helpful: '赞同数',
};

const normalizeHeaderText = (v: unknown): string =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .replace(/[()（）]/g, '');

const getColByExactHeader = (header: any[], names: string[]): number => {
  const target = new Set(names.map(normalizeHeaderText));
  for (let i = 0; i < header.length; i++) {
    const key = normalizeHeaderText(header[i]);
    if (target.has(key)) return i;
  }
  return -1;
};

function detectReviewColumnMapping(header: any[]): ReviewColumnMapping {
  const exact = {
    asin: getColByExactHeader(header, ['ASIN']),
    title: getColByExactHeader(header, ['标题']),
    content: getColByExactHeader(header, ['内容']),
    isVp: getColByExactHeader(header, ['VP评论', 'Vine Voice评论']),
    childAsin: getColByExactHeader(header, ['型号']),
    rating: getColByExactHeader(header, ['星级']),
    helpful: getColByExactHeader(header, ['赞同数']),
    imageCount: getColByExactHeader(header, ['图片数量']),
    imageUrls: getColByExactHeader(header, ['图片地址']),
    hasVideo: getColByExactHeader(header, ['是否有视频']),
    videoUrls: getColByExactHeader(header, ['视频地址']),
    country: getColByExactHeader(header, ['所属国家']),
    date: getColByExactHeader(header, ['评论时间']),
  };

  return {
    asin: exact.asin >= 0 ? exact.asin : findCol(header, ['asin'], 0),
    childAsin: exact.childAsin >= 0 ? exact.childAsin : findCol(header, ['型号', '子体asin', 'child asin', 'child_asin', 'variant asin', '变体asin'], -1),
    parentAsin: findCol(header, ['父体asin', 'parent asin', 'parent_asin'], -1),
    country: exact.country >= 0 ? exact.country : findCol(header, ['所属国家', '国家', '站点', 'country', 'marketplace', '国家/地区'], -1),
    imageCount: exact.imageCount >= 0 ? exact.imageCount : findCol(header, ['图片数量', 'image count'], -1),
    imageUrls: exact.imageUrls >= 0 ? exact.imageUrls : findCol(header, ['图片地址', '图片链接', 'image url', 'images', 'review images', '图片url'], -1),
    hasImage: findCol(header, ['有图', '含图', 'image', 'with image', 'has image', '图片'], -1),
    hasVideo: exact.hasVideo >= 0 ? exact.hasVideo : findCol(header, ['是否有视频', '有视频', '含视频', 'video', 'with video', 'has video', '视频'], -1),
    videoUrls: exact.videoUrls >= 0 ? exact.videoUrls : findCol(header, ['视频地址', 'video url', 'video link'], -1),
    isVp: exact.isVp >= 0 ? exact.isVp : findCol(header, ['vp评论', 'vine voice评论', 'vp', 'vine', 'vine voice', 'vine评论', '是否vp'], -1),
    title: exact.title >= 0 ? exact.title : findCol(header, ['标题', 'title', 'review title'], 1),
    content: exact.content >= 0 ? exact.content : findCol(header, ['内容', 'content', 'review content', 'body', '评论内容'], 2),
    rating: exact.rating >= 0 ? exact.rating : findCol(header, ['星级', 'rating', 'star'], 3),
    date: exact.date >= 0 ? exact.date : findCol(header, ['评论时间', '日期', 'date', 'review date'], 4),
    helpful: exact.helpful >= 0 ? exact.helpful : findCol(header, ['赞同数', '有用', 'helpful', 'votes'], 5),
  };
}

function normalizeReviewMapping(mapping: ReviewColumnMapping, headerLen: number): ReviewColumnMapping {
  const clamp = (i: number) => (Number.isInteger(i) && i >= 0 && i < headerLen ? i : -1);
  return {
    asin: clamp(mapping.asin),
    childAsin: clamp(mapping.childAsin),
    parentAsin: clamp(mapping.parentAsin),
    country: clamp(mapping.country),
    imageCount: clamp(mapping.imageCount),
    imageUrls: clamp(mapping.imageUrls),
    hasImage: clamp(mapping.hasImage),
    hasVideo: clamp(mapping.hasVideo),
    videoUrls: clamp(mapping.videoUrls),
    isVp: clamp(mapping.isVp),
    title: clamp(mapping.title),
    content: clamp(mapping.content),
    rating: clamp(mapping.rating),
    date: clamp(mapping.date),
    helpful: clamp(mapping.helpful),
  };
}

function buildReviewScanItems(rows: any[][], header: string[], mapping: ReviewColumnMapping): ReviewColumnScanItem[] {
  const total = Math.max(1, rows.length - 1);
  const fields = Object.keys(mapping) as (keyof ReviewColumnMapping)[];
  return fields.map((field) => {
    const idx = mapping[field];
    let nonEmpty = 0;
    if (idx >= 0) {
      for (let i = 1; i < rows.length; i++) {
        const v = rows[i]?.[idx];
        if (v !== undefined && v !== null && String(v).trim() !== '') nonEmpty += 1;
      }
    }
    return {
      field,
      label: REVIEW_FIELD_LABELS[field],
      mappedIndex: idx,
      mappedHeader: idx >= 0 ? String(header[idx] || `列${idx + 1}`) : '',
      coverage: idx >= 0 ? Number(((nonEmpty / total) * 100).toFixed(1)) : 0,
    };
  });
}

function buildReviewsFromRows(rows: any[][], mapping: ReviewColumnMapping): Review[] {
  const reviews: Review[] = [];
  const getStr = (row: any[], idx: number) => (idx >= 0 ? String(row[idx] || '') : '');
  const getNum = (row: any[], idx: number) => (idx >= 0 ? Number(row[idx]) || 0 : 0);
  const parseImageUrls = (row: any[], idx: number): string[] => {
    if (idx < 0) return [];
    const raw = String(row[idx] || '').trim();
    if (!raw) return [];
    const urls = raw
      .split(/[\n,|;]/)
      .map((x) => x.trim())
      .filter((x) => /^https?:\/\//i.test(x));
    return [...new Set(urls)];
  };
  const parseVideoUrls = (row: any[], idx: number): string[] => {
    if (idx < 0) return [];
    const raw = String(row[idx] || '').trim();
    if (!raw) return [];
    const urls = raw
      .split(/[\n,|;]/)
      .map((x) => x.trim())
      .filter((x) => /^https?:\/\//i.test(x));
    return [...new Set(urls)];
  };
  const getBool = (row: any[], idx: number) => {
    if (idx < 0) return false;
    const raw = row[idx];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return false;
    return ['1', 'true', 'yes', 'y', '是', '有', '包含', '包含图片', '包含视频', 'vp', 'vine'].includes(s);
  };
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const asinVal = getStr(row, mapping.asin).trim();
    const titleVal = getStr(row, mapping.title).trim();
    const contentVal = getStr(row, mapping.content).trim();
    const dateVal = getStr(row, mapping.date).trim();
    const ratingVal = mapping.rating >= 0 ? parseRating(row[mapping.rating]) : 0;
    const helpfulVal = getNum(row, mapping.helpful);
    const hasCoreContent = Boolean(asinVal || titleVal || contentVal || dateVal || ratingVal > 0 || helpfulVal > 0);
    if (!hasCoreContent) continue;
    const parsedImageUrls = parseImageUrls(row, mapping.imageUrls);
    const parsedVideoUrls = parseVideoUrls(row, mapping.videoUrls);
    const imageCount = mapping.imageCount >= 0 ? Number(row[mapping.imageCount]) || 0 : 0;
    const hasImageFlag = getBool(row, mapping.hasImage) || parsedImageUrls.length > 0 || imageCount > 0;
    const hasVideoFlag = getBool(row, mapping.hasVideo) || parsedVideoUrls.length > 0;
    reviews.push({
      id: Math.random().toString(36).substr(2, 9),
      asin: asinVal,
      childAsin: getStr(row, mapping.childAsin),
      parentAsin: getStr(row, mapping.parentAsin),
      country: getStr(row, mapping.country),
      imageUrls: parsedImageUrls,
      videoUrls: parsedVideoUrls,
      hasImage: hasImageFlag,
      hasVideo: hasVideoFlag,
      isVp: getBool(row, mapping.isVp),
      title: titleVal,
      content: contentVal,
      rating: ratingVal,
      date: dateVal,
      helpful: helpfulVal,
    });
  }
  return reviews;
}

export const scanReviewFile = async (file: File): Promise<ReviewFileScanResult> => {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  const headerRowIdx = findHeaderRow(rows, ['asin', '标题', '内容', '星级', '评论时间', '赞同数']);
  const normalizedRows = rows.slice(headerRowIdx);
  const header = (normalizedRows[0] || []).map((h: any) => String(h || '').trim());
  const guessed = detectReviewColumnMapping(header);
  const mapping = normalizeReviewMapping(guessed, header.length);
  return {
    header,
    mapping,
    scanItems: buildReviewScanItems(normalizedRows, header, mapping),
  };
};

export const parseReviewsWithMapping = async (
  file: File,
  mapping: ReviewColumnMapping
): Promise<Review[]> => {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  const headerRowIdx = findHeaderRow(rows, ['asin', '标题', '内容', '星级', '评论时间', '赞同数']);
  const normalizedRows = rows.slice(headerRowIdx);
  if (normalizedRows.length < 2) return [];
  const headerLen = (normalizedRows[0] || []).length;
  const normalized = normalizeReviewMapping(mapping, headerLen);
  return buildReviewsFromRows(normalizedRows, normalized);
};

export const parseReviews = async (file: File): Promise<Review[]> => {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  const headerRowIdx = findHeaderRow(rows, ['asin', '标题', '内容', '星级', '评论时间', '赞同数']);
  const normalizedRows = rows.slice(headerRowIdx);
  if (normalizedRows.length < 2) return [];
  const header = normalizedRows[0] || [];
  const mapping = normalizeReviewMapping(detectReviewColumnMapping(header), header.length);
  return buildReviewsFromRows(normalizedRows, mapping);
};

export interface Keyword {
  id: string;
  keyword: string;
  translation: string;
  wordTag: string;
  matchType: string;
  relevanceTier: string;
  rank: number;
  weeklySearchVolume: number;
  cpcBid: number;
  cpcBidRange: string;
  conversionRate: number;
  difficulty: number;
  difficultyTier: string;
  organicScrollRate: number;
  top3ClickShare: number;
  top3ConversionShare: number;
  top3Asins: string;
  aiTags: string[]; // 人群词、场景词、品牌词、尺寸词、数量词、颜色词、材质词、功能词
}

export const parseKeywords = async (file: File): Promise<Keyword[]> => {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

  const keywords: Keyword[] = [];
  if (rows.length < 2) return keywords;

  const header = rows[0];
  const idx = {
    keyword: findCol(header, ['关键词', 'keyword'], 0),
    translation: findCol(header, ['翻译', 'translation'], 1),
    wordTag: findCol(header, ['词标签', 'word tag'], 2),
    matchType: findCol(header, ['匹配方式', 'match type'], 3),
    relevanceTier: findCol(header, ['相关性档位', 'relevance tier'], 4),
    rank: findCol(header, ['关键词排名', 'rank'], 5),
    weeklySearchVolume: findCol(header, ['周搜索量', 'weekly search volume', 'search volume'], 6),
    cpcBid: findCol(header, ['CPC建议竞价', 'suggested bid'], 7),
    cpcBidRange: findCol(header, ['建议竞价范围', 'bid range'], 8),
    conversionRate: findCol(header, ['点击转化率', 'conversion rate'], 9),
    difficulty: findCol(header, ['竞争难度', 'difficulty'], 10),
    difficultyTier: findCol(header, ['竞争难度档位', 'difficulty tier'], 11),
    organicScrollRate: findCol(header, ['自然位滚动率', 'scroll rate'], 12),
    top3ClickShare: findCol(header, ['Top3 点击份额', 'top3 click share'], 13),
    top3ConversionShare: findCol(header, ['Top3 转化份额', 'top3 conversion share'], 14),
    top3Asins: findCol(header, ['Top3 ASIN'], 15),
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[idx.keyword]) continue;

    keywords.push({
      id: Math.random().toString(36).substr(2, 9),
      keyword: String(row[idx.keyword] || ''),
      translation: String(row[idx.translation] || ''),
      wordTag: String(row[idx.wordTag] || ''),
      matchType: String(row[idx.matchType] || ''),
      relevanceTier: String(row[idx.relevanceTier] || ''),
      rank: Number(row[idx.rank]) || 0,
      weeklySearchVolume: Number(row[idx.weeklySearchVolume]) || 0,
      cpcBid: Number(row[idx.cpcBid]) || 0,
      cpcBidRange: String(row[idx.cpcBidRange] || ''),
      conversionRate: Number(row[idx.conversionRate]) || 0,
      difficulty: Number(row[idx.difficulty]) || 0,
      difficultyTier: String(row[idx.difficultyTier] || ''),
      organicScrollRate: Number(row[idx.organicScrollRate]) || 0,
      top3ClickShare: Number(row[idx.top3ClickShare]) || 0,
      top3ConversionShare: Number(row[idx.top3ConversionShare]) || 0,
      top3Asins: String(row[idx.top3Asins] || ''),
      aiTags: [],
    });
  }
  return keywords;
};

export const parseHistory = async (file: File): Promise<{ history: HistoryRecord[], months: string[] }> => {
  const workbook = await readWorkbook(file);

  console.log('[parseHistory] All sheets:', workbook.SheetNames);

  // Exact sheet names as specified
  const SALES_SHEET_NAMES = ['产品历史月销量', '历史月销量', 'monthly sales', 'sales'];
  const REVENUE_SHEET_NAMES = ['历史月销售额', '产品历史月销售额', '月销售额', 'monthly revenue', 'revenue'];

  const findSheetName = (candidates: string[]) => {
    // Exact match first
    for (const name of candidates) {
      if (workbook.SheetNames.includes(name)) return name;
    }
    // Partial match
    for (const name of candidates) {
      const found = workbook.SheetNames.find(n => n.includes(name) || name.includes(n));
      if (found) return found;
    }
    return null;
  };

  const salesSheetName = findSheetName(SALES_SHEET_NAMES) || workbook.SheetNames[0];
  const revenueSheetName = findSheetName(REVENUE_SHEET_NAMES) || workbook.SheetNames[1];

  console.log('[parseHistory] salesSheet:', salesSheetName, '| revenueSheet:', revenueSheetName);

  const salesRows: any[][] = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[salesSheetName], { header: 1 });
  const revenueRows: any[][] = revenueSheetName && workbook.Sheets[revenueSheetName]
    ? XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[revenueSheetName], { header: 1 })
    : [];

  // Helper: convert Excel serial date number to YYYY-MM string
  const excelDateToYYYYMM = (serial: number): string | null => {
    if (serial < 10000 || serial > 99999) return null; // Not a plausible date serial
    try {
      // Excel epoch is Jan 1, 1900 (with leap year bug)
      const date = new Date((serial - 25569) * 86400 * 1000);
      if (isNaN(date.getTime())) return null;
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth() + 1;
      if (y < 2000 || y > 2100) return null;
      return `${y}-${String(m).padStart(2, '0')}`;
    } catch { return null; }
  };

  const normalizeMonthCell = (cell: any): string | null => {
    if (cell === null || cell === undefined) return null;
    // If it's a number, try Excel serial date
    if (typeof cell === 'number') {
      return excelDateToYYYYMM(cell);
    }
    const s = String(cell).trim();
    if (!s) return null;
    // Already YYYY-MM format
    if (s.match(/^\d{4}[-/]\d{1,2}$/)) return s.replace('/', '-');
    // MM/YYYY
    if (s.match(/^\d{1,2}[-/]\d{4}$/)) {
      const [m, y] = s.split(/[-/]/);
      return `${y}-${m.padStart(2, '0')}`;
    }
    // YY-MM
    if (s.match(/^\d{2}[-/]\d{2}$/)) {
      const [y, m] = s.split(/[-/]/);
      return `20${y}-${m.padStart(2, '0')}`;
    }
    // Jan 2024
    if (s.match(/^[A-Za-z]{3}[- ]\d{4}$/)) {
      const months: Record<string, string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const parts = s.split(/[- ]/);
      const mo = months[parts[0].toLowerCase()];
      if (mo) return `${parts[1]}-${mo}`;
    }
    // 2024年1月
    const m1 = s.match(/^(\d{4})年(\d{1,2})月$/);
    if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}`;
    // 2024Q1 → 2024-01
    const m2 = s.match(/^(\d{4})Q([1-4])$/);
    if (m2) return `${m2[1]}-${String((parseInt(m2[2])-1)*3+1).padStart(2,'0')}`;
    return null;
  };

  const months: string[] = [];
  let asinColIdx = 1;
  let dataStartIdx = 2;

  if (salesRows.length > 0) {
    const headerRowIdx = findHeaderRow(salesRows, ['asin', 'sku', '202', '201', '产品']);
    const header = salesRows[headerRowIdx];

    console.log('[parseHistory] Sales header row idx:', headerRowIdx, '| header:', header?.slice(0, 10));

    asinColIdx = findCol(header, ['asin'], 1);

    // Find the first date column using normalizeMonthCell
    for (let i = 0; i < header.length; i++) {
      const normalized = normalizeMonthCell(header[i]);
      if (normalized) {
        dataStartIdx = i;
        break;
      }
    }

    for (let i = dataStartIdx; i < header.length; i++) {
      const normalized = normalizeMonthCell(header[i]);
      if (normalized) {
        months.push(normalized);
      } else if (months.length > 0) {
        // Stop at first non-date cell after we've started collecting months
        break;
      }
    }

    console.log('[parseHistory] asinColIdx:', asinColIdx, '| dataStartIdx:', dataStartIdx, '| raw header[dataStartIdx]:', header[dataStartIdx], '| months:', months.slice(0, 5), '... total:', months.length);
  }

  /** 销量表：月份列与 months 数组下标连续；销售额表：按表头月份文字映射列，避免两表空列/顺序不一致时读错 */
  const salesMonthCols = months.map((_, k) => dataStartIdx + k);

  let revenueReadSpec: { asinColIdx: number; monthCols: number[] } | null = null;
  if (revenueRows.length > 0) {
    const revHeaderRowIdx = findHeaderRow(revenueRows, ['asin', 'sku', '202', '201', '产品']);
    const revHeader = revenueRows[revHeaderRowIdx] || [];
    const revAsinCol = findCol(revHeader, ['asin'], 1);
    const revMonthToCol = new Map<string, number>();
    for (let i = 0; i < revHeader.length; i++) {
      const normalized = normalizeMonthCell(revHeader[i]);
      if (normalized) revMonthToCol.set(normalized, i);
    }
    const revMonthCols = months.map((m) => revMonthToCol.get(m) ?? -1);
    revenueReadSpec = { asinColIdx: revAsinCol, monthCols: revMonthCols };
    console.log('[parseHistory] revenue month column map (first 5):', revMonthCols.slice(0, 5));
  }

  const historyMap = new Map<string, HistoryRecord>();

  const processSheet = async (
    rows: any[][],
    type: 'sales' | 'revenue',
    readSpec: { asinColIdx: number; monthCols: number[] }
  ) => {
    if (rows.length === 0) return;
    const headerRowIdx = findHeaderRow(rows, ['asin', 'sku', '202', '201', '产品']);
    const CHUNK_SIZE = 500;
    let processed = 0;
    for (let i = headerRowIdx + 1; i < rows.length; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE, rows.length);
      for (let j = i; j < end; j++) {
        const row = rows[j];
        if (!row) continue;
        const asinRaw = row[readSpec.asinColIdx];
        if (!asinRaw) continue;
        const asin = String(asinRaw).trim();
        if (!asin || asin.toLowerCase() === 'asin' || asin.length < 3) continue;

        if (!historyMap.has(asin)) {
          historyMap.set(asin, { asin, history: {} });
        }
        const record = historyMap.get(asin)!;

        for (let k = 0; k < months.length; k++) {
          const month = months[k];
          const col = readSpec.monthCols[k];
          if (col < 0) continue;
          const val = parseNumber(row[col]);
          if (!record.history[month]) {
            record.history[month] = { sales: 0, revenue: 0, price: 0 };
          }
          record.history[month][type] = val;
        }
        processed++;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    console.log(`[parseHistory] ${type}: processed ${processed} rows`);
  };

  await processSheet(salesRows, 'sales', { asinColIdx, monthCols: salesMonthCols });
  if (revenueReadSpec) {
    await processSheet(revenueRows, 'revenue', revenueReadSpec);
  }

  // Derive price from revenue/sales
  historyMap.forEach(record => {
    Object.keys(record.history).forEach(month => {
      const h = record.history[month];
      if (h.price === 0 && h.sales > 0 && h.revenue > 0) {
        h.price = h.revenue / h.sales;
      }
    });
  });

  months.sort((a, b) => a.localeCompare(b));

  console.log('[parseHistory] Total ASINs parsed:', historyMap.size);

  // Sample check
  const firstEntry = historyMap.values().next().value;
  if (firstEntry && months.length > 0) {
    const lastMonth = months[months.length - 1];
    console.log('[parseHistory] Sample ASIN:', firstEntry.asin, '| last month data:', firstEntry.history[lastMonth]);
  }

  return {
    history: Array.from(historyMap.values()),
    months
  };
};

/** 根据当前市场与细分数据生成短指纹，用于判断市场分析报告是否与数据一致、可否复用缓存 */
export function computeMarketReportFingerprint(
  products: Product[],
  segments: string[],
  asinToSegment: Record<string, string>,
  segmentDescriptions: Record<string, { people: string; scenarios: string; needs: string }>
): string {
  const rows = [...products]
    .sort((a, b) => a.asin.localeCompare(b.asin))
    .map(
      (p) =>
        `${p.asin}\t${p.title}\t${p.brand}\t${p.price}\t${p.rating}\t${p.monthlySales}\t${p.monthlyRevenue}`
    );
  const segKey = JSON.stringify([...segments].sort());
  const sortedAsins = Object.keys(asinToSegment).sort();
  const mapNorm = sortedAsins.reduce<Record<string, string>>((o, k) => {
    o[k] = asinToSegment[k];
    return o;
  }, {});
  const raw = `${rows.join('\n')}|${segKey}|${JSON.stringify(mapNorm)}|${JSON.stringify(segmentDescriptions)}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

