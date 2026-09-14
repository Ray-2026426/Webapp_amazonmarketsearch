import type { Product } from './parser';

// Currency utility based on marketplace domain.
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

/** 销售额等金额：取整后显示（带站点货币符号） */
export function formatRevenue(value: number, domain = 'amazon.com'): string {
  return `${getCurrencySymbol(domain)}${Math.round(value).toLocaleString()}`;
}

export function computeMarketReportFingerprint(
  products: Product[],
  segments: string[],
  asinToSegment: Record<string, string>,
  segmentDescriptions: Record<string, { people: string; scenarios: string; needs: string }>,
  segmentChildren: Record<string, string[]> = {},
  asinToSubSegment: Record<string, string> = {},
  segmentSubDescriptions: Record<string, { people: string; scenarios: string; needs: string }> = {},
  segmentLevel3Children: Record<string, string[]> = {},
  asinToLevel3Segment: Record<string, string> = {},
  segmentLevel3Descriptions: Record<string, { people: string; scenarios: string; needs: string }> = {},
  segmentDepth: 1 | 2 | 3 = 1
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
  const childNorm = Object.keys(segmentChildren).sort().reduce<Record<string, string[]>>((o, k) => {
    o[k] = [...(segmentChildren[k] || [])].sort();
    return o;
  }, {});
  const sortedSubAsins = Object.keys(asinToSubSegment).sort();
  const subMapNorm = sortedSubAsins.reduce<Record<string, string>>((o, k) => {
    o[k] = asinToSubSegment[k];
    return o;
  }, {});
  const l3ChildNorm = Object.keys(segmentLevel3Children).sort().reduce<Record<string, string[]>>((o, k) => {
    o[k] = [...(segmentLevel3Children[k] || [])].sort();
    return o;
  }, {});
  const sortedL3Asins = Object.keys(asinToLevel3Segment).sort();
  const l3MapNorm = sortedL3Asins.reduce<Record<string, string>>((o, k) => {
    o[k] = asinToLevel3Segment[k];
    return o;
  }, {});
  const raw = `${rows.join('\n')}|${segKey}|${JSON.stringify(mapNorm)}|${JSON.stringify(segmentDescriptions)}|${JSON.stringify(childNorm)}|${JSON.stringify(subMapNorm)}|${JSON.stringify(segmentSubDescriptions)}|${segmentDepth}|${JSON.stringify(l3ChildNorm)}|${JSON.stringify(l3MapNorm)}|${JSON.stringify(segmentLevel3Descriptions)}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
