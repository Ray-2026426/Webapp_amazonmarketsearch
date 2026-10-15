(function () {
  "use strict";

  const pageTitles = {
    projects: "项目中心",
    user: "看用户 · 需求地图",
    market: "看市场 · 细分市场",
    competitor: "看竞对 · ASIN 横向对比",
    self: "看自己 · 机会适配检查",
    opportunity: "看机会 · 机会卡",
    report: "报告预览"
  };

  const evidenceContent = {
    persona: {
      kicker: "看用户 · 人群证据",
      title: "为什么核心人群是侧睡者？",
      html: `
        <p>这个判断同时来自关键词、评论和代表 ASIN 的 Listing，不是 AI 根据单一评论猜测。</p>
        <h4>关键词证据</h4>
        <table><thead><tr><th>关键词</th><th>月搜索量</th><th>意图</th></tr></thead><tbody><tr><td>pillow for side sleeper</td><td>4,800</td><td>睡姿人群</td></tr><tr><td>side sleeper neck support</td><td>1,240</td><td>人群 + 痛点</td></tr><tr><td>adjustable pillow side sleeper</td><td>910</td><td>人群 + 功能</td></tr></tbody></table>
        <h4>评论证据</h4>
        <blockquote>“I sleep on my side and the pillow is too low after a week. My shoulder has nowhere to go.”</blockquote>
        <blockquote>“The first night was comfortable, but it flattened and my neck pain came back.”</blockquote>
        <span class="source-tag">评论 C-014</span><span class="source-tag">评论 C-088</span><span class="source-tag">关键词 K-031</span>
      `
    },
    demand: {
      kicker: "看用户 · 需求分类",
      title: "U-01 支撑需求的结构与证据",
      html: `
        <p>需求分类是后续市场打标、竞品满足矩阵和机会卡的共同索引。人工修改后，下游结论需标记“需复核”。</p>
        <h4>需求节点</h4>
        <table><thead><tr><th>ID</th><th>需求</th><th>当前满足</th><th>证据</th></tr></thead><tbody><tr><td>U-01-01</td><td>高度可调</td><td>部分满足</td><td>12 条</td></tr><tr><td>U-01-02</td><td>颈部贴合</td><td>已满足</td><td>9 条</td></tr><tr><td>U-01-03</td><td>长时间不塌陷</td><td>部分满足</td><td>8 条</td></tr></tbody></table>
        <h4>人工操作</h4>
        <p>需求节点应支持重命名、合并、拆分、排除和新增。任何修改都保留修改人、时间和理由。</p>
        <span class="source-tag">12 条支持证据</span><span class="source-tag">3 条反证</span>
      `
    },
    journey: {
      kicker: "看用户 · 决策路径",
      title: "从泛词到功能词的搜索收敛",
      html: `
        <p>路径是基于关键词意图、词根共现与评论中的比较句式生成的 AI 推测，不是亚马逊官方的个人行为追踪数据。</p>
        <table><thead><tr><th>阶段</th><th>典型词</th><th>用户问题</th></tr></thead><tbody><tr><td>进入品类</td><td>bed pillow</td><td>我需要一个更好的枕头</td></tr><tr><td>确定人群</td><td>pillow for side sleeper</td><td>什么适合侧睡</td></tr><tr><td>对比功能</td><td>adjustable / neck support</td><td>怎么解决高度和颈痛</td></tr><tr><td>附加场景</td><td>cooling / washable</td><td>是否凉感、是否好清洗</td></tr></tbody></table>
        <span class="source-tag">关键词样本 186</span><span class="source-tag">评论对比句 37</span>
      `
    },
    reviews: {
      kicker: "看竞对 · 评论原文",
      title: "多竞品共性痛点",
      html: `
        <p>下列评论来自不同角色的 ASIN。“高度不合适”不是单一产品的偶发缺陷，而是跨产品反复出现的需求信号。</p>
        <blockquote><b>B0A-91K · 2 星</b><br>“It sleeps cool at first, but the center compresses and feels too low by morning.”</blockquote>
        <blockquote><b>B0B-34M · 3 星</b><br>“The cover is cool, but there is no way to change the loft for my shoulder width.”</blockquote>
        <blockquote><b>B0N-26D · 2 星</b><br>“The extra layer helps, yet the two available heights are still not right for me.”</blockquote>
        <h4>共性频次</h4>
        <table><thead><tr><th>痛点</th><th>命中评论</th><th>覆盖 ASIN</th></tr></thead><tbody><tr><td>高度不合适</td><td>42</td><td>5 / 5</td></tr><tr><td>熟睡后塌陷</td><td>27</td><td>4 / 5</td></tr><tr><td>凉感不持久</td><td>19</td><td>3 / 5</td></tr></tbody></table>
      `
    },
    opportunity: {
      kicker: "看机会 · 完整证据链",
      title: "O-01 为什么得到 82 分？",
      html: `
        <p>机会分来自确定性评分规则，AI 只负责把分数解释成人话。</p>
        <table><thead><tr><th>维度</th><th>得分</th><th>主要依据</th></tr></thead><tbody><tr><td>需求强度</td><td>23 / 25</td><td>42 条高度痛点、19 条凉感痛点、决策词稳定</td></tr><tr><td>市场吸引力</td><td>21 / 25</td><td>月销额 $1.2M，近 12 月 +18%，供给增长较慢</td></tr><tr><td>竞品缝隙</td><td>18 / 20</td><td>5 个角色样本均未完整覆盖组合需求</td></tr><tr><td>我方可行性</td><td>13 / 20</td><td>有现有供应商，但目标成本尚无有效报价</td></tr><tr><td>证据可信度</td><td>7 / 10</td><td>数据覆盖较好，凉感持久性缺少实物测试</td></tr></tbody></table>
        <h4>支持证据</h4><p>18 条：关键词 4 条、评论 8 条、市场数据 3 条、竞品字段 2 条、我方背景 1 条。</p>
        <h4>反证</h4><p>4 条：头部评论壁垒高、凉感效果难量化、目标成本未证实、可拆填充结构存在学习成本。</p>
        <span class="source-tag">O-01 版本 3</span><span class="source-tag">AI 起草</span><span class="source-tag">人工待确认</span>
      `
    }
  };

  const detailScreens = {
    searchPath: {
      group: "看用户",
      title: "搜索路径详情",
      summary: "查看认知、考虑、决策、场景四层关键词如何收敛，以及每层证据和用户问题。",
      html: `
        <p class="detail-context"><b>从哪里进入：</b>看用户 → 搜索路径。<b>返回后保留：</b>当前层级、关键词筛选和滚动位置。</p>
        <div class="detail-stat-grid"><div><span>关键词样本</span><b>186</b><small>卖家精灵 MCP + 种子词扩展</small></div><div><span>路径层级</span><b>4</b><small>认知 / 考虑 / 决策 / 场景</small></div><div><span>覆盖搜索量</span><b>71%</b><small>TOP200 关键词口径</small></div></div>
        <h4>搜索路径与证据</h4>
        <table><thead><tr><th>层级</th><th>代表词</th><th>搜索量</th><th>用户正在解决的问题</th><th>证据</th></tr></thead><tbody><tr><td>认知</td><td>bed pillow</td><td>12,000</td><td>我要换一个更好的枕头</td><td>K-001 等 23 词</td></tr><tr><td>考虑</td><td>pillow for side sleeper</td><td>4,800</td><td>什么适合我的睡姿</td><td>K-031 等 18 词</td></tr><tr><td>决策</td><td>adjustable neck support pillow</td><td>2,150</td><td>高度和支撑能否适合我</td><td>K-084 等 31 词</td></tr><tr><td>场景</td><td>cooling pillow hot sleeper</td><td>1,620</td><td>后半夜会不会闷热</td><td>K-122 等 14 词</td></tr></tbody></table>
        <h4>需要研发实现的交互</h4><p>层级筛选、关键词下钻、原始词表展开、AI 推断说明、人工移动关键词，并在确认后把路径写入需求地图。</p>
      `
    },
    preference: {
      group: "看用户",
      title: "搜索偏好详情",
      summary: "把词性占比、价格敏感、长尾程度和买家对比焦点挂到真实关键词与评论。",
      html: `
        <p class="detail-context"><b>从哪里进入：</b>看用户 → 搜索偏好。<b>主要数据：</b>关键词 TOP200、评论对比句、竞品五点和 A+。</p>
        <table><thead><tr><th>偏好维度</th><th>当前判断</th><th>证据示例</th><th>产品含义</th></tr></thead><tbody><tr><td>词性结构</td><td>功能词 38%，人群场景词 29%</td><td>adjustable / side sleeper / cooling</td><td>产品定义优先说清人群与功能组合</td></tr><tr><td>价格敏感</td><td>中等，$40–50 接受度较高</td><td>under 50 / value pillow</td><td>不能只靠低价，应建立可理解差异</td></tr><tr><td>长尾程度</td><td>高，功能组合词起量明显</td><td>adjustable cooling pillow for side sleeper</td><td>精准词可作为初期流量入口</td></tr><tr><td>比较焦点</td><td>高度、凉感、清洗、塌陷</td><td>37 条评论比较句</td><td>主附图和五点必须正面回答</td></tr></tbody></table>
        <h4>证据列表</h4><p><span class="source-tag">K-031 side sleeper</span><span class="source-tag">K-084 adjustable</span><span class="source-tag">C-088 too low</span><span class="source-tag">C-141 gets hot</span></p>
      `
    },
    demandDetail: {
      group: "看用户",
      title: "需求分类树详情",
      summary: "查看需求 ID、上下级结构、满足状态、证据强度，并支持人工改树。",
      html: evidenceContent.demand.html
    },
    segmentationCriteria: {
      group: "看用户",
      title: "细分标准设置",
      summary: "组合需求、场景与价格带，并在进入看市场前预览会切出几块、每块样本是否足够。",
      html: `
        <p class="detail-context"><b>目标：</b>把“哪个需求值得拿来切市场”做成可选择、可预览、可撤销的人工确认。</p>
        <div class="criteria-builder"><div><span>主切分维度</span><b>睡姿</b><small>侧睡 / 仰睡 / 俯睡</small></div><div><span>次切分维度</span><b>核心功能</b><small>可调高 / 颈部贴合 / 凉感</small></div><div><span>辅助筛选</span><b>价格带</b><small>$30–40 / $40–50 / $50+</small></div></div>
        <h4>切分预览</h4><table><thead><tr><th>候选细分</th><th>预计 ASIN</th><th>关键词信号</th><th>是否可用</th></tr></thead><tbody><tr><td>侧睡 × 可调高</td><td>23</td><td>强</td><td>可进入市场评分</td></tr><tr><td>仰睡 × 颈部贴合</td><td>18</td><td>中</td><td>可进入市场评分</td></tr><tr><td>俯睡 × 低枕</td><td>9</td><td>弱</td><td>样本偏少，保留提醒</td></tr></tbody></table>
        <p class="drawer-note">确认后写入看市场的标签配置；修改已确认的标准会让后续市场、竞对和机会结论标记为“需复核”。</p>
      `
    },
    marketDashboard: {
      group: "看市场",
      title: "细分市场完整大盘",
      summary: "查看趋势、集中度、价格带、品牌、新老品、评分分布、季节性与 Top ASIN。",
      html: `
        <p class="detail-context"><b>当前筛选：</b>侧睡 · 高度可调（23 ASIN）。页面必须始终显示细分口径，避免误当全市场。</p>
        <div class="detail-stat-grid"><div><span>月销售额</span><b>$1.20M</b><small>占全市场 34%</small></div><div><span>近 12 月</span><b>+18%</b><small>全市场同期 +5%</small></div><div><span>CR5</span><b>36%</b><small>集中度中等</small></div><div><span>新品占比</span><b>26%</b><small>存在成功样本</small></div></div>
        <h4>核心视图</h4><table><thead><tr><th>模块</th><th>必须展示</th><th>用于回答</th></tr></thead><tbody><tr><td>规模与趋势</td><td>月销量、销售额、12/24 月曲线、季节性</td><td>是不是水涨船高</td></tr><tr><td>竞争结构</td><td>CR3/CR5/CR10、品牌份额、卖家类型</td><td>是否被少数品牌锁死</td></tr><tr><td>价格与评分</td><td>价格带、星级、评论数分布</td><td>用户接受什么价格与口碑门槛</td></tr><tr><td>新老品</td><td>上架时间、近 12 月新品成功率</td><td>新进入者能否起量</td></tr><tr><td>Top 商品</td><td>ASIN、销量、价格、评分、趋势、标签</td><td>下一步看哪些竞对</td></tr></tbody></table>
      `
    },
    segmentPlan: {
      group: "看市场",
      title: "细分方案对比",
      summary: "比较按睡姿、材质、价格带切分的解释力、自动打标准确性与业务代价。",
      html: `
        <table><thead><tr><th>方案</th><th>块数 / 待复核</th><th>优点</th><th>风险</th><th>建议</th></tr></thead><tbody><tr><td>睡姿 × 功能</td><td>7 块 / 7 ASIN</td><td>贴近用户决策与需求树</td><td>通用枕需人工复核</td><td><b>推荐</b></td></tr><tr><td>材质 × 结构</td><td>6 块 / 3 ASIN</td><td>标题字段最稳定</td><td>不一定反映购买任务</td><td>备选</td></tr><tr><td>价格带</td><td>4 块 / 0 ASIN</td><td>份额和利润对比直接</td><td>无法解释需求缝隙</td><td>仅作筛选</td></tr></tbody></table>
        <h4>确认后的联动</h4><p>看市场主屏重算细分卡；看竞对重建 ASIN 样本池；看机会的市场评分分母变化；历史结论保留但标记“待重算”。</p>
      `
    },
    listingDetail: {
      group: "看竞对",
      title: "单个竞品全字段详情",
      summary: "复用旧版 Listing 详情，查看图片、五点、A+、参数、Q&A、变体和历史数据。",
      html: `
        <p class="detail-context"><b>当前 ASIN：</b>B0A-91K · 绝对头部。字段需标注来源：亚马逊前台 / 卖家精灵 MCP / AI 归纳。</p>
        <div class="listing-hero"><div class="listing-product-visual">B0A-91K<br><small>主图 + 6 张附图</small></div><div><span class="source-tag">绝对头部</span><span class="source-tag">月销 8.2k</span><h4>Premium Adjustable Pillow for Side Sleepers</h4><p>$45.90 · 4.5 星 · 12.4k 评论 · 4 变体</p></div></div>
        <table><thead><tr><th>字段组</th><th>内容摘要</th><th>来源</th></tr></thead><tbody><tr><td>标题 / 五点</td><td>强调 side sleeper、adjustable、neck support</td><td>亚马逊前台</td></tr><tr><td>A+ / 视频</td><td>结构说明完整，2 个安装与体感视频</td><td>亚马逊前台</td></tr><tr><td>参数 / Q&A</td><td>高度 4–6 in；可拆填充；清洗限制被频繁询问</td><td>前台 + AI 归纳</td></tr><tr><td>价格 / BSR</td><td>近 12 月价格 $42–49；BSR 波动与促销同步</td><td>卖家精灵 MCP</td></tr><tr><td>需求满足</td><td>高度可调部分满足；凉感持久部分满足</td><td>规则 + 评论证据</td></tr></tbody></table>
      `
    },
    imageCompare: {
      group: "看竞对",
      title: "主附图逐张对比",
      summary: "按第 1–7 张并排对比五个竞品，看谁在卖什么、缺什么表达。",
      html: `
        <p class="detail-context"><b>比较原则：</b>同一张位并排，不把附图压缩成“7 张”一个数字；每张图保留 AI 一句话与人工备注。</p>
        <table><thead><tr><th>图位</th><th>绝对头部</th><th>紧密跟随者</th><th>腰部</th><th>新进入者</th></tr></thead><tbody><tr><td>主图</td><td>产品体积感强</td><td>凉感蓝色表达</td><td>轮廓结构明显</td><td>模块结构明显</td></tr><tr><td>附图 2</td><td>肩宽与高度</td><td>凉感材质剖面</td><td>颈椎曲线</td><td>拆装步骤</td></tr><tr><td>附图 3</td><td>填充物增减</td><td>温度对比</td><td>睡姿对比</td><td>三档高度</td></tr><tr><td>附图 4–7</td><td>信任、清洗、尺寸</td><td>场景、材料、尺寸</td><td>参数重复较多</td><td>新品评论与包装</td></tr></tbody></table>
        <h4>表达缝隙</h4><p>没有竞品把“肩宽 → 建议高度 → 如何调节 → 整夜凉感”放在一条连贯的图片叙事中，可作为 Listing 差异化候选，但仍需实物证据支持。</p>
      `
    },
    trafficDetail: {
      group: "看竞对",
      title: "流量词与广告结构",
      summary: "查看具体流量词、自然位、广告位、三家重叠词和广告依赖。",
      html: `
        <div class="detail-stat-grid"><div><span>绝对头部</span><b>45 词</b><small>自然 18 · 广告 27</small></div><div><span>紧密跟随者</span><b>38 词</b><small>自然 22 · 广告 16</small></div><div><span>新进入者</span><b>26 词</b><small>自然 19 · 广告 7</small></div></div>
        <table><thead><tr><th>关键词</th><th>搜索量</th><th>头部</th><th>跟随者</th><th>新品</th><th>判断</th></tr></thead><tbody><tr><td>side sleeper pillow</td><td>4,800</td><td>自然 3 / 广告 1</td><td>自然 9 / 广告 2</td><td>自然 28</td><td>大词竞争强</td></tr><tr><td>adjustable pillow side sleeper</td><td>910</td><td>自然 7</td><td>广告 4</td><td>自然 11</td><td>可切入精准词</td></tr><tr><td>cooling adjustable pillow</td><td>520</td><td>广告 6</td><td>自然 8</td><td>自然 14</td><td>组合词有自然起量样本</td></tr></tbody></table>
        <p class="drawer-note">自然与广告排名是抓取快照，必须显示抓取时间，不能被解释为长期稳定份额。</p>
      `
    },
    reviewEvidence: {
      group: "看竞对",
      title: "竞对评论与用户画像证据",
      summary: "按 ASIN 查看好评点、差评痛点、核心用户和需求满足矩阵背后的原文。",
      html: `
        <p class="detail-context"><b>当前筛选：</b>全部 5 个竞品 · U-01 高度可调 · 2–3 星评论优先。</p>
        <table><thead><tr><th>ASIN</th><th>核心用户</th><th>爽点</th><th>未满足</th><th>样本</th></tr></thead><tbody><tr><td>B0A-91K</td><td>肩宽侧睡者</td><td>支撑稳定、品牌可信</td><td>调节麻烦、后半夜塌陷</td><td>200</td></tr><tr><td>B0B-34M</td><td>怕热人群</td><td>首触凉感明显</td><td>固定高度、凉感衰减</td><td>200</td></tr><tr><td>B0N-26D</td><td>愿意尝新的侧睡者</td><td>模块结构清楚</td><td>档位仍不匹配肩宽</td><td>126</td></tr></tbody></table>
        <blockquote><b>C-088 · B0A-91K · 2 星</b><br>“It sleeps cool at first, but the center compresses and feels too low by morning.”</blockquote>
        <blockquote><b>C-141 · B0B-34M · 3 星</b><br>“The cover is cool, but there is no way to change the loft for my shoulder width.”</blockquote>
      `
    },
    profileDetail: {
      group: "看自己",
      title: "账号背景库",
      summary: "跨项目维护品牌、资金、供应链、团队、运营、合规与风险偏好。",
      html: `
        <table><thead><tr><th>维度</th><th>已知信息</th><th>缺失项</th><th>影响哪个判断</th></tr></thead><tbody><tr><td>品牌与店铺</td><td>US 家居类目，成熟店铺</td><td>品牌溢价上限</td><td>Listing 与定价赢法</td></tr><tr><td>资金与财务</td><td>首批 $20k–$50k；净利率 ≥13%</td><td>单品预算上限</td><td>MOQ、广告与人优我廉</td></tr><tr><td>供应链</td><td>枕芯、面料供应商已建立</td><td>凉感材料有效报价</td><td>产品方案与成本</td></tr><tr><td>类目与团队</td><td>家纺 3 年</td><td>结构专利经验</td><td>开发周期与风险</td></tr><tr><td>运营能力</td><td>精细化广告团队</td><td>站外资源</td><td>流量切入方案</td></tr><tr><td>合规与风险</td><td>纺织品合规有经验</td><td>结构专利检索</td><td>硬约束与证据缺口</td></tr></tbody></table>
      `
    },
    questionRationale: {
      group: "看自己",
      title: "品类问题与出题依据",
      summary: "解释为什么问、不同答案改变什么、该题来自哪条机会假设。",
      html: `
        <p class="detail-context"><b>当前问题：</b>供应链能否在 60 天内打样并证明“可调高 + 凉感”的组合效果？</p>
        <h4>为什么必须问</h4><p>竞对分析把候选赢法判为“人无我有”，核心是组合需求而不是单一功能。如果只能做可调高或只能做凉感，这条机会的竞品缝隙分会下降。</p>
        <table><thead><tr><th>答案</th><th>对机会判断的影响</th><th>后续状态</th></tr></thead><tbody><tr><td>能，已有方案</td><td>我方可行性 +3</td><td>仍需验证实物效果</td></tr><tr><td>能，但需找新材料</td><td>我方可行性 +2</td><td>保留材料与交期风险</td></tr><tr><td>暂不确定</td><td>我方可行性 +1</td><td>机会卡标记证据不足</td></tr><tr><td>不能</td><td>该赢法不成立</td><td>重新判断人有我优或暂无赢面</td></tr></tbody></table>
        <p><span class="source-tag">来源 U-01</span><span class="source-tag">来源 U-02</span><span class="source-tag">竞对缺口 C-GAP-03</span></p>
      `
    },
    opportunityDetail: {
      group: "看机会",
      title: "机会卡证据 / 推理 / 反证",
      summary: "把机会分拆成可审计的三栏证据链，并保留人工修改记录。",
      html: `
        <p class="detail-context"><b>机会 O-01：</b>侧睡人群的可调高持久凉感枕。当前版本 V3 · AI 起草 · 人工待确认。</p>
        <div class="evidence-columns"><section><span>支持证据</span><h4>为什么可能成立</h4><p><b>E1 用户：</b>42 条高度痛点、19 条凉感痛点。</p><p><b>E2 市场：</b>$1.2M / 月，近 12 月 +18%。</p><p><b>E3 竞对：</b>5 个角色样本均未完整覆盖组合需求。</p><p><b>E4 自己：</b>已有家纺供应链与广告团队。</p></section><section><span>推理链</span><h4>结论如何形成</h4><p>需求影响购买与退货 → 目标细分规模和增长成立 → 当前供给只部分满足 → 我方有初步承接能力 → 判为“人无我有、值得验证”。</p><p>确定性规则生成 82 分，AI 只负责解释，不直接改分。</p></section><section><span>反证与未知</span><h4>什么会推翻它</h4><p>目标成本 $13 未拿到有效报价。</p><p>凉感持久性缺少同条件实物测试。</p><p>头部评论与流量壁垒可能被低估。</p><p>可拆填充结构的学习成本未证实。</p></section></div>
        <h4>人工修改记录</h4><table><thead><tr><th>版本</th><th>修改</th><th>理由</th></tr></thead><tbody><tr><td>V2 → V3</td><td>状态从“直接进入”改为“值得验证”</td><td>成本与凉感仍缺硬证据</td></tr></tbody></table>
      `
    },
    keywordWorkbench: {
      group: "明细工具",
      title: "关键词明细工作台",
      summary: "复用旧版关键词模块，承载意图分层、词根、流量词与导出，不挤进五看主屏。",
      html: `
        <p class="detail-context"><b>上下文：</b>当前细分“侧睡 · 高度可调”，当前需求 U-01 / U-02。可从看用户或看竞对进入并自动带筛选。</p>
        <div class="workbench-tabs"><span>意图分层</span><span>词根与 N-grams</span><span>流量词</span><span>竞品重叠词</span><span>原始词表</span></div>
        <table><thead><tr><th>关键词</th><th>搜索量</th><th>趋势</th><th>意图</th><th>需求 ID</th><th>来源</th></tr></thead><tbody><tr><td>pillow for side sleeper</td><td>4,800</td><td>+9%</td><td>考虑</td><td>U-01</td><td>MCP</td></tr><tr><td>adjustable pillow side sleeper</td><td>910</td><td>+17%</td><td>决策</td><td>U-01</td><td>MCP</td></tr><tr><td>cooling pillow hot sleeper</td><td>1,620</td><td>+13%</td><td>场景</td><td>U-02</td><td>MCP</td></tr></tbody></table>
      `
    },
    vocWorkbench: {
      group: "明细工具",
      title: "评论 VOC 工作台",
      summary: "统一承载评论标签、情感、5W1H、人群旅程和原文，不把评论证据散落成黑箱。",
      html: `
        <p class="detail-context"><b>上下文：</b>当前 5 个竞品 · 200 条深度样本 / ASIN · 标签“高度不合适、塌陷、凉感不持久”。</p>
        <div class="workbench-tabs"><span>标签库</span><span>好评 / 差评</span><span>人群画像</span><span>用户旅程</span><span>原文证据</span></div>
        <table><thead><tr><th>标签</th><th>情感</th><th>频次</th><th>ASIN 覆盖</th><th>影响阶段</th></tr></thead><tbody><tr><td>高度不合适</td><td>负向</td><td>42</td><td>5 / 5</td><td>试用 / 退货</td></tr><tr><td>熟睡后塌陷</td><td>负向</td><td>27</td><td>4 / 5</td><td>留评</td></tr><tr><td>首触凉感</td><td>正向</td><td>34</td><td>3 / 5</td><td>购买 / 首次使用</td></tr><tr><td>凉感不持久</td><td>负向</td><td>19</td><td>3 / 5</td><td>长期使用</td></tr></tbody></table>
      `
    },
    competitorWorkspace: {
      group: "明细工具",
      title: "多 ASIN 竞品明细工作台",
      summary: "复用旧版大对比池，可从细分市场带入更多 ASIN，自由组合后送回看竞对主屏。",
      html: `
        <p class="detail-context"><b>当前池：</b>侧睡 · 高度可调细分共 23 个 ASIN；主屏已选 5 个角色样本。</p>
        <div class="workbench-tabs"><span>Listing 全字段</span><span>图片</span><span>A+ / 视频</span><span>流量词</span><span>变体</span><span>历史趋势</span></div>
        <table><thead><tr><th>选择</th><th>ASIN / 角色</th><th>月销</th><th>价格</th><th>评分</th><th>近 12 月</th><th>需求覆盖</th></tr></thead><tbody><tr><td>已选</td><td>B0A-91K · 绝对头部</td><td>8.2k</td><td>$45.90</td><td>4.5</td><td>+8%</td><td>U-01 部分 / U-02 部分</td></tr><tr><td>已选</td><td>B0B-34M · 跟随者</td><td>4.6k</td><td>$39.90</td><td>4.3</td><td>+12%</td><td>U-01 未满足 / U-02 已满足</td></tr><tr><td>候选</td><td>B0X-55Q · 新进入者</td><td>880</td><td>$47.90</td><td>4.6</td><td>上架 4 月</td><td>U-01 已满足 / U-02 未知</td></tr></tbody></table>
        <p class="drawer-note">选择 2–6 个后可送回看竞对主屏；同一 ASIN 的 Listing、评论与历史数据应复用缓存，避免重复消耗 MCP 次数。</p>
      `
    }
  };

  const detailScreenOrder = [
    "searchPath", "preference", "demandDetail", "segmentationCriteria",
    "marketDashboard", "segmentPlan",
    "listingDetail", "imageCompare", "trafficDetail", "reviewEvidence",
    "profileDetail", "questionRationale", "opportunityDetail",
    "keywordWorkbench", "vocWorkbench", "competitorWorkspace"
  ];

  const drawer = document.getElementById("detail-drawer");
  const drawerKicker = document.getElementById("drawer-kicker");
  const drawerTitle = document.getElementById("drawer-title");
  const drawerContent = document.getElementById("drawer-content");
  const toast = document.getElementById("toast");
  let toastTimer;

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function openDrawer(kicker, title, html) {
    drawerKicker.textContent = kicker;
    drawerTitle.textContent = title;
    drawerContent.innerHTML = html;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const firstClose = drawer.querySelector(".close-button");
    if (firstClose) firstClose.focus();
  }

  function openDetailScreen(key) {
    const screen = detailScreens[key];
    if (!screen) return;
    openDrawer(`${screen.group} · 二级页`, screen.title, `<p class="drawer-screen-summary">${screen.summary}</p>${screen.html}`);
  }

  function openScreenMap() {
    const groups = detailScreenOrder.reduce((result, key) => {
      const screen = detailScreens[key];
      if (!result[screen.group]) result[screen.group] = [];
      result[screen.group].push({ key, ...screen });
      return result;
    }, {});
    const groupHtml = Object.entries(groups).map(([group, screens]) => `
      <section class="screen-map-group">
        <h4>${group}<span>${screens.length} 个页面</span></h4>
        <div class="screen-map-list">${screens.map((screen, index) => `<button type="button" data-detail-key="${screen.key}"><span>${String(index + 1).padStart(2, "0")}</span><b>${screen.title}</b><small>${screen.summary}</small></button>`).join("")}</div>
      </section>
    `).join("");
    openDrawer("完整页面目录", "7 个主屏 + 13 个二级页 + 3 个明细工作台", `
      <p>主屏通过五看步骤条切换；下面列出旧版已经表达清楚、并在本版保留的全部二级与明细页面。点击任一页面可直接查看其字段、证据和交互要求。</p>
      <div class="screen-map-legend"><span>主屏：项目中心 / 五看 / 报告</span><span>二级页：围绕某个结论下钻</span><span>明细工具：复用完整词表、VOC、竞品能力</span></div>
      ${groupHtml}
      <p class="drawer-note"><b>本期明确不含：</b>定目标、定策略、定控制点、执行路线图、任务和提醒。</p>
    `);
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function showPage(pageName) {
    const target = document.querySelector(`[data-proto-page="${pageName}"]`);
    if (!target) return;
    document.querySelectorAll("[data-proto-page]").forEach((page) => page.classList.toggle("active", page === target));
    document.querySelectorAll(".side-link").forEach((button) => button.classList.toggle("active", button.dataset.page === pageName));
    document.getElementById("app-page-title").textContent = pageTitles[pageName] || "Kairo";
    const frameTop = document.querySelector(".prototype-frame").getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top: frameTop, behavior: "smooth" });
  }

  function openQualityDrawer() {
    openDrawer("数据质量", "本项目的数据是否足够支持判断？", `
      <p>数据质量不只显示“成功/失败”，还需告诉用户缺少的数据会影响哪个结论。</p>
      <table><thead><tr><th>数据</th><th>状态</th><th>影响</th></tr></thead><tbody><tr><td>关键词</td><td>186 条 · 可用</td><td>已覆盖需求和决策路径</td></tr><tr><td>评论</td><td>200 条 · 可用</td><td>5 个 ASIN，新近与高赞样本均有</td></tr><tr><td>产品表</td><td>68 ASIN · 61 完整</td><td>7 个 ASIN 缺少部分字段，已降低置信度</td></tr><tr><td>历史表</td><td>24 个月 · 可用</td><td>2026-03 两个 ASIN 数据缺口已线性标记，未用于强结论</td></tr><tr><td>我方背景</td><td>12 / 16 已知</td><td>目标成本与专利风险仍需确认</td></tr></tbody></table>
      <h4>可进行的动作</h4><p>重新抓取失败字段、替换数据表、修改字段映射，或在保留风险标记的前提下继续。</p>
    `);
  }

  function openNewProjectDrawer() {
    openDrawer("新建调研项目", "选择一种起点数据", `
      <p>三种输入可以任选一种，也可以同时提供多个值。系统会在取数前先说明识别到的品类和抓取范围。</p>
      <form id="new-project-form" class="drawer-form">
        <h4>站点</h4><p><select name="site"><option>US 美国</option><option>UK 英国</option><option>DE 德国</option><option>JP 日本</option></select></p>
        <h4>输入类型</h4><p><select name="type"><option value="keyword">关键词（1–N 个）</option><option value="asin">ASIN（1–N 个）</option><option value="category">亚马逊品类名称（1 个）</option></select></p>
        <h4>起点数据</h4><p><textarea name="seed" rows="4" placeholder="多个关键词或 ASIN 可换行输入" required></textarea></p>
        <h4>调研目的（可选）</h4><p><textarea name="goal" rows="3" placeholder="例如：寻找适合新品切入的细分市场"></textarea></p>
        <p><button type="submit" class="primary-small">识别品类并预览抓取范围</button></p>
      </form>
    `);
    const form = document.getElementById("new-project-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const seed = new FormData(form).get("seed").trim();
      if (!seed) return;
      drawerContent.innerHTML = `<p>已识别输入：<b>${escapeHtml(seed.split(/\n|,/)[0])}</b></p><h4>候选品类</h4><p><span class="source-tag">家居床品 / 枕头</span><span class="source-tag">置信度 92%</span></p><h4>预计抓取</h4><p>关键词扩展、3–5 个代表 ASIN、标题和评论样本。取数开始前需要用户确认这个品类。</p><p><button type="button" class="primary-small" id="confirm-create">确认并创建项目</button></p>`;
      document.getElementById("confirm-create").addEventListener("click", () => { closeDrawer(); showToast("原型示例：项目已创建，下一步为看用户"); showPage("user"); });
    });
  }

  function openUploadDrawer() {
    openDrawer("看市场 · 数据导入", "上传卖家精灵两张数据表", `
      <p>在卖家精灵“选产品”中，“导出”对应产品表，“导出明细”对应历史表。系统需要同时识别两张表并检查字段版本。</p>
      <table><thead><tr><th>文件</th><th>用途</th><th>必须检查</th></tr></thead><tbody><tr><td>产品表</td><td>ASIN 当月指标、标题、价格、评分等</td><td>ASIN 唯一、字段版本、数值类型</td></tr><tr><td>历史表</td><td>按月销量、销售额、价格和 BSR</td><td>月份范围、断档、与产品表 ASIN 映射</td></tr></tbody></table>
      <h4>原型中的上传行为</h4><p>真实开发时应支持文件选择、字段预览、错误行下载和字段映射；本原型只展示交互说明，不会读取本地文件。</p>
      <p><button type="button" class="primary-small" id="mock-upload-complete">模拟导入成功</button></p>
    `);
    document.getElementById("mock-upload-complete").addEventListener("click", () => { closeDrawer(); showToast("两张数据表已匹配：68 个 ASIN，24 个月"); });
  }

  function openStrategyDrawer() {
    openDetailScreen("segmentPlan");
  }

  function openSegmentDrawer(segmentName) {
    const screen = detailScreens.marketDashboard;
    openDrawer(`${screen.group} · 二级页`, `${segmentName}：完整市场大盘`, `<p class="drawer-screen-summary">${screen.summary}</p>${screen.html}`);
  }

  function openAsinManager() {
    const asins = [
      ["B0A-91K", "绝对头部", true],
      ["B0B-34M", "紧密跟随者", true],
      ["B0C-77P", "腰部", true],
      ["B0T-18R", "尾部", true],
      ["B0N-26D", "新进入者", true],
      ["B0X-55Q", "用户手动添加", false]
    ];
    openDrawer("看竞对 · 样本管理", "确认 2–6 个对比 ASIN", `
      <p>系统默认尽量覆盖五种市场位置。用户可替换或增减，但少于 2 个时不允许生成横向结论。</p>
      <form id="asin-form">${asins.map(([asin, role, checked]) => `<p><label><input type="checkbox" name="asin" value="${asin}" ${checked ? "checked" : ""}> <b>${asin}</b> · ${role}</label></p>`).join("")}<p><button type="submit" class="primary-small">确认对比样本</button></p></form>
    `);
    const form = document.getElementById("asin-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = form.querySelectorAll("input:checked").length;
      if (selected < 2 || selected > 6) { showToast("对比样本必须在 2–6 个之间"); return; }
      document.getElementById("selected-count").textContent = `${selected} / 6 已选，最少 2 个`;
      closeDrawer();
      showToast(`已确认 ${selected} 个对比 ASIN`);
    });
  }

  function openProfileDrawer() {
    openDetailScreen("profileDetail");
  }

  function openEditOpportunityDrawer() {
    openDrawer("看机会 · 人工修改", "修改结论不会删除 AI 初稿", `
      <p>人工可修改机会名称、类型、状态和理由，但系统必须保留修改前后内容与理由。确定性分数只能通过修改数据或规则后重算，不允许直接手改。</p>
      <form id="edit-op-form">
        <h4>机会状态</h4><p><select name="status"><option>值得验证</option><option>继续观察</option><option>不建议进入</option><option>证据不足</option></select></p>
        <h4>修改理由</h4><p><textarea name="reason" rows="4" required placeholder="说明是哪条业务信息改变了判断"></textarea></p>
        <p><button type="submit" class="primary-small">保存人工修改</button></p>
      </form>
    `);
    document.getElementById("edit-op-form").addEventListener("submit", (event) => { event.preventDefault(); closeDrawer(); showToast("人工修改已保存，原 AI 结论已保留在版本记录中"); });
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
  }

  document.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-detail-key]");
    if (detailButton) {
      event.preventDefault();
      openDetailScreen(detailButton.dataset.detailKey);
      return;
    }

    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      showPage(pageButton.dataset.page);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "close-drawer") closeDrawer();
      if (action === "screen-map") openScreenMap();
      if (action === "quality") openQualityDrawer();
      if (action === "new-project") openNewProjectDrawer();
      if (action === "upload") openUploadDrawer();
      if (action === "strategy") openStrategyDrawer();
      if (action === "segment-detail") {
        const card = actionButton.closest(".segment-card");
        openSegmentDrawer(card.querySelector("h4").textContent);
      }
      if (action === "evidence") {
        const data = evidenceContent[actionButton.dataset.evidence];
        if (data) openDrawer(data.kicker, data.title, data.html);
      }
      if (action === "confirm-user") { showToast("需求地图已确认，后续将以 demandId 继续追踪"); showPage("market"); }
      if (action === "confirm-segment") { showToast("目标细分市场已确认，系统已生成竞对样本"); showPage("competitor"); }
      if (action === "manage-asins") openAsinManager();
      if (action === "confirm-gap") { showToast("需求缝隙与候选赢法已确认"); showPage("self"); }
      if (action === "profile") openProfileDrawer();
      if (action === "edit-op") openEditOpportunityDrawer();
      if (action === "export") window.print();
      return;
    }

    const opViewButton = event.target.closest("[data-op-view]");
    if (opViewButton) {
      const view = opViewButton.dataset.opView;
      document.querySelectorAll("[data-op-view]").forEach((button) => button.classList.toggle("active", button.dataset.opView === view));
      document.querySelectorAll("[data-op-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.opPanel === view));
      return;
    }

    const segmentCard = event.target.closest(".segment-card");
    if (segmentCard && !event.target.closest("button")) {
      document.querySelectorAll(".segment-card").forEach((card) => card.classList.toggle("selected", card === segmentCard));
      document.getElementById("selected-segment-name").textContent = segmentCard.querySelector("h4").textContent;
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches('input[name="win-path"]')) {
      document.querySelectorAll(".win-path-select label").forEach((label) => label.classList.toggle("selected", label.contains(event.target)));
      showToast(`候选赢法已切换为：${event.target.value}`);
    }
  });

  const selfForm = document.getElementById("self-form");
  selfForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(selfForm);
    const values = ["q1", "q2", "q3"].map((key) => Number(data.get(key)));
    if (values.some((value) => Number.isNaN(value))) { showToast("请完成 3 个必答问题"); return; }
    const score = Math.round(values.reduce((sum, value) => sum + value, 0) / 9 * 100);
    document.getElementById("self-score-preview").textContent = `当前适配度 ${score}% · 成本与凉感实测仍待确认`;
    showToast(`我方适配判断已生成：${score}%`);
    window.setTimeout(() => showPage("opportunity"), 650);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
  });

  const siteLinks = Array.from(document.querySelectorAll(".site-nav a"));
  const sections = siteLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    siteLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-20% 0px -65% 0px", threshold: [0, .2, .5] });
  sections.forEach((section) => observer.observe(section));
})();
