/**
 * 演示数据：Huhu Sleep · 美国站薄枕头（Bed Pillows）
 *
 * 数据来自卖家精灵（SellerSprite）真实抓取（ASIN 详情 / ABA 关键词 / 评论），
 * 用于产品演示：市场大盘、关键词分析、用户洞察、竞品分析可直接展示。
 * 请勿当作实时库存或实时排名来源。
 */

import type {
  Product,
  HistoryRecord,
  Keyword,
  Review,
  UserIntentStage,
  JobType,
  DemandTrend,
} from './parser';
import type { AsinDetailSnapshot } from './sellerspriteApi';

export const DEMO_DATA_VERSION = 'huhu-thin-pillow-v4';

export interface CompetitorDemoSnapshot {
  selectedAsins: string[];
  packs: Record<
    string,
    {
      zipName: string;
      /** Amazon CDN https 图，不要 blob */
      mainPreviewUrls: string[];
      aplusCount: number;
      bulletPoints: string;
    }
  >;
  details: AsinDetailSnapshot[];
  /** 示例预置的竞品 AI 综合报告 HTML（演示用，非实时生成） */
  aiReportHtml?: string;
}

/** 市场大盘 AI 报告（Markdown，演示样例） */
export const DEMO_MARKET_REPORT_MD = `# 美国站薄枕头（Bed Pillows）市场洞察报告（示例）

> 本报告为演示样例，基于示例 ASIN 池生成，便于展示 Kairo 的「一键报告」能力。

## 1. 市场一句话判断

薄枕头不是「矮一点的普通枕」，而是**侧睡/趴睡颈椎诉求**驱动的细分赛道：买家用搜索与评论反复确认「厚度是否够薄、会不会顶脖子、盖子能不能洗」。头部品牌靠**多厚度矩阵 + 长期评价沉淀**占位，新品牌机会在**更清晰的高度表达、凉感与可洗体验叙事**。

## 2. 规模与格局（示例解读）

| 观察点 | 结论 |
| --- | --- |
| 需求稳定性 | ABA 与大盘销量显示「thin / flat / stomach sleeper」相关需求持续存在 |
| 价格带 | 约 $20–$45 为主战场；过低易被质疑支撑力，过高需证明材质与耐久 |
| 头部打法 | Bluewave 等以多 loft 规格覆盖不同睡姿；评价池是护城河 |
| 新品窗口 | 标题/主图把「精确高度（英寸）」做成可扫一眼的卖点，仍有转化空间 |

## 3. 用户要完成的任务（JTBD）

1. **睡姿匹配**：找到不会把颈椎顶高的薄枕（趴睡/仰睡/偏薄侧睡）。
2. **长期舒适**：凉感、不塌陷、可机洗套，减少「买了又退」的试错成本。
3. **规格可信**：看懂 1.75" / 2.5" / 2.75" 差异，避免「看起来薄、到手偏厚」。

## 4. 机会与风险

**机会**
- 把高度做成可视化对比（主图尺子/人体侧睡示意），降低决策摩擦。
- 针对偏硬记忆棉投诉，强化「适度回弹 / 凉感凝胶」差异化。
- A+ 用「睡姿 → 推荐高度」路径图，承接关键词意图。

**风险**
- 厚度体感因个体差异大，差评集中在「太硬 / 不如预期薄」。
- 真空压缩开箱体验差，需在 Listing 明确「开箱膨松步骤」。

## 5. 给运营的下一步（可执行）

1. 大盘锁定 3–5 个对标 ASIN，做 Listing + 流量词对照（示例竞品页已预置）。
2. 关键词侧优先承接 \`thin pillow\` / \`stomach sleeper pillow\` 决策期词，并补齐场景词。
3. 评论侧盯「厚度预期差、硬度、凉感」三类标签，反哺五点与主图 Brief。
`;

/** 关键词模块「AI 用户洞察报告」结构（演示样例） */
export const DEMO_KEYWORD_AI_INSIGHT = {
  userPersona:
    '25–45 岁北美用户，多为趴睡或希望更低枕头高度的仰睡者；决策者多为本人。常有颈椎不适或「酒店枕头太高」经历，愿意为明确英寸高度与可洗套支付溢价，但会仔细核对真实厚度与软硬度。',
  userScenes: ['日常卧室睡眠', '旅行替代酒店高枕', '夏季需要更凉的薄枕', '旧枕塌陷后更换'],
  userNeeds: ['精确可控的高度', '不顶脖子的睡姿匹配', '凉感与可机洗', '开箱后易恢复膨松'],
  userPainPoints: ['到手比想象厚/硬', '记忆棉闷热', '真空包装开箱难膨松', '标称多睡姿但侧睡支撑不够'],
  decisionStages: [
    { name: '认知', desc: '发现枕头太高或不适，搜 thin / flat / for neck pain 确认有没有更薄方案。', signals: 'thin pillow、flat pillow、neck pain' },
    { name: '考虑', desc: '对比主图真实厚度、评测与差评里的体感，筛睡姿与材质。', signals: 'best thin pillow、memory foam vs down、reviews' },
    { name: '决策', desc: '锁英寸高度与睡姿标签，看凉感、可洗、退货相关评价后下单。', signals: 'stomach sleeper pillow、2.5 inch、cooling' },
    { name: '使用', desc: '开箱膨松与第一周睡眠决定留评或退货，厚度预期差是主因。', signals: 'too thick、too firm、doesn’t loft' },
  ],
  decisionSummary:
    '用户从痛点词进入，在对比页用主图厚度与评价体感做筛选，决策期落到睡姿+英寸规格；开箱与首次使用决定是否退货。广告应承接决策期词，详情页用高度对比缩短路径。',
  insightAnalysis:
    '搜索结构显示：认知期看 thin/flat，决策期落到 stomach sleeper / 精确英寸。市场不缺流量词，缺的是把高度与睡姿讲清楚的 Listing 表达。痛点高度集中在「预期厚度差」——这既是退货源，也是差异化切口。产品侧应先做「趴睡薄枕」单点打透，再用高度变体铺矩阵，而不是一上来做全睡姿通用款。',
  listingPlan: {
    title: '前置精确高度 + 睡姿（如 2.5" Stomach Sleeper Thin Pillow）',
    bullets: [
      '高度可视化：英寸数字 + 尺子对照，降低「太厚」预期差',
      '睡姿匹配：明确趴睡/薄仰睡，避免「全睡姿」空话',
      '凉感与可洗套：对应评论高频加分项，写进第三、四点',
    ],
    keywords: '核心：stomach sleeper pillow / thin pillow；长尾：2.5 inch、cooling；防御：品牌词与替换词',
    visual: '主图1 高度尺子；主图2 睡姿侧切；主图3 开箱膨松步骤。A+ 放「选高度指南」降低误买。',
  },
  productPlan: {
    core: '2.5"–2.75" 薄枕为主推，记忆棉或可水洗填充，可拆洗套',
    differentiation: '睡姿×高度可视化，而不是再堆「骨科/豪华」形容词',
    priceRange: '锚定对标中位价，用高度变体做价格带而非盲目低价',
    mustFix: ['标题与主图必须出现真实英寸', '开箱膨松步骤写进 Listing，避免真空压缩差评'],
    parentStructure: {
      summary: '建议一个父体按「高度英寸」做主轴变体，先打透趴睡薄枕，再补尺寸与凉感升级，避免一上来铺全睡姿。',
      variants: [
        { name: '2.5" Standard 主推', role: '流量锚点', priority: 'P0', rationale: '决策期词与评论痛点最集中，先验证厚度预期管理' },
        { name: '2.75" Standard', role: '利润/扩展款', priority: 'P1', rationale: '承接略高仰睡需求，拉开价格带' },
        { name: 'King 同高度', role: '矩阵补齐', priority: 'P2', rationale: '大床用户补齐，不抢主推流量词' },
      ],
    },
  },
  productRoadmap: [
    { phase: 'P1', name: '趴睡薄枕主推款', target: '趴睡与低枕仰睡用户', priority: '高', rationale: '先用单规格验证「高度可视化」能否降退货、提转化' },
    { phase: 'P2', name: '精确高度变体矩阵', target: '用英寸筛选的决策期用户', priority: '高', rationale: '主推成立后再铺 2–3 个高度，形成父体矩阵' },
    { phase: 'P3', name: '凉感可洗套升级款', target: '夏季与敏感睡眠用户', priority: '中', rationale: '在矩阵稳定后用材质升级抬客单，不宜过早分流广告预算' },
  ],
};

/** 用户洞察：人群/场景/需求三段（演示样例） */
export const DEMO_PERSONA = {
  people:
    '趴睡与偏薄仰睡用户为主，兼有偏矮侧睡者；关注颈椎舒适，习惯在评价里核对真实厚度。',
  scenarios:
    '日常卧室睡眠、旅行替代酒店高枕、夏季需要更凉的薄枕、长期使用后更换塌陷旧枕。',
  needs:
    '精确可控的高度、不顶脖子、凉感与可机洗、开箱后易恢复、规格选择不踩坑。',
};

/** 用户洞察「深度报告」HTML（演示样例） */
export const DEMO_VOC_DEEP_REPORT_HTML = `<div style="font-family:system-ui,sans-serif;line-height:1.65;color:#1d1d1f">
  <h2 style="margin:0 0 12px;font-size:20px">薄枕头 VOC 深度洞察（示例报告）</h2>
  <p style="color:#86868b;margin:0 0 20px;font-size:13px">基于示例评论池生成，仅用于产品演示，非实时抓取结论。</p>
  <h3 style="font-size:16px;margin:20px 0 8px">一、总体情绪</h3>
  <p>好评集中在「终于找到够薄的枕」「脖子不那么酸」「凉感明显」；差评集中在「比预期硬/厚」「不适合侧睡」「记忆棉体感闷」。整体是<strong>高度预期管理</strong>问题，多于材质本身失效。</p>
  <h3 style="font-size:16px;margin:20px 0 8px">二、高频痛点（可进 Listing）</h3>
  <ol>
    <li><strong>厚度预期差</strong>：广告说 ultra slim，体感仍偏高或偏硬。</li>
    <li><strong>睡姿错配</strong>：侧睡用户买到偏薄规格后支撑不足。</li>
    <li><strong>开箱体验</strong>：真空压缩需膨松说明不到位。</li>
  </ol>
  <h3 style="font-size:16px;margin:20px 0 8px">三、可复制的好评点</h3>
  <ul>
    <li>精确英寸高度（1.75" / 2.5" / 2.75"）带来「买对了」感</li>
    <li>可拆洗套与凉感，提高长期使用满意度</li>
    <li>多规格矩阵降低「一家品牌买错」成本</li>
  </ul>
  <h3 style="font-size:16px;margin:20px 0 8px">四、行动建议</h3>
  <p>主图强化尺子对比；五点写清「推荐睡姿 × 高度」；评论区置顶「开箱膨松」图文；变体命名避免模糊的 soft/firm，改用英寸。</p>
</div>`;

/** 竞品 AI 综合报告 HTML（演示样例） */
export const DEMO_COMPETITOR_AI_HTML = `<div style="font-family:system-ui,sans-serif;line-height:1.65;color:#1d1d1f">
  <h2 style="margin:0 0 8px;font-size:20px">竞品综合对比报告（示例）</h2>
  <p style="color:#86868b;font-size:13px;margin:0 0 18px">对比 ASIN：Huhu Sleep / Bluewave / Iwacool · 演示样例</p>
  <h3 style="font-size:16px">1. Listing 结构对比</h3>
  <p><strong>Bluewave</strong>：评价池与多 loft 矩阵最强，五点强调密度与可洗套，价格带偏高。<strong>Huhu</strong>：可用「更清晰的高度可视化 + 睡姿指南」打差异。<strong>Iwacool</strong>：需看流量词是否过度依赖广告。</p>
  <h3 style="font-size:16px">2. 流量词启示</h3>
  <p>自然流量应优先稳住 thin pillow / stomach sleeper 决策词；广告侧测试精确高度词与竞品品牌防御词。避免只堆 soft pillow 等宽泛词导致转化稀释。</p>
  <h3 style="font-size:16px">3. 产品矩阵建议</h3>
  <p>父体建议覆盖 1.75"–3.25" 关键档位；主推图放在中位高度（如 2.5"–2.75"），用 A+「选高度」降低退货。同品牌其他链接在大盘中可作流量承接，不宜互相抢同一主图故事。</p>
  <h3 style="font-size:16px">4. 可落地动作（本周）</h3>
  <ul>
    <li>对标 Bluewave 主图信息密度，补「尺子 + 睡姿」两张图</li>
    <li>五点第一句写清推荐高度与睡姿，避免空泛舒适话术</li>
    <li>抽 20 条差评做「预期差」归因，反哺标题禁用词</li>
  </ul>
</div>`;

const months = ['202601', '202602', '202603', '202604', '202605', '202606', '202607'] as const;

const TOP3 =
  'B06XPMNP76,B0CBG2T9L1,B0C2KPM8N5';

// ─── Products（约 12 个真实 ASIN）───────────────────────────────────────────

const DEMO_PRODUCTS: Product[] = [
  {
    asin: 'B06XPMNP76',
    sku: 'BW-2.75-STD',
    brand: 'Bluewave Bedding',
    title:
      'Bluewave Bedding Ultra Slim Gel Memory Foam Pillow for Stomach and Back Sleepers - Thin, Flat Design for Cervical Neck Alignment and Deeper Sleep (2.75-Inches Height, Standard Size)',
    image: 'https://m.media-amazon.com/images/I/31lQHUUgWnL._AC_US200_.jpg',
    monthlySales: 2000,
    monthlyRevenue: 79900,
    price: 39.95,
    rating: 4.5,
    reviewCount: 7484,
    reviewGrowth: 42,
    sellerCount: 2,
    weight: 2.7,
    volume: 18026,
    launchDate: '201801',
    daysSinceLaunch: 2800,
    buyBoxType: 'FBA',
    sellerLocation: 'US',
    fbaFee: 7.48,
    subBsr: 34,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0CBG2T9L1',
    sku: 'MINU-2.5-STD',
    brand: 'MINUPWELL',
    title:
      'MINUPWELL Ultra Flat Pillows for Sleeping Thin, 7D High Support 2.5 inch Height Ultra Thin Pillows,Slim Bed Pillows for Stomach Sleeper,Standard Size -18x26 in',
    image: 'https://m.media-amazon.com/images/I/31l-P7jZeLL._AC_US200_.jpg',
    monthlySales: 1000,
    monthlyRevenue: 20860,
    price: 20.86,
    rating: 4.4,
    reviewCount: 1383,
    reviewGrowth: 28,
    sellerCount: 1,
    weight: 1.7,
    volume: 19170,
    launchDate: '202307',
    daysSinceLaunch: 1130,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 6.9,
    subBsr: 52,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0C2KPM8N5',
    sku: 'IWA-2.25-STD',
    brand: 'Iwacool',
    title:
      'Thin Pillow for Sleeping, Cooling Gel Flat Pillow for Stomach and Back Sleepers, Ultra Slim Stomach Sleeping Pillows for Shoulder Neck Pain Relief, Low Profile Memory Foam Pillows 2.25-inches',
    image: 'https://m.media-amazon.com/images/I/51GMVwPxFuL._AC_US200_.jpg',
    monthlySales: 1000,
    monthlyRevenue: 26990,
    price: 26.99,
    rating: 4.2,
    reviewCount: 1269,
    reviewGrowth: 35,
    sellerCount: 1,
    weight: 1.78,
    volume: 13680,
    launchDate: '202304',
    daysSinceLaunch: 1220,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 7.3,
    subBsr: 56,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B07XBBZKHC',
    sku: 'DLIGHT-THIN',
    brand: 'DLIGHT BD',
    title: 'DLIGHT BD Thin Flat Pillow for Sleeping Low Profile Memory Foam Pillow Soft Support',
    image: 'https://m.media-amazon.com/images/I/31Fq1Wvi7VL._AC_US200_.jpg',
    monthlySales: 800,
    monthlyRevenue: 21592,
    price: 26.99,
    rating: 4.4,
    reviewCount: 1602,
    reviewGrowth: 18,
    sellerCount: 1,
    weight: 1.5,
    volume: 14500,
    launchDate: '201909',
    daysSinceLaunch: 2520,
    buyBoxType: 'FBA',
    sellerLocation: 'US',
    fbaFee: 7.1,
    subBsr: 192,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DTK192RD',
    sku: 'BIGP-THIN',
    brand: 'bigpawl',
    title: 'bigpawl Ultra Thin Flat Pillow Low Profile Soft Pillow for Stomach Sleepers',
    image: 'https://m.media-amazon.com/images/I/41Zzkvk-7iL._AC_US200_.jpg',
    monthlySales: 350,
    monthlyRevenue: 6997,
    price: 19.99,
    rating: 4.3,
    reviewCount: 119,
    reviewGrowth: 12,
    sellerCount: 1,
    weight: 1.2,
    volume: 12000,
    launchDate: '202501',
    daysSinceLaunch: 220,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 6.2,
    subBsr: 391,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0FV824N9N',
    sku: 'HCORE-THIN',
    brand: 'Hcore',
    title: 'Hcore Thin Memory Foam Pillow Low Profile Cooling Pillow for Sleeping',
    image: 'https://m.media-amazon.com/images/I/31+K+pazFzL._AC_US200_.jpg',
    monthlySales: 280,
    monthlyRevenue: 8397,
    price: 29.99,
    rating: 4.5,
    reviewCount: 576,
    reviewGrowth: 22,
    sellerCount: 1,
    weight: 1.6,
    volume: 15000,
    launchDate: '202409',
    daysSinceLaunch: 340,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 7.0,
    subBsr: 942,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0FH4SBYH4',
    sku: 'HUHU-2.75-STD',
    brand: 'Huhu Sleep',
    title:
      'Thin Memory Foam Pillow for Stomach Sleepers - 2.75 Inch Low Profile Flat Pillows for Sleeping, Slim Odorless Foam Pillow and Case with 37% Rayon derived from Bamboo, Standard Size',
    image: 'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US200_.jpg',
    monthlySales: 40,
    monthlyRevenue: 1999,
    price: 49.97,
    rating: 4.1,
    reviewCount: 33,
    reviewGrowth: 8,
    sellerCount: 1,
    weight: 2.0,
    volume: 17280,
    launchDate: '202507',
    daysSinceLaunch: 400,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 9.37,
    subBsr: 698,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0GHMGQLP7',
    sku: 'HUHU-KG-1.75',
    brand: 'Huhu Sleep',
    title: 'Huhu Sleep Thin Memory Foam Pillow King Size 1.75 Inch Ultra Low Profile',
    image: 'https://m.media-amazon.com/images/I/31i1S8k4oiL._AC_US200_.jpg',
    monthlySales: 25,
    monthlyRevenue: 1150,
    price: 45.99,
    rating: 4.1,
    reviewCount: 32,
    reviewGrowth: 5,
    sellerCount: 1,
    weight: 2.2,
    volume: 20000,
    launchDate: '202509',
    daysSinceLaunch: 320,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 9.5,
    subBsr: 757,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0FH4X1WD8',
    sku: 'HUHU-2.25-STD',
    brand: 'Huhu Sleep',
    title: 'Huhu Sleep Thin Memory Foam Pillow 2.25 Inch Low Profile Flat Pillow Standard Size',
    image: 'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US200_.jpg',
    monthlySales: 20,
    monthlyRevenue: 919,
    price: 45.97,
    rating: 4.1,
    reviewCount: 33,
    reviewGrowth: 6,
    sellerCount: 1,
    weight: 1.9,
    volume: 16000,
    launchDate: '202507',
    daysSinceLaunch: 400,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 9.1,
    subBsr: 598,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0GHN26WX5',
    sku: 'HUHU-1.75-STD',
    brand: 'Huhu Sleep',
    title: 'Huhu Sleep Thin Memory Foam Pillow 1.75 Inch Ultra Slim Standard Size',
    image: 'https://m.media-amazon.com/images/I/31i1S8k4oiL._AC_US200_.jpg',
    monthlySales: 15,
    monthlyRevenue: 645,
    price: 43.0,
    rating: 4.1,
    reviewCount: 33,
    reviewGrowth: 4,
    sellerCount: 1,
    weight: 1.7,
    volume: 14000,
    launchDate: '202509',
    daysSinceLaunch: 320,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 8.9,
    subBsr: 900,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0FLK26CR3',
    sku: 'TUOZ-THIN',
    brand: 'Tuozaiira',
    title: 'Tuozaiira Thin Flat Pillow for Sleeping Soft Low Profile Bed Pillow',
    image: 'https://images-na.ssl-images-amazon.com/images/I/71UKQwceknL._AC_US200_.jpg',
    monthlySales: 220,
    monthlyRevenue: 5936,
    price: 26.98,
    rating: 4.3,
    reviewCount: 93,
    reviewGrowth: 14,
    sellerCount: 1,
    weight: 1.4,
    volume: 13000,
    launchDate: '202410',
    daysSinceLaunch: 310,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 6.8,
    subBsr: 400,
    subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DFYF6T55',
    sku: 'IFAON-THIN',
    brand: 'iFaon',
    title: 'iFaon Ultra Thin Flat Pillow Soft Fiber Pillow for Stomach Sleepers',
    image: 'https://images-na.ssl-images-amazon.com/images/I/515UygRyiSL._AC_US200_.jpg',
    monthlySales: 450,
    monthlyRevenue: 7196,
    price: 15.99,
    rating: 4.3,
    reviewCount: 531,
    reviewGrowth: 26,
    sellerCount: 1,
    weight: 1.1,
    volume: 11000,
    launchDate: '202408',
    daysSinceLaunch: 370,
    buyBoxType: 'FBA',
    sellerLocation: 'CN',
    fbaFee: 5.9,
    subBsr: 280,
    subCategory: 'Bed Pillows',
  },
];

/** 已知子体月销量趋势（确定性，来自卖家精灵近似） */
const SALES_TREND: Record<string, number[]> = {
  B06XPMNP76: [2000, 2000, 2000, 2000, 1000, 2000, 2000],
  B0CBG2T9L1: [2000, 1000, 2000, 2000, 1000, 1000, 1000],
  B0C2KPM8N5: [1000, 1000, 1000, 1000, 800, 1000, 1000],
  B0FH4SBYH4: [50, 50, 35, 25, 20, 30, 40],
};

const PRICE_TREND: Record<string, number[]> = {
  B06XPMNP76: [39.5, 39.5, 39.5, 39.5, 39.5, 39.5, 39.95],
  B0CBG2T9L1: [22.5, 23.0, 22.8, 23.5, 24.0, 21.5, 20.86],
  B0C2KPM8N5: [29.5, 29.9, 29.5, 30.0, 29.0, 29.5, 26.99],
  B0FH4SBYH4: [39.99, 39.99, 42.99, 44.99, 46.99, 48.99, 49.97],
};

/** 确定性平滑波动（不用 Math.random） */
function smoothSeries(base: number, seed: number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const wave = 1 + 0.1 * Math.sin((i + 1) * 1.37 + seed) + 0.05 * Math.cos(i * 0.91 + seed * 0.7);
    out.push(Math.max(5, Math.round(base * wave)));
  }
  return out;
}

function smoothPrices(base: number, seed: number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const wave = 1 + 0.03 * Math.sin(i * 1.1 + seed) - 0.015 * Math.cos(i * 0.6 + seed);
    out.push(Math.round(base * wave * 100) / 100);
  }
  return out;
}

function makeHistory(product: Product, index: number): HistoryRecord {
  const salesArr =
    SALES_TREND[product.asin] ?? smoothSeries(product.monthlySales, index + 1, months.length);
  const priceArr =
    PRICE_TREND[product.asin] ?? smoothPrices(product.price, index + 2, months.length);

  const history: HistoryRecord['history'] = {};
  months.forEach((m, i) => {
    const sales = salesArr[i] ?? product.monthlySales;
    const price = priceArr[i] ?? product.price;
    history[m] = {
      sales,
      price,
      revenue: Math.round(sales * price),
    };
  });
  return { asin: product.asin, history };
}

// ─── Keywords（≥30，含完整洞察字段）─────────────────────────────────────────

type KwSeed = {
  keyword: string;
  translation: string;
  searches: number;
  purchaseRate: number;
  bid: number;
  bidMin: number;
  bidMax: number;
  monopoly: number;
  cvsShare: number;
  wordTag: string;
  relevanceTier: string;
  aiTags: string[];
  userIntentStage: UserIntentStage;
  jobToBeDone: string;
  jobType: JobType;
  useScenario: string;
  targetUser: string;
  painPoint: string;
  featureDemand: string;
  comparisonTarget: string;
  demandTrend: DemandTrend;
};

function difficultyTier(d: number): string {
  if (d < 30) return '低';
  if (d < 50) return '中';
  return '高';
}

function mkKeyword(seed: KwSeed, rank: number): Keyword {
  const weekly = Math.round(seed.searches / 4.3);
  const difficulty = Math.min(100, Math.max(0, Math.round(seed.monopoly * 100)));
  const bidRange =
    seed.bidMin > 0 || seed.bidMax > 0
      ? `${seed.bidMin.toFixed(2)}-${seed.bidMax.toFixed(2)}`
      : seed.bid > 0
        ? `${(seed.bid * 0.75).toFixed(2)}-${(seed.bid * 1.25).toFixed(2)}`
        : '0.80-1.60';
  return {
    id: `kw-huhu-${String(rank).padStart(2, '0')}`,
    keyword: seed.keyword,
    translation: seed.translation,
    wordTag: seed.wordTag,
    matchType: '广泛',
    relevanceTier: seed.relevanceTier,
    rank,
    weeklySearchVolume: weekly,
    cpcBid: seed.bid,
    cpcBidRange: bidRange,
    conversionRate: seed.purchaseRate,
    difficulty,
    difficultyTier: difficultyTier(difficulty),
    organicScrollRate: Math.round((0.35 + (seed.monopoly % 0.2)) * 100) / 100,
    top3ClickShare: seed.monopoly,
    top3ConversionShare: seed.cvsShare,
    top3Asins: TOP3,
    aiTags: seed.aiTags,
    userIntentStage: seed.userIntentStage,
    jobToBeDone: seed.jobToBeDone,
    jobType: seed.jobType,
    useScenario: seed.useScenario,
    targetUser: seed.targetUser,
    painPoint: seed.painPoint,
    featureDemand: seed.featureDemand,
    comparisonTarget: seed.comparisonTarget,
    demandTrend: seed.demandTrend,
  };
}

/** ABA 2026.07 真实搜索量 + 洞察标注（游客无需点 AI 即可看四个 Tab） */
const KW_SEEDS: KwSeed[] = [
  {
    keyword: 'thin pillow',
    translation: '薄枕头',
    searches: 22111,
    purchaseRate: 0.0364,
    bid: 1.78,
    bidMin: 1.24,
    bidMax: 2.52,
    monopoly: 0.3481,
    cvsShare: 0.1777,
    wordTag: '核心词',
    relevanceTier: '高相关',
    aiTags: ['功能词', '尺寸词'],
    userIntentStage: 'consideration',
    jobToBeDone: '找到够薄的枕头',
    jobType: 'functional',
    useScenario: '日常睡眠',
    targetUser: '趴睡/仰睡者',
    painPoint: '普通枕头太厚压脖子',
    featureDemand: '低高度/薄型',
    comparisonTarget: '普通酒店枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'thin pillow for sleeping',
    translation: '睡觉用的薄枕头',
    searches: 13803,
    purchaseRate: 0.0436,
    bid: 1.73,
    bidMin: 1.54,
    bidMax: 2.16,
    monopoly: 0.3524,
    cvsShare: 0.2225,
    wordTag: '场景词',
    relevanceTier: '高相关',
    aiTags: ['场景词', '功能词'],
    userIntentStage: 'consideration',
    jobToBeDone: '改善夜间睡眠姿势',
    jobType: 'functional',
    useScenario: '夜间睡眠',
    targetUser: '成人睡眠者',
    painPoint: '枕头过高导致落枕',
    featureDemand: '睡眠专用薄枕',
    comparisonTarget: '标准厚度枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'flat pillows for sleeping thin',
    translation: '薄睡用扁平枕',
    searches: 4275,
    purchaseRate: 0.0439,
    bid: 1.85,
    bidMin: 1.39,
    bidMax: 2.43,
    monopoly: 0.3215,
    cvsShare: 0.2689,
    wordTag: '长尾词',
    relevanceTier: '高相关',
    aiTags: ['功能词', '尺寸词'],
    userIntentStage: 'decision',
    jobToBeDone: '精确匹配扁平高度',
    jobType: 'functional',
    useScenario: '趴睡',
    targetUser: '趴睡者',
    painPoint: '市面枕头都太鼓',
    featureDemand: '扁平低剖面',
    comparisonTarget: '普通记忆棉枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'thin memory foam pillow',
    translation: '薄记忆海绵枕头',
    searches: 4111,
    purchaseRate: 0.0337,
    bid: 1.41,
    bidMin: 1.13,
    bidMax: 1.75,
    monopoly: 0.5242,
    cvsShare: 0.2765,
    wordTag: '材质词',
    relevanceTier: '高相关',
    aiTags: ['材质词', '功能词'],
    userIntentStage: 'decision',
    jobToBeDone: '选记忆棉薄枕材质',
    jobType: 'functional',
    useScenario: '颈椎支撑睡眠',
    targetUser: '颈椎敏感人群',
    painPoint: '纤维枕易塌陷',
    featureDemand: '记忆棉+薄型',
    comparisonTarget: '纤维填充薄枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'thin pillows',
    translation: '薄枕头（复数）',
    searches: 3759,
    purchaseRate: 0.0364,
    bid: 1.78,
    bidMin: 1.24,
    bidMax: 2.53,
    monopoly: 0.405,
    cvsShare: 0.285,
    wordTag: '核心词',
    relevanceTier: '高相关',
    aiTags: ['功能词'],
    userIntentStage: 'consideration',
    jobToBeDone: '批量寻找薄枕',
    jobType: 'functional',
    useScenario: '家庭更换枕头',
    targetUser: '家庭采购者',
    painPoint: '家里枕头都太厚',
    featureDemand: '薄型床枕',
    comparisonTarget: '套装标准枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'ultra thin pillow',
    translation: '超薄枕头',
    searches: 3489,
    purchaseRate: 0.0329,
    bid: 1.49,
    bidMin: 1.08,
    bidMax: 1.88,
    monopoly: 0.3799,
    cvsShare: 0.1564,
    wordTag: '修饰词',
    relevanceTier: '高相关',
    aiTags: ['尺寸词', '功能词'],
    userIntentStage: 'decision',
    jobToBeDone: '找到极薄高度',
    jobType: 'functional',
    useScenario: '极低高度需求',
    targetUser: '极度趴睡者',
    painPoint: '2.75 寸仍偏厚',
    featureDemand: '1.75–2.25 寸超薄',
    comparisonTarget: '普通 thin pillow',
    demandTrend: 'rising',
  },
  {
    keyword: 'thin body pillow',
    translation: '薄型抱枕/长枕',
    searches: 2303,
    purchaseRate: 0.1256,
    bid: 0.67,
    bidMin: 0.57,
    bidMax: 0.84,
    monopoly: 0.3966,
    cvsShare: 0.1621,
    wordTag: '品类交叉',
    relevanceTier: '中相关',
    aiTags: ['场景词', '功能词'],
    userIntentStage: 'consideration',
    jobToBeDone: '侧身夹抱支撑',
    jobType: 'emotional',
    useScenario: '侧睡夹抱',
    targetUser: '侧睡夹抱者',
    painPoint: '普通抱枕太鼓',
    featureDemand: '细长薄型抱枕',
    comparisonTarget: '标准 body pillow',
    demandTrend: 'stable',
  },
  {
    keyword: 'thin pillow for side sleepers',
    translation: '适合侧睡者的薄枕头',
    searches: 1849,
    purchaseRate: 0.0104,
    bid: 2.56,
    bidMin: 1.88,
    bidMax: 3.06,
    monopoly: 0.3865,
    cvsShare: 0.2069,
    wordTag: '人群词',
    relevanceTier: '中相关',
    aiTags: ['人群词', '场景词'],
    userIntentStage: 'consideration',
    jobToBeDone: '侧睡也想用薄枕',
    jobType: 'functional',
    useScenario: '侧睡',
    targetUser: '身材娇小侧睡者',
    painPoint: '侧睡肩宽与薄枕冲突',
    featureDemand: '可叠放薄枕',
    comparisonTarget: '高 loft 侧睡枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'thin cooling pillow',
    translation: '薄凉感枕头',
    searches: 1708,
    purchaseRate: 0.0274,
    bid: 1.61,
    bidMin: 1.41,
    bidMax: 1.86,
    monopoly: 0.5029,
    cvsShare: 0.268,
    wordTag: '功能词',
    relevanceTier: '高相关',
    aiTags: ['功能词', '材质词'],
    userIntentStage: 'decision',
    jobToBeDone: '薄枕同时降温',
    jobType: 'functional',
    useScenario: '夏季睡眠',
    targetUser: '怕热睡眠者',
    painPoint: '记忆棉闷热',
    featureDemand: '凉感面料+薄型',
    comparisonTarget: '普通记忆棉薄枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'thin king size pillow',
    translation: '超薄特大号枕头',
    searches: 1449,
    purchaseRate: 0.0093,
    bid: 2.75,
    bidMin: 1.87,
    bidMax: 3.62,
    monopoly: 0.3357,
    cvsShare: 0.2435,
    wordTag: '尺寸词',
    relevanceTier: '高相关',
    aiTags: ['尺寸词', '数量词'],
    userIntentStage: 'decision',
    jobToBeDone: '选 King 尺寸薄枕',
    jobType: 'functional',
    useScenario: '大床睡眠',
    targetUser: 'King 床用户',
    painPoint: '标准尺寸太短',
    featureDemand: 'King + 薄高度',
    comparisonTarget: 'Standard 薄枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'thin pillow for stomach sleeper',
    translation: '适合趴睡者的薄枕头',
    searches: 864,
    purchaseRate: 0.0098,
    bid: 1.6,
    bidMin: 1.2,
    bidMax: 2.0,
    monopoly: 0.4,
    cvsShare: 0.375,
    wordTag: '人群词',
    relevanceTier: '高相关',
    aiTags: ['人群词', '场景词'],
    userIntentStage: 'decision',
    jobToBeDone: '专为趴睡选枕',
    jobType: 'functional',
    useScenario: '趴睡',
    targetUser: '趴睡者',
    painPoint: '厚枕导致颈椎后仰',
    featureDemand: '趴睡专用薄枕',
    comparisonTarget: '仰睡枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'flat pillow',
    translation: '扁平枕头',
    searches: 22281,
    purchaseRate: 0.0324,
    bid: 1.88,
    bidMin: 1.32,
    bidMax: 2.45,
    monopoly: 0.3115,
    cvsShare: 0.2027,
    wordTag: '核心词',
    relevanceTier: '高相关',
    aiTags: ['功能词', '尺寸词'],
    userIntentStage: 'consideration',
    jobToBeDone: '寻找扁平枕',
    jobType: 'functional',
    useScenario: '日常睡眠',
    targetUser: '低枕偏好者',
    painPoint: '枕头鼓胀过高',
    featureDemand: '扁平造型',
    comparisonTarget: '蓬松羽绒枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'stomach sleeper pillow',
    translation: '趴睡枕头',
    searches: 18139,
    purchaseRate: 0.0724,
    bid: 2.56,
    bidMin: 1.85,
    bidMax: 3.39,
    monopoly: 0.2427,
    cvsShare: 0.1713,
    wordTag: '人群词',
    relevanceTier: '高相关',
    aiTags: ['人群词', '场景词'],
    userIntentStage: 'consideration',
    jobToBeDone: '解决趴睡不适',
    jobType: 'functional',
    useScenario: '趴睡',
    targetUser: '趴睡人群',
    painPoint: '晨起脖子酸痛',
    featureDemand: '趴睡工学枕',
    comparisonTarget: '侧睡枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'pillow for stomach sleeper',
    translation: '趴睡者枕头',
    searches: 12454,
    purchaseRate: 0.0238,
    bid: 1.51,
    bidMin: 1.13,
    bidMax: 1.89,
    monopoly: 0.2251,
    cvsShare: 0.1302,
    wordTag: '人群词',
    relevanceTier: '高相关',
    aiTags: ['人群词'],
    userIntentStage: 'consideration',
    jobToBeDone: '为趴睡选对枕头',
    jobType: 'functional',
    useScenario: '趴睡',
    targetUser: '趴睡成人',
    painPoint: '找不到合适枕头',
    featureDemand: '低 loft 支撑',
    comparisonTarget: '通用床枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'bamboo pillow',
    translation: '竹纤维枕头',
    searches: 68405,
    purchaseRate: 0.0329,
    bid: 5.19,
    bidMin: 3.89,
    bidMax: 6.49,
    monopoly: 0.4914,
    cvsShare: 0.3505,
    wordTag: '材质词',
    relevanceTier: '中相关',
    aiTags: ['材质词', '功能词'],
    userIntentStage: 'consideration',
    jobToBeDone: '追求透气凉感',
    jobType: 'emotional',
    useScenario: '夏日睡眠',
    targetUser: '怕热人群',
    painPoint: '枕头闷汗',
    featureDemand: '竹纤维罩/凉感',
    comparisonTarget: '普通棉罩枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'memory foam pillow',
    translation: '记忆海绵枕头',
    searches: 55487,
    purchaseRate: 0.0362,
    bid: 2.25,
    bidMin: 1.65,
    bidMax: 3.3,
    monopoly: 0.25,
    cvsShare: 0.1748,
    wordTag: '材质词',
    relevanceTier: '中相关',
    aiTags: ['材质词'],
    userIntentStage: 'awareness',
    jobToBeDone: '了解记忆棉枕品类',
    jobType: 'functional',
    useScenario: '品类浏览',
    targetUser: '泛睡眠消费者',
    painPoint: '枕头支撑不足',
    featureDemand: '记忆棉填充',
    comparisonTarget: '纤维枕/羽绒枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'best pillow for stomach sleepers',
    translation: '最好的趴睡枕头',
    searches: 2937,
    purchaseRate: 0.0657,
    bid: 1.8,
    bidMin: 0.88,
    bidMax: 3.61,
    monopoly: 0.2763,
    cvsShare: 0.1111,
    wordTag: '决策词',
    relevanceTier: '高相关',
    aiTags: ['人群词', '功能词'],
    userIntentStage: 'consideration',
    jobToBeDone: '对比选出最佳趴睡枕',
    jobType: 'functional',
    useScenario: '购买决策对比',
    targetUser: '趴睡精选买家',
    painPoint: '选择困难',
    featureDemand: '口碑验证的薄枕',
    comparisonTarget: '多品牌对比',
    demandTrend: 'rising',
  },
  {
    keyword: 'low profile pillow',
    translation: '低剖面枕头',
    searches: 2826,
    purchaseRate: 0.0307,
    bid: 2.97,
    bidMin: 2.23,
    bidMax: 3.38,
    monopoly: 0.3833,
    cvsShare: 0.2132,
    wordTag: '专业词',
    relevanceTier: '高相关',
    aiTags: ['尺寸词', '功能词'],
    userIntentStage: 'decision',
    jobToBeDone: '按低剖面规格选购',
    jobType: 'functional',
    useScenario: '颈椎对齐睡眠',
    targetUser: '注重脊柱对齐者',
    painPoint: '高枕导致脊柱弯曲',
    featureDemand: 'Low profile 高度',
    comparisonTarget: '高 loft 枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'flat memory foam pillow',
    translation: '扁平记忆海绵枕头',
    searches: 1095,
    purchaseRate: 0.0388,
    bid: 1.43,
    bidMin: 1.07,
    bidMax: 1.79,
    monopoly: 0.625,
    cvsShare: 0.2143,
    wordTag: '材质词',
    relevanceTier: '高相关',
    aiTags: ['材质词', '尺寸词'],
    userIntentStage: 'decision',
    jobToBeDone: '确认扁平记忆棉规格',
    jobType: 'functional',
    useScenario: '精准规格采购',
    targetUser: '复购/规格党',
    painPoint: '标称薄实际厚',
    featureDemand: '真实扁平高度',
    comparisonTarget: '鼓胀记忆棉枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'thin foam pillow',
    translation: '薄泡沫枕头',
    searches: 140,
    purchaseRate: 0.0384,
    bid: 1.91,
    bidMin: 1.6,
    bidMax: 2.16,
    monopoly: 0.3102,
    cvsShare: 0.0,
    wordTag: '长尾词',
    relevanceTier: '中相关',
    aiTags: ['材质词'],
    userIntentStage: 'decision',
    jobToBeDone: '找泡沫材质薄枕',
    jobType: 'functional',
    useScenario: '材质筛选',
    targetUser: '泡沫枕偏好者',
    painPoint: '纤维枕易结块',
    featureDemand: '泡沫芯薄枕',
    comparisonTarget: '纤维填充',
    demandTrend: 'stable',
  },
  {
    keyword: 'cooling pillow',
    translation: '凉感枕头',
    searches: 155526,
    purchaseRate: 0.027,
    bid: 3.25,
    bidMin: 2.53,
    bidMax: 4.59,
    monopoly: 0.3163,
    cvsShare: 0.1977,
    wordTag: '功能词',
    relevanceTier: '中相关',
    aiTags: ['功能词'],
    userIntentStage: 'awareness',
    jobToBeDone: '解决睡觉热',
    jobType: 'functional',
    useScenario: '夏季/夜汗',
    targetUser: '怕热人群',
    painPoint: '枕头积热',
    featureDemand: '凉感/透气',
    comparisonTarget: '普通枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'pillow for neck pain relief',
    translation: '缓解颈部疼痛的枕头',
    searches: 132664,
    purchaseRate: 0.0273,
    bid: 4.14,
    bidMin: 3.1,
    bidMax: 5.18,
    monopoly: 0.3061,
    cvsShare: 0.2103,
    wordTag: '痛点词',
    relevanceTier: '中相关',
    aiTags: ['功能词', '场景词'],
    userIntentStage: 'awareness',
    jobToBeDone: '缓解颈痛',
    jobType: 'emotional',
    useScenario: '颈痛康复睡眠',
    targetUser: '颈痛患者',
    painPoint: '晨起脖子僵硬',
    featureDemand: '护颈高度',
    comparisonTarget: '普通高枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'cervical neck pillow',
    translation: '颈椎枕头',
    searches: 183967,
    purchaseRate: 0.0344,
    bid: 1.51,
    bidMin: 1.3,
    bidMax: 1.91,
    monopoly: 0.2824,
    cvsShare: 0.2019,
    wordTag: '痛点词',
    relevanceTier: '中相关',
    aiTags: ['功能词'],
    userIntentStage: 'awareness',
    jobToBeDone: '改善颈椎问题',
    jobType: 'functional',
    useScenario: '颈椎护理',
    targetUser: '颈椎不适人群',
    painPoint: '枕头高度不对',
    featureDemand: '颈椎工学造型',
    comparisonTarget: '普通矩形枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'japanese pillow',
    translation: '日式低枕',
    searches: 121152,
    purchaseRate: 0.0328,
    bid: 1.78,
    bidMin: 1.36,
    bidMax: 2.22,
    monopoly: 0.421,
    cvsShare: 0.2781,
    wordTag: '风格词',
    relevanceTier: '中相关',
    aiTags: ['场景词', '尺寸词'],
    userIntentStage: 'awareness',
    jobToBeDone: '尝试日式低枕习惯',
    jobType: 'social',
    useScenario: '低枕文化/旅行启发',
    targetUser: '喜欢低枕文化者',
    painPoint: '西式枕过高',
    featureDemand: '日式低高度',
    comparisonTarget: '欧式高枕',
    demandTrend: 'stable',
  },
  {
    keyword: 'gel memory foam pillow',
    translation: '凝胶记忆海绵枕头',
    searches: 3599,
    purchaseRate: 0.0964,
    bid: 2.76,
    bidMin: 1.75,
    bidMax: 4.02,
    monopoly: 0.2874,
    cvsShare: 0.1725,
    wordTag: '材质词',
    relevanceTier: '中相关',
    aiTags: ['材质词', '功能词'],
    userIntentStage: 'decision',
    jobToBeDone: '选凝胶降温记忆棉',
    jobType: 'functional',
    useScenario: '怕热+要支撑',
    targetUser: '记忆棉偏好者',
    painPoint: '普通记忆棉闷热',
    featureDemand: '凝胶灌注',
    comparisonTarget: '普通记忆棉',
    demandTrend: 'stable',
  },
  {
    keyword: 'low loft pillow',
    translation: '低 loft 枕头',
    searches: 1939,
    purchaseRate: 0.0241,
    bid: 1.79,
    bidMin: 1.41,
    bidMax: 2.54,
    monopoly: 0.3449,
    cvsShare: 0.2084,
    wordTag: '专业词',
    relevanceTier: '高相关',
    aiTags: ['尺寸词'],
    userIntentStage: 'decision',
    jobToBeDone: '按 loft 参数选购',
    jobType: 'functional',
    useScenario: '参数党选购',
    targetUser: '睡眠参数敏感用户',
    painPoint: '描述模糊不知高度',
    featureDemand: '明确低 loft',
    comparisonTarget: '中高 loft',
    demandTrend: 'stable',
  },
  {
    keyword: '2.75 inch thin pillow',
    translation: '2.75 寸薄枕头',
    searches: 980,
    purchaseRate: 0.041,
    bid: 1.55,
    bidMin: 1.1,
    bidMax: 2.0,
    monopoly: 0.42,
    cvsShare: 0.22,
    wordTag: '尺寸词',
    relevanceTier: '高相关',
    aiTags: ['尺寸词', '功能词'],
    userIntentStage: 'decision',
    jobToBeDone: '锁定 2.75 寸高度',
    jobType: 'functional',
    useScenario: '精确高度复购',
    targetUser: '已有高度经验的用户',
    painPoint: '高度描述不准确',
    featureDemand: '真实 2.75 寸',
    comparisonTarget: '3 寸以上枕',
    demandTrend: 'rising',
  },
  {
    keyword: 'how to sleep on stomach with pillow',
    translation: '如何趴着用枕头睡觉',
    searches: 2100,
    purchaseRate: 0.012,
    bid: 0.95,
    bidMin: 0.6,
    bidMax: 1.3,
    monopoly: 0.28,
    cvsShare: 0.09,
    wordTag: '认知词',
    relevanceTier: '中相关',
    aiTags: ['场景词'],
    userIntentStage: 'awareness',
    jobToBeDone: '学习正确趴睡姿势',
    jobType: 'functional',
    useScenario: '睡姿学习',
    targetUser: '新手趴睡者',
    painPoint: '不知道该不该用枕',
    featureDemand: '教育内容+薄枕',
    comparisonTarget: '无枕趴睡',
    demandTrend: 'stable',
  },
  {
    keyword: 'huhu sleep pillow',
    translation: 'Huhu Sleep 枕头',
    searches: 420,
    purchaseRate: 0.055,
    bid: 1.2,
    bidMin: 0.8,
    bidMax: 1.6,
    monopoly: 0.72,
    cvsShare: 0.55,
    wordTag: '品牌词',
    relevanceTier: '高相关',
    aiTags: ['品牌词'],
    userIntentStage: 'loyalty',
    jobToBeDone: '复购/找品牌官方款',
    jobType: 'social',
    useScenario: '品牌直达',
    targetUser: 'Huhu 现有用户',
    painPoint: '怕买到仿品',
    featureDemand: '品牌正品',
    comparisonTarget: '其他薄枕品牌',
    demandTrend: 'rising',
  },
  {
    keyword: 'bluewave bedding pillow',
    translation: 'Bluewave Bedding 枕头',
    searches: 1850,
    purchaseRate: 0.048,
    bid: 2.1,
    bidMin: 1.5,
    bidMax: 2.8,
    monopoly: 0.68,
    cvsShare: 0.48,
    wordTag: '品牌词',
    relevanceTier: '中相关',
    aiTags: ['品牌词'],
    userIntentStage: 'loyalty',
    jobToBeDone: '复购标杆品牌',
    jobType: 'social',
    useScenario: '品牌忠诚复购',
    targetUser: 'Bluewave 用户',
    painPoint: '想换同品牌其他高度',
    featureDemand: '同系列多高度',
    comparisonTarget: '其他薄枕品牌',
    demandTrend: 'stable',
  },
  {
    keyword: 'why does my neck hurt from pillow',
    translation: '为什么枕头导致脖子疼',
    searches: 5600,
    purchaseRate: 0.008,
    bid: 0.7,
    bidMin: 0.4,
    bidMax: 1.0,
    monopoly: 0.22,
    cvsShare: 0.05,
    wordTag: '问题词',
    relevanceTier: '中相关',
    aiTags: ['场景词', '功能词'],
    userIntentStage: 'awareness',
    jobToBeDone: '诊断颈痛原因',
    jobType: 'emotional',
    useScenario: '问题排查',
    targetUser: '晨起颈痛者',
    painPoint: '不明原因颈痛',
    featureDemand: '正确高度教育',
    comparisonTarget: '过高枕头',
    demandTrend: 'stable',
  },
  {
    keyword: 'best thin pillow 2.75',
    translation: '最好的 2.75 寸薄枕头',
    searches: 760,
    purchaseRate: 0.052,
    bid: 1.65,
    bidMin: 1.2,
    bidMax: 2.2,
    monopoly: 0.45,
    cvsShare: 0.28,
    wordTag: '决策词',
    relevanceTier: '高相关',
    aiTags: ['尺寸词', '功能词'],
    userIntentStage: 'decision',
    jobToBeDone: '在 2.75 寸里选最佳',
    jobType: 'functional',
    useScenario: '最终下单对比',
    targetUser: '明确高度的买家',
    painPoint: '同高度品牌太多',
    featureDemand: '2.75 寸口碑款',
    comparisonTarget: 'Bluewave / Huhu / Iwacool',
    demandTrend: 'rising',
  },
];

const DEMO_KEYWORDS: Keyword[] = KW_SEEDS.map((s, i) => mkKeyword(s, i + 1));

// ─── Reviews（Huhu + MINUPWELL 真实评论）────────────────────────────────────

function stripBr(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DEMO_REVIEWS: Review[] = [
  {
    id: 'rv-huhu-01',
    asin: 'B0FH4SBYH4',
    title: 'Just perfect pillow for my needs',
    content:
      'I usually need very slim pillows. Most of the time, even in five-star hotels, I use folded bath towel as a pillow. This ultra slim pillow (1.75” thick) is a perfect solution to my search. It is quite well made and quite comfortable.',
    rating: 5,
    date: '2026-08-05',
    helpful: 0,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-huhu-02',
    asin: 'B0FH4SBYH4',
    title: 'cool and comfortable',
    content:
      "I got the \"2.75 Inchs\" size, and it's standard-size instead of long. From a depth perspective, 2.75 inches is very thin compared to typical pillows, but it's thick enough for me, and I like that size because it doesn't mess my neck up. The cooling for pillow is fantastic, and it's considerably better than my average pillow. The comfort is also great, even though the pillow is thin.",
    rating: 4,
    date: '2026-07-29',
    helpful: 0,
    hasImage: true,
    imageUrls: ['https://m.media-amazon.com/images/I/71mQPrg8LBL._SY500_.jpg'],
    isVp: false,
  },
  {
    id: 'rv-huhu-03',
    asin: 'B0FH4SBYH4',
    title: 'Do not recommend for side sleeping or stomach.',
    content: "I've been searching for the perfect pillow. I suffer from chronic migraines. Pretty stiff. Not soft at all.",
    rating: 1,
    date: '2026-06-14',
    helpful: 1,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-huhu-04',
    asin: 'B0FH4SBYH4',
    title: 'Not as thin as expected, and rather firm',
    content:
      "I have had the same thin pillow for about 20 years, and have a very hard time using almost anything else. I got this pillow as it was advertised to be even thinner, which sounded great! Due to the memory foam design though, it doesn't have much give so it is not as thin as I was expecting. I've used memory foam before and this is firmer than other products I've experienced.",
    rating: 3,
    date: '2026-06-06',
    helpful: 2,
    hasImage: false,
    isVp: false,
  },
  {
    id: 'rv-huhu-05',
    asin: 'B0FH4SBYH4',
    title: 'A True 2.75" Low-Profile Pillow with Real Cooling Fabric',
    content: stripBr(
      "If you're looking for a genuinely flat pillow, this one is exactly that. The 2.75-inch height is accurate — it's a true low-profile pillow, not a standard pillow by any stretch. Before you order, make sure this is the thickness you actually want, because it's intentionally very thin. The cooling cover is legit. It has that cool-to-the-touch feel and does a great job preventing heat buildup through the night. The Medium Firmness rating is also accurate. Another big plus: it was ready to use immediately. No chemical smell, no off‑gassing, and it expanded almost instantly after unpacking."
    ),
    rating: 5,
    date: '2026-06-04',
    helpful: 0,
    hasImage: true,
    hasVideo: true,
    imageUrls: [
      'https://m.media-amazon.com/images/I/71ziamphHyL._SY200.jpg',
      'https://m.media-amazon.com/images/I/71MDDefmBuL._SY200.jpg',
      'https://m.media-amazon.com/images/I/61zrhgENkxL._SY200.jpg',
    ],
    videoUrls: [
      'https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/b91586ba-e03c-4f3d-838a-6b675fe44d9b/default.vertical.jobtemplate.mp4.480.mp4',
    ],
    isVp: false,
  },
  {
    id: 'rv-huhu-06',
    asin: 'B0FH4SBYH4',
    title: 'Especially for belly sleepers.',
    content:
      "My husband is a belly sleeper who always complained 'the pillow is too thick - I have a neck ache every morning'. So, I ordered this thin pillow. He LOVES it. No complaints and no neck aches. Yeah!",
    rating: 5,
    date: '2026-02-25',
    helpful: 1,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-huhu-07',
    asin: 'B0FH4SBYH4',
    title: 'Must for Stomach Sleepers',
    content: stripBr(
      'I cannot sleep without a pillow but have always preferred pillows on thinner side. Since I can only fall asleep face down, a thick pillow hurts my neck. This pillow is less than 3 inches thick and is perfect and so comfortable for me. I also sweat a lot and unlike other foam pillows, this keeps me cool. The pillow has just the right firmness for me and it gives required support to my neck and back and I wake up feeling relaxed.'
    ),
    rating: 5,
    date: '2025-12-30',
    helpful: 0,
    hasImage: true,
    imageUrls: [
      'https://m.media-amazon.com/images/I/71rKgUDIopL._SY200.jpg',
      'https://m.media-amazon.com/images/I/71OA+N7XmuL._SY200.jpg',
    ],
    isVp: false,
  },
  {
    id: 'rv-huhu-08',
    asin: 'B0FH4SBYH4',
    title: 'A must for back sleepers!',
    content:
      'This is a great pillow for back sleepers. I am a back sleeper mostly and sometimes side sleeper. And when I say back sleeper, I mean flat on my back like "Count Dracula in a coffin" back sleeper. The pillow is very thin, much thinner than any pillow you may find at a traditional home store. I always found regular pillows that have a thickness of 5"+ to be odd as it always pushed my head up in an unnatural way. This pillow does not do that and I wake up with considerably less back and neck pain then I did before.',
    rating: 5,
    date: '2025-12-18',
    helpful: 1,
    hasImage: false,
    isVp: false,
  },
  {
    id: 'rv-huhu-09',
    asin: 'B0FH4SBYH4',
    title: 'Perfect thickness',
    content: stripBr(
      "This is now my third pillow from this brand, and it's just as great as the other two I have. I got this never having tried a thin pillow before, and assuming I'd hate it, but I actually love it! For me, a pretty standard height and weight, it is almost the perfect height to keep my neck perfectly straight. It's the perfect thickness. My sleep quality has been great since using this, and I'm noticing less head adjustments through the night."
    ),
    rating: 5,
    date: '2025-12-22',
    helpful: 1,
    hasImage: false,
    isVp: false,
  },
  {
    id: 'rv-huhu-10',
    asin: 'B0FH4SBYH4',
    title: 'Low profile comfy pillow',
    content:
      'I usually sleep on my stomach and regular pillows are too thick. This thin memory foam pillow has been comfortable. It is low profile and support my neck without straining. The foam feel soft but not too squishy, and the bamboo case is nice and breathable. There\'s no weird smell from the foam.',
    rating: 4,
    date: '2025-12-20',
    helpful: 0,
    hasImage: true,
    imageUrls: [
      'https://m.media-amazon.com/images/I/81hIUlem+UL._SY200.jpg',
      'https://m.media-amazon.com/images/I/51RHWW40ClL._SY200.jpg',
    ],
    isVp: false,
  },
  {
    id: 'rv-huhu-11',
    asin: 'B0FH4SBYH4',
    title: 'Soft, but Supportive',
    content: stripBr(
      "First off -- the pillow is on the thin side, but it's fine because it's very supportive despite being very soft. I've used it every night to see how well it holds it's shape and so far so good. Like a lot of the newer pillows this one seems to stay VERY cool. Really comfortable pillow that is both supportive and soft. Quality product."
    ),
    rating: 5,
    date: '2025-12-20',
    helpful: 0,
    hasImage: false,
    isVp: false,
  },
  {
    id: 'rv-huhu-12',
    asin: 'B0FH4SBYH4',
    title: 'Feels good!',
    content: 'Great pillow for those who dislike elevated head when sleeping',
    rating: 4,
    date: '2026-03-13',
    helpful: 1,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-huhu-13',
    asin: 'B0FH4SBYH4',
    title: 'As described! Packaged nicely!',
    content:
      "Super soft to the touch. I used a clothes pin for reference on thickness and it expanded pretty fast upon opening. I'm still too nervous for my toddler to have a thick pillow so I bought a thin toddler one and it's just not big enough. This is perfect size. As big as mine, just not as thick!",
    rating: 5,
    date: '2025-12-17',
    helpful: 0,
    hasImage: true,
    imageUrls: [
      'https://m.media-amazon.com/images/I/712cyjmgV6L._SY200.jpg',
      'https://m.media-amazon.com/images/I/71YK6EksfnL._SY200.jpg',
    ],
    isVp: false,
  },
  {
    id: 'rv-minu-01',
    asin: 'B0CBG2T9L1',
    title: 'Great for stomach sleepers',
    content: stripBr(
      'Love love love these pillows. I bought ONE to test it out, because I prefer a flat pillow and they are nearly impossible to find. (Why do manufacturers think we like neck breaking overly stuffed sleeping pillows?) This pillow is so great I bought 4 more for my husband and me. Give them 24 hours to perk-up out of the package and you\'re good to go for a wonderful night\'s sleep. I highly recommend for stomach sleepers and pillow stackers.'
    ),
    rating: 5,
    date: '2026-07-21',
    helpful: 1,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-02',
    asin: 'B0CBG2T9L1',
    title: 'Perfect pillow for neck pain',
    content:
      'My physical therapist recommended a very flat pillow to help with arthritis in my neck. This pillow looked flat enough (not an easy find) so I tried it. It has made a huge difference in my ability to sleep comfortably and wake up with no discomfort. I highly recommend.',
    rating: 5,
    date: '2026-07-17',
    helpful: 7,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-03',
    asin: 'B0CBG2T9L1',
    title: "I've look everywhere for a pillow like this",
    content:
      "I'm literally laying my head on this pillow currently while typing this.I've had this for over a year now and it's been my favorite pillow I've had in years. I don't get why people like normal sized pillows. My neck and back so much prefer this. It alleviates pressure on those areas. Very very comfortable. Provides me the perfect amount of support as a primary back sleeper.",
    rating: 5,
    date: '2026-07-24',
    helpful: 5,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-04',
    asin: 'B0CBG2T9L1',
    title: 'Started coming apart the moment I took it out of the box',
    content: "Started shedding the moment I laid on it. Long strands of fibers. Don't buy it. It's cheap rubbish.",
    rating: 1,
    date: '2026-07-15',
    helpful: 2,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-05',
    asin: 'B0CBG2T9L1',
    title: "It's definitely flat",
    content: 'Flatter than I thought. Would be a good seat cushion for someone in a wheel chair. Not for laying your head on.',
    rating: 1,
    date: '2026-08-04',
    helpful: 0,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-06',
    asin: 'B0CBG2T9L1',
    title: 'Good pillow!',
    content: 'This is just what I need. My neck feels better, and I don’t wake up with a headache. The item arrived quickly. Well made too.',
    rating: 5,
    date: '2026-07-24',
    helpful: 2,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-07',
    asin: 'B0CBG2T9L1',
    title: '10/10 Great for Stomach sleepers',
    content: 'Love this pillow! Great for Stomach sleepers',
    rating: 5,
    date: '2026-07-20',
    helpful: 0,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-08',
    asin: 'B0CBG2T9L1',
    title: 'Life saver',
    content: stripBr(
      'I accidentally left my wife pillow at the hotel, something she has had for years, we couldn’t find a pillow anywhere to suit her , we tried 3 different pillows but this one saved me from chaos. Will purchase another one for backup. Thanks'
    ),
    rating: 5,
    date: '2026-07-19',
    helpful: 0,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-09',
    asin: 'B0CBG2T9L1',
    title: 'Finally! A comfortable pillow!',
    content: stripBr(
      "When I first unpacked this pillow, put it on my bed, and tried it, I thought it was kind of hard. That's because it needs a few hours to fluff up completely after being shipped in a highly compressed state. Once it was in its full shape, it has turned out to be the most comfortable pillow I have ever used. No more waking up with a hot neck. It keeps my head at just the right angle, too."
    ),
    rating: 5,
    date: '2026-07-15',
    helpful: 1,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-10',
    asin: 'B0CBG2T9L1',
    title: 'COOL AND MEDIUM FIRMNESS AND Affordable',
    content:
      'The bamboo fabric is VERY SOFT AND COOL. I got the king size as I’m a side sleeper, petite but toss a lot and this helps a lot .I do have cervical issues as well so it’s too early to tell if this pillow will hold its firmness . It is closer to 3 inches and I needed a2.5 inch but I guess it’s ok because with time and normal wear the loft might decrease .',
    rating: 4,
    date: '2026-07-14',
    helpful: 5,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-11',
    asin: 'B0CBG2T9L1',
    title: '100% POLYESTER!!',
    content:
      'NOT MADE OF RAYON OR BAMBOO! This pillow is 100% polyester fill, 60% polyester cover and only 40% of the *COVER* is made of bamboo.',
    rating: 1,
    date: '2026-07-13',
    helpful: 1,
    hasImage: true,
    imageUrls: ['https://m.media-amazon.com/images/I/713qlJP+ZtL._SY200.jpg'],
    isVp: true,
  },
  {
    id: 'rv-minu-12',
    asin: 'B0CBG2T9L1',
    title: 'Great kid friendly twin pillow',
    content: stripBr(
      'It was surprisingly hard to find a pillow that was thin enough for a small child but still fit a twin pillowcase. This checks both those boxes. My child loves it.'
    ),
    rating: 5,
    date: '2026-07-24',
    helpful: 1,
    hasImage: false,
    isVp: true,
  },
  {
    id: 'rv-minu-13',
    asin: 'B0CBG2T9L1',
    title: 'Perfect if you like flat pillows',
    content: stripBr(
      'Perfect for people that enjoy more flat pillows. I use two and they give me the same comfort as my old worn in pillows.'
    ),
    rating: 5,
    date: '2026-07-17',
    helpful: 0,
    hasImage: false,
    isVp: false,
  },
];

// ─── Competitor demo（4 个 ASIN 真实详情 + 主图包）──────────────────────────

const COMPETITOR_DETAILS: AsinDetailSnapshot[] = [
  {
    asin: 'B0FH4SBYH4',
    title:
      'Thin Memory Foam Pillow for Stomach Sleepers - 2.75 Inch Low Profile Flat Pillows for Sleeping, Slim Odorless Foam Pillow and Case with 37% Rayon derived from Bamboo, Standard Size',
    brand: 'Huhu Sleep',
    price: 49.97,
    rating: 4.1,
    ratings: 33,
    imageUrl: 'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US200_.jpg',
    zoomImageUrl: 'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US600_.jpg',
    features: [
      'Ultra-thin Design】Medium firmness with 2.25/2.75-inch ultra slim height offer optimal support for stomach, back and other sleeping styles, boosting sleep comfort.',
      '37% rayon derived from bamboo case】 (Breathable, sweat-wicking) for spring/summer; spandex-nylon side (cloud-soft, skin-hugging) for autumn/winter. Meets needs in all seasons.',
      '5-Year Durability Foam】 “AIR Micro-Cushion” evenly distributes pressure , effectively resisting deformation. Withstands 80,000 repeated pressure cycles, ensuring approximately 5 years of use.',
      'Natural Safe Material,】Sensitive-Skin Friendly fiber with breathable pores wicks moisture; MDI foaming core (95% open-cell) enhances breathability. Chemical-free via physical purification, double removable pillowcases lock dander, skin-safe as sleepwear.',
      'Machine-Washable Pillowcase, Wear-Resistant | Double layers (pill-resistant inner + wrinkle-resistant outer) . Remains soft and intact, easy to clean.',
    ],
    lqs: 95,
    fulfillment: 'FBA',
    sellers: 1,
    sellerName: 'huhu sleep',
    categoryPath: 'Home & Kitchen:Bedding:Bed Pillows & Positioners:Bed Pillows',
    badge: { bestSeller: 'N', amazonChoice: 'N', newRelease: 'N', ebc: 'Y', video: 'Y' },
    parentAsin: 'B0GC2JPNJ5',
    variationCount: 8,
    variationList: [
      { asin: 'B0GHMGQLP7', attribute: 'Size: King 1.75 inch' },
      { asin: 'B0FH4SBYH4', attribute: 'Size: 2.75 Inchs' },
      { asin: 'B0GHMTSRDQ', attribute: 'Size: King 2.75 inch' },
      { asin: 'B0GHMCT7XR', attribute: 'Size: King 3.25 inch' },
      { asin: 'B0GHMF541S', attribute: 'Size: King 2.25 inch' },
      { asin: 'B0FH4X1WD8', attribute: 'Size: 2.25 Inchs' },
      { asin: 'B0GHN26WX5', attribute: 'Size: 1.75 inch' },
      { asin: 'B0GHM824HP', attribute: 'Size: 3.25 inch' },
    ],
    skuList: ['Size: 2.75 Inchs'],
    dimensions: '24"L x 16"W',
    weight: '2 pounds',
    bsrRank: 300052,
    bsrLabel: 'Home & Kitchen',
    asinUrl: 'https://www.amazon.com/dp/B0FH4SBYH4?psc=1',
    raw: {},
  },
  {
    asin: 'B06XPMNP76',
    title:
      'Bluewave Bedding Ultra Slim Gel Memory Foam Pillow for Stomach and Back Sleepers - Thin, Flat Design for Cervical Neck Alignment and Deeper Sleep (2.75-Inches Height, Standard Size)',
    brand: 'Bluewave Bedding',
    price: 39.95,
    rating: 4.5,
    ratings: 7484,
    imageUrl: 'https://m.media-amazon.com/images/I/31lQHUUgWnL._AC_US200_.jpg',
    zoomImageUrl: 'https://m.media-amazon.com/images/I/31lQHUUgWnL._AC_US600_.jpg',
    features: [
      'Removeable, Machine Washable Cover Made from 60% Polyester, 40% Viscose - Standard Sized 25x16x2.75 Inches',
      'OUR #1 BEST-SELLER — JUST 2.75" HIGH: Our most popular pillow, and our least returned for good reason. At 2.75 inches it hits the sweet spot for stomach and back sleepers.',
      'HIGHER-DENSITY FOAM YOU CAN FEEL: Premium 3.25 lb high-density formulation. CertiPUR-US certified.',
      'STAYS COOL FROM LIGHTS-OUT TO MORNING: Gel-infused foam with built-in ventilation channels.',
      'ZIP-OFF COVER THAT KEEPS THINGS HYGIENIC: Soft removable cover unzips and goes straight into washer and dryer.',
      'FAMILY-OWNED, HERE SINCE 2016: Five precise lofts (1.75", 2.25", 2.75", 3.25", and 4").',
    ],
    lqs: 100,
    fulfillment: 'FBA',
    sellers: 2,
    sellerName: 'Bluewave Bedding',
    categoryPath: 'Home & Kitchen:Bedding:Bed Pillows & Positioners:Bed Pillows',
    badge: { bestSeller: 'N', amazonChoice: 'N', newRelease: 'N', ebc: 'Y', video: 'Y' },
    parentAsin: 'B01LFGIB6C',
    variationCount: 11,
    variationList: [
      { asin: 'B01LFHP3IA', attribute: 'Size: 1.75"H (Standard) | Style: Gel Memory Foam' },
      { asin: 'B08CKLRLND', attribute: 'Size: 2.25"H (Standard) | Style: Gel Memory Foam' },
      { asin: 'B06XPMNP76', attribute: 'Size: 2.75"H (Standard) | Style: Gel Memory Foam' },
      { asin: 'B07NZ8LSLR', attribute: 'Size: 2.75"H (King) | Style: Gel Memory Foam' },
      { asin: 'B06XRH46GH', attribute: 'Size: 3.25"H (Standard) | Style: Gel Memory Foam' },
    ],
    skuList: ['Size: 2.75"H (Standard)', 'Style: Gel Memory Foam'],
    dimensions: '25"L x 16"W',
    weight: '2.7 pounds',
    bsrRank: 3957,
    bsrLabel: 'Home & Kitchen',
    asinUrl: 'https://www.amazon.com/dp/B06XPMNP76?psc=1',
    raw: {},
  },
  {
    asin: 'B0CBG2T9L1',
    title:
      'MINUPWELL Ultra Flat Pillows for Sleeping Thin, 7D High Support 2.5 inch Height Ultra Thin Pillows,Slim Bed Pillows for Stomach Sleeper,Standard Size -18x26 in',
    brand: 'MINUPWELL',
    price: 20.86,
    rating: 4.4,
    ratings: 1383,
    imageUrl: 'https://m.media-amazon.com/images/I/31l-P7jZeLL._AC_US200_.jpg',
    zoomImageUrl: 'https://m.media-amazon.com/images/I/31l-P7jZeLL._AC_US600_.jpg',
    features: [
      'Premium Quality: Filled with 750G of 7D fiber, 100% cotton fabric cover for a soft and luxurious feel.',
      '2.5-inch High Profile: 100% cervical spine support, perfect for stomach, back, and small-framed side sleepers.',
      'Temperature-Regulating Cotton Fabric: Keeps you cool in summer and warm in winter.',
      'Easy Care: Machine washable, tumble dry low, no clumping.',
      'Convenient Packaging Design: Vacuum-packed; fluff and air out before first use.',
    ],
    lqs: 96,
    fulfillment: 'FBA',
    sellers: 1,
    sellerName: 'Minupwell',
    categoryPath: 'Home & Kitchen:Bedding:Bed Pillows & Positioners:Bed Pillows',
    badge: { bestSeller: 'N', amazonChoice: 'Y', newRelease: 'N', ebc: 'Y', video: 'Y' },
    parentAsin: 'B0DN1XW5R3',
    variationCount: 11,
    variationList: [
      { asin: 'B0CBG2T9L1', attribute: 'Color: White | Size: 1Pc-Standard Size' },
      { asin: 'B0CBG4NC6F', attribute: 'Color: White | Size: 2Pc-Standard Size' },
      { asin: 'B0CNSK4SW1', attribute: 'Color: White | Size: 1Pc-King Size' },
      { asin: 'B0CJC4MBS8', attribute: 'Color: White | Size: 1Pc-Queen Size' },
    ],
    skuList: ['Color: White', 'Size: 1Pc-Standard Size'],
    dimensions: '26"L x 18"W',
    weight: '1.7 pounds',
    bsrRank: 6438,
    bsrLabel: 'Home & Kitchen',
    asinUrl: 'https://www.amazon.com/dp/B0CBG2T9L1?psc=1',
    raw: {},
  },
  {
    asin: 'B0C2KPM8N5',
    title:
      'Thin Pillow for Sleeping, Cooling Gel Flat Pillow for Stomach and Back Sleepers, Ultra Slim Stomach Sleeping Pillows for Shoulder Neck Pain Relief, Low Profile Memory Foam Pillows 2.25-inches',
    brand: 'Iwacool',
    price: 29.99,
    rating: 4.2,
    ratings: 1269,
    imageUrl: 'https://m.media-amazon.com/images/I/51GMVwPxFuL._AC_US200_.jpg',
    zoomImageUrl: 'https://m.media-amazon.com/images/I/51GMVwPxFuL._AC_US600_.jpg',
    features: [
      '【Natural Cooling Memory Foam Pillow】Memory foam with ventilation holes; silky ice fabric on one side and soft rayon on the other.',
      '【SLIM DESIGN FOR STOMACH AND BACK SLEEPERS】Low profile keeps head, neck and spine in neutral alignment.',
      '【NECK and SHOULDER PAIN RELIEF】Ultra thin pillow fills the space between head and neck to reduce muscle tension.',
      '【Removeable Machine Washable Cooling Pillow Cover】Easy care, keeps foam clean.',
      '【NEVER FLAT PREMIUM SUPPORTIVE MEMORY FOAM】CertiPUR-US and Oeko-Tex certified.',
      '【Why this size wins】Full Size: 23.6" *15.7"*2.25" — most popular for stomach and back sleepers.',
    ],
    lqs: 87,
    fulfillment: 'FBA',
    sellers: 1,
    sellerName: 'IWACOOL US',
    categoryPath: 'Home & Kitchen:Bedding:Bed Pillows & Positioners:Bed Pillows',
    badge: { bestSeller: 'N', amazonChoice: 'Y', newRelease: 'N', ebc: 'Y', video: 'Y' },
    parentAsin: 'B0GVSRR4YP',
    variationCount: 8,
    variationList: [
      { asin: 'B0C2KPM8N5', attribute: 'Size: 2.25"H (Standard) Hyper Slim | Number of Items: 1' },
      { asin: 'B0C2KNN9DR', attribute: 'Size: 2.75"H (Standard) Ultra Slim | Number of Items: 1' },
      { asin: 'B0FDQBYY1G', attribute: 'Size: 1.75"H (Standard) Extra Slim | Number of Items: 1' },
      { asin: 'B0DTHNMNKQ', attribute: 'Size: 3.25"H (Standard) Super Slim | Number of Items: 1' },
    ],
    skuList: ['Size: 2.25"H (Standard) Hyper Slim', 'Number of Items: 1'],
    dimensions: '23.6"L x 15.7"W',
    weight: '0.81 kg',
    bsrRank: 7352,
    bsrLabel: 'Home & Kitchen',
    asinUrl: 'https://www.amazon.com/dp/B0C2KPM8N5?psc=1',
    raw: {},
  },
];

function bulletsFromFeatures(features: string[]): string {
  return features.map((f) => f.replace(/^【|^\[|】$/g, '').trim()).join('\n');
}

const COMPETITOR_DEMO: CompetitorDemoSnapshot = {
  selectedAsins: ['B0FH4SBYH4', 'B06XPMNP76', 'B0C2KPM8N5'],
  packs: {
    B0FH4SBYH4: {
      zipName: 'B0FH4SBYH4_demo_pack.zip',
      mainPreviewUrls: [
        'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US600_.jpg',
        'https://m.media-amazon.com/images/I/71ziamphHyL._SY200.jpg',
        'https://m.media-amazon.com/images/I/71MDDefmBuL._SY200.jpg',
        'https://m.media-amazon.com/images/I/71rKgUDIopL._SY200.jpg',
      ],
      aplusCount: 5,
      bulletPoints: bulletsFromFeatures(COMPETITOR_DETAILS[0].features),
    },
    B06XPMNP76: {
      zipName: 'B06XPMNP76_demo_pack.zip',
      mainPreviewUrls: [
        'https://m.media-amazon.com/images/I/31lQHUUgWnL._AC_US600_.jpg',
        'https://m.media-amazon.com/images/I/31lQHUUgWnL._AC_US400_.jpg',
        'https://m.media-amazon.com/images/I/31lQHUUgWnL._AC_US200_.jpg',
      ],
      aplusCount: 6,
      bulletPoints: bulletsFromFeatures(COMPETITOR_DETAILS[1].features),
    },
    B0C2KPM8N5: {
      zipName: 'B0C2KPM8N5_demo_pack.zip',
      mainPreviewUrls: [
        'https://m.media-amazon.com/images/I/51GMVwPxFuL._AC_US600_.jpg',
        'https://m.media-amazon.com/images/I/51GMVwPxFuL._AC_US400_.jpg',
        'https://m.media-amazon.com/images/I/51GMVwPxFuL._AC_US200_.jpg',
      ],
      aplusCount: 5,
      bulletPoints: bulletsFromFeatures(COMPETITOR_DETAILS[3].features),
    },
  },
  details: COMPETITOR_DETAILS.filter(d => d.asin !== 'B0CBG2T9L1'),
  aiReportHtml: DEMO_COMPETITOR_AI_HTML,
};

// ─── Export ─────────────────────────────────────────────────────────────────

export function getDemoData(): {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  marketplace: { code: 'US'; domain: 'amazon.com' };
  sourceLabel: string;
  keywords: Keyword[];
  reviews: Review[];
  competitorDemo: CompetitorDemoSnapshot;
  persona: { people: string; scenarios: string; needs: string };
  marketReportMarkdown: string;
  keywordAiInsight: typeof DEMO_KEYWORD_AI_INSIGHT;
  vocDeepReportHtml: string;
  demoVersion: string;
} {
  return {
    products: DEMO_PRODUCTS,
    history: DEMO_PRODUCTS.map((p, i) => makeHistory(p, i)),
    months: [...months],
    marketplace: { code: 'US', domain: 'amazon.com' },
    sourceLabel: '示例数据：美国站薄枕头市场',
    keywords: DEMO_KEYWORDS,
    reviews: DEMO_REVIEWS,
    competitorDemo: COMPETITOR_DEMO,
    persona: DEMO_PERSONA,
    marketReportMarkdown: DEMO_MARKET_REPORT_MD,
    keywordAiInsight: DEMO_KEYWORD_AI_INSIGHT,
    vocDeepReportHtml: DEMO_VOC_DEEP_REPORT_HTML,
    demoVersion: DEMO_DATA_VERSION,
  };
}
