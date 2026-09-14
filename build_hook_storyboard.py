# -*- coding: utf-8 -*-
import base64, os
TMP = r"C:\Users\77620\AppData\Local\Temp"
def b64(path):
    with open(path, "rb") as fp:
        return "data:image/png;base64," + base64.b64encode(fp.read()).decode("ascii")
IMAGES = {
    "seg":   b64(os.path.join(TMP, "codex-clipboard-e196c744-0dd0-4afc-a522-6d434aec0c91.png")),
    "quad":  b64(os.path.join(TMP, "codex-clipboard-0d42ad7d-ee20-49e1-93f8-c9abab7bc389.png")),
    "trend": b64(os.path.join(TMP, "codex-clipboard-a6bbfbb1-10a7-4c7a-a32e-0952e54050c0.png")),
    "kpi":   b64(os.path.join(TMP, "codex-clipboard-8175408c-1901-489d-a231-e8ca430bb733.png")),
    "comp":  b64(os.path.join(TMP, "codex-clipboard-8181dee9-e251-4e3a-b44c-c6c95e696a36.png")),
    "grab":  b64(os.path.join(TMP, "codex-clipboard-6c1ac732-772a-4fc3-8656-ce8f8a86ca58.png")),
    "persona": b64(os.path.join(TMP, "codex-clipboard-4abd75a0-e2d3-4b75-aa6e-95982fddd789.png")),
    "concl": b64(os.path.join(TMP, "codex-clipboard-9f030e7f-33cb-47ed-8d25-e9efeef9214e.png")),
    "kwdata": b64(os.path.join(TMP, "codex-clipboard-7bbd1d42-dff9-4f89-ae08-8b108b55317c.png")),
    "intent": b64(os.path.join(TMP, "codex-clipboard-fa32d0fb-eb61-42e9-9505-1656be0143f1.png")),
    "jtbd":  b64(os.path.join(TMP, "codex-clipboard-23986332-70ce-404b-a2d1-43729aec9042.png")),
    "profit": b64(os.path.join(TMP, "codex-clipboard-0b674798-e63b-4954-93f5-a69d148fc7ac.png")),
}

CORE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;background:#0f0a1e;color:#e8e6f0;line-height:1.7;padding:40px 24px}
.wrap{max-width:1120px;margin:0 auto}
.cover{background:linear-gradient(135deg,#1b1035 0%,#31104d 50%,#4c1d95 100%);border:1px solid rgba(255,255,255,.08);border-radius:28px;padding:48px 44px;margin-bottom:38px}
.cover .tag{display:inline-block;background:rgba(255,255,255,.12);color:#c4b5fd;font-size:13px;letter-spacing:2px;padding:6px 16px;border-radius:999px;margin-bottom:20px}
.cover h1{font-size:38px;font-weight:800;line-height:1.3;background:linear-gradient(90deg,#fff,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent}
.cover p{color:#b8b2d0;margin-top:16px;font-size:16px}
.cover .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px;font-size:13px;color:#d6d0ec}
.cover .meta span{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);padding:7px 14px;border-radius:999px}
.scene{background:#171030;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:32px 34px;margin-bottom:30px}
.scene-head{display:flex;align-items:center;gap:16px;margin-bottom:10px}
.scene-num{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;flex:0 0 auto}
.scene-title{font-size:22px;font-weight:800;color:#fff}
.scene-sub{font-size:14px;color:#a99fc9;margin-top:2px}
.hook{margin:18px 0;padding:18px 22px;border-left:5px solid #a855f7;background:rgba(168,85,247,.1);border-radius:0 16px 16px 0}
.hook .lab{font-size:12px;letter-spacing:1px;color:#c4b5fd;font-weight:700}
.hook .txt{font-size:24px;font-weight:800;color:#fff;margin-top:6px}
.hook .voicesub{font-size:15px;color:#cfc8e6;margin-top:10px;border-top:1px dashed rgba(255,255,255,.15);padding-top:10px}
.grp{font-size:14px;color:#d5cee8;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px 20px;margin:16px 0}
.grp b{color:#e9b3ff}
.imgblock{border:1px solid rgba(255,255,255,.1);border-radius:18px;overflow:hidden;margin:18px 0;background:#0d0822}
.imgblock img{display:block;width:100%;height:auto}
.imgcap{padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.08)}
.imgcap .t{font-weight:800;color:#fff;font-size:16px}
.imgcap .k{color:#e9b3ff;font-weight:600;font-size:13px;margin-top:8px}
.imgcap .d{color:#bcb5d6;font-size:14px;margin-top:6px}
.imgcap .n{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
.imgcap .n span{background:rgba(168,85,247,.15);color:#e3d3ff;font-size:12px;padding:4px 10px;border-radius:999px;font-weight:600}
.edit{margin-top:18px;padding:16px 20px;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.15);border-radius:16px;font-size:14px;color:#bcb5d6}
.edit b{color:#e9b3ff}
.cta{background:linear-gradient(135deg,#4c1d95,#9333ea);border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:36px 34px;text-align:center}
.cta h2{font-size:26px;font-weight:800;color:#fff}
.cta p{color:#e4d9ff;margin-top:12px;font-size:16px}
.toc{background:#1b1035;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:24px 28px;margin-bottom:30px}
.toc h2{font-size:15px;color:#c4b5fd;margin-bottom:12px}
.toc ol{padding-left:20px;color:#cfc8e6;font-size:14px}
.toc li{margin:5px 0}
"""
def img(key):
    return "<div class=\"imgblock\"><img src=\"" + IMAGES[key] + "\" loading=\"lazy\"/></div>"
def n(tags):
    return "<div class=\"n\">" + "".join("<span>"+t+"</span>" for t in tags) + "</div>"
def render_scene(i, s):
    head = "<div class=\"scene\"><div class=\"scene-head\"><div class=\"scene-num\">"+str(i)+"</div><div><div class=\"scene-title\">"+s["t"]+"</div><div class=\"scene-sub\">"+s["sub"]+"</div></div></div>"
    hook = "<div class=\"hook\"><div class=\"lab\">钩子文案（大字/口播）</div><div class=\"txt\">"+s["hook"]+"</div>" + ("<div class=\"voicesub\"><b>口播/字幕：</b>"+s["voice"]+"</div>" if s.get("voice") else "") + "</div>"
    grp = "<div class=\"grp\"><b>这组图在讲什么：</b>"+s["grp"]+"</div>" if s.get("grp") else ""
    imgs = ""
    for im in s["imgs"]:
        cap = "<div class=\"imgcap\"><div class=\"t\">"+im["t"]+"</div><div class=\"k\">" + ("给 AI 的说明："+im["forai"]) + "</div><div class=\"d\">"+im["d"]+"</div>" + (n(im.get("tag",[])) if im.get("tag") else "") + "</div>"
        imgs += img(im["key"]) + cap
    edit = "<div class=\"edit\"><b>剪辑/呈现要点：</b>"+s["edit"]+"</div>" if s.get("edit") else ""
    return head + hook + grp + imgs + edit + "</div>"

SCENES = []
SCENES.append({
 "t":"看市场 · 这个池子值不值得进",
 "sub":"市场总览（核心指标 / 趋势 / 季节性）",
 "hook":"先别急着看对手。先看这个池子有多大、是不是旺季、有没有被头部锁死。",
 "voice":"总盘 240 万刀、月销 8 万多件、均价 29 刀——但 Top10 品牌只占三成，新品渗透率接近 15%，说明还有新人能切进来。",
 "grp":"这两张是「看市场」的入场判断：先用核心指标和大盘看规模/集中度/需求；再用历史趋势和季节性热力图看是不是旺季窗口，决定这个品类值不值得进。",
 "imgs":[
  {"key":"kpi","t":"图 · 核心指标 + 细分市场占比","forai":"顶部是市场 KPI：总销售额 $2,431,175、总销量 83,430、均价 $29.14，副指标有活跃品牌 188、Top10 集中度 32.4%、平均评论数 108、平均评分 4.2、新品渗透率 14.5%；数据质量审计 99 分。下方环形图是各细分市场销售额占比。","d":"给 AI：镜头停在「99 分 / $2.4M / 83,430 件」这几个数字上，用大字放大；说明这个池子有量、且数据可信可支撑判断。","tag":["总销售额 $2.4M","月销 83,430 件","均价 $29.14","Top10 集中度 32.4%","新品渗透率 14.5%","数据质量 99 分"]},
  {"key":"trend","t":"图 · 市场趋势(历史) + 季节性热力图","forai":"上方是历史销量/销售额/均价按月走势：销量绿柱近一年明显抬升，2026 年 6–8 月冲到 10 万件左右。下方季节性热力图按 2024/2025/2026 三年度 × 12 个月，颜色越深代表销量越高，一眼看出 6–8 月是旺季、年初是淡季。","d":"给 AI：红色框圈出「6 月 102k」和热力图最深的 6–8 月，字幕打『旺季在这：6–8 月』。","tag":["6 月月销 102k","旺季 6–8 月","销量同比走强"]}
 ],
 "edit":"先给 KPI 数字特写（约 2 秒），再切趋势线与热力图，红框标注旺季窗口；用 2–3 个关键数字做字幕强调，节奏 4–5 秒。"
})
SCENES.append({
 "t":"看机会 · 钱在哪张牌桌",
 "sub":"市场细分 + 价格×评分机会象限（核心黄金机会区）",
 "hook":"把 241 个产品切细，再用一张图找出『用户肯加钱、但你还没做好』的空白。",
 "voice":"它最狠的不是给你看数据，是直接指给你看：哪里用户愿意出到 30 多刀，但现有产品评分低、没接住——这就是未满足需求。",
 "grp":"先靠 AI 把 241 个产品自动切成多个细分市场、自动打标；再用「价格×评分象限」把所有产品分到四个格子，右下角『高价-低评分』就是核心黄金机会区——用户愿意付高价但产品没做好，是最容易切入的空白。",
 "imgs":[
  {"key":"seg","t":"图 · 市场细分管理","forai":"左侧是细分分类：未分类/大号厨房餐具速干垫/可折叠收纳型干燥垫/浴室洗漱台吸水托盆/小型杯垫与桌面护垫/多件装组合套装/加高支架型高效干燥系统。右侧是 241 个产品表格，每个 ASIN 被自动打标归属到某细分市场。按钮有「AI 智能分类 / AI 自动打标 / 生成市场分析报告」。","d":"给 AI：快扫一下表格右侧的标签列（层级1 细分市场），展示 AI 把 241 个产品自动归类，体现『先把盘子切细，才好下手』。","tag":["241 个产品","AI 自动打标","6+ 细分市场"]},
  {"key":"quad","t":"图 · 价格×评分机会象限图","forai":"横轴价格、纵轴评分、气泡大小=月销量，虚线=市场均值(均价$29/均分4.18)。四个格子：核心黄金机会(高价-低评分 31 个)、价格带断层(高价-高评分 56 个)、红海区(低价-高评分 42 个)、垃圾场(低价-低评分 34 个)。下方表格列出『隐藏核心黄金机会 ASIN』，如 Large Stone Dish $32.98/4.1 星/月销6996/$230,728。","d":"给 AI：把镜头聚到右下角『核心黄金机会区』，红圈圈出那几个高价低分的气泡；再截图下面表格第一行（月销 6996、$230,728 的大单品），字幕打『高价低评分 = 未满足需求』。","tag":["核心黄金机会 31 个","高价低评=未满足需求","均价 $29 / 均分 4.18","月销 6,996 款单品"]
 }
 ],
 "edit":"先切 2 秒细分标签，再切机会象限；镜头从熊市/牛市四格整体拉到右下角黄金区，用红框+放大。数字字幕做强调。这是全片最强卖点，节奏 5–6 秒。"
})
SCENES.append({
 "t":"看竞品 · 差在哪张图、哪句五点",
 "sub":"竞品对比（Listing / 主图 / 标题 / 五点 / 价格并排）",
 "hook":"把三个竞品摆在一起，你才知道自己差在哪张主图、哪句五点。",
 "voice":"主图、标题、价格、五点一条线对下来，谁更会转化一目了然——不用再一个个开页面翻。",
 "grp":"这是「看竞品」的对比视图：把选定的多个竞品 ASIN 并排展示主图、标题、品牌、评分、价格、规格、五点，并可一键生成竞品『AI 综合报告』，用来对标杆、找差距。",
 "imgs":[
  {"key":"comp","t":"图 · 竞品分析（三列 Listing 并排）","forai":"三列并排，每列包含：主图、★评分、标题、品牌、$价格、Amazon's Choice/A+有视频标签、规格，以及五点卖点。顶部有「AI 综合报告」按钮。三个竞品分别是 Large Stone Dish(灰色大理石石材垫, $32.98, 4.2★)、Oleex 3-Pack($29.99, 4.1★)、tdcokhe($28.49, 4.2★)。","d":"给 AI：镜头从三列并排扫过，突出价格与评分的对比，再点到『AI 综合报告』按钮（体现一键出结论）。","tag":["三列并排对比","价格 $28–$33","评分 4.1–4.2★","一键 AI 综合报告"]
 }
 ],
 "edit":"扫描感运镜（左右平移），停在价格/评分对比，最后点『AI 综合报告』；用一条横线把三列的主图/标题/五点对齐，节奏 4 秒。"
})
SCENES.append({
 "t":"看用户 · 把搜索词变成『用户要完成的任务』",
 "sub":"在线抓关键词 → 关键词数据/意图漏斗 → 意图画像 → JTBD 地图/机会热区",
 "hook":"别人只看搜索量，它把词变成『用户想完成的任务』。",
 "voice":"288 个词，主战场在『考虑型』——意思是用户已经在比价、在犹豫，你得把对比信息和 A+ 做扎实。它再把词聚成任务：台面防护、沥水干燥、防滑吸水，哪个好做、机会分多高，一眼看到。",
 "grp":"这是「看用户」的核心链路：先在线抓取关键词，再把 288 个词按购买意图分层、聚成用户任务(JTBD)，最后给出机会热区——把『词』翻译成『用户要完成的任务』，才是真正的需求洞察。",
 "imgs":[
  {"key":"grab","t":"图 ① 在线抓取关键词","forai":"已配置「卖家精灵」，抓取方式可选「输入关键词(ABA)」或「输入 ASIN(流量词)」；填入种子关键词（如 coffee tumbler / camping chair），站点 US，目标关键词数量前 100 个。","d":"给 AI：展示输入一个种子词、点『开始抓取』的动作，体现数据是真实从工具(MCP)拉的，不是编的。","tag":["已配置卖家精灵","ABA 关联词库","输入种子词→抓取"]},
  {"key":"kwdata","t":"图 ② 关键词数据 + 购买意图漏斗","forai":"总词数 288、总搜索量 1,715,675、用户任务 19 个、已洞察 100 个。意图画像结论：用户主要处于『考虑型』阶段（88% 词数、98% 搜索量），CPC $0.85 / CVR 2.1%；导航为考虑型→重点优化对比信息、A+ 与评测型卖点。下方的购买意图漏斗显示：认知型 1、考虑型 88、决策型 2、忠诚型 1。","d":"给 AI：突出『考虑型 88% / 98% 搜索量』，因为这意味着用户卡在『比价、犹豫』，是最值得优化的阶段。","tag":["总词数 288","总搜索量 1.71M","用户任务 19 个","考虑型 88% / 98% 搜索量","CPC $0.85 / CVR 2.1%"]},
  {"key":"intent","t":"图 ③ 意图画像（四象限 + 词类分布）","forai":"四类意图：认知型(9词/9%)、考虑型(88词/88%)、决策型(2词/2%)、忠诚型(1词/1%)，各配搜索量、CPC、CVR。下方词类分布：场景词 21、功能词 16、材质词 4。","d":"给 AI：这页是『认知→考虑→决策→忠诚』的四阶段图，用于说明用户旅程；点出考虑型占绝对主导。","tag":["认知型 9 词","考虑型 88 词","决策型 2 词","忠诚型 1 词","场景词 21 / 功能词 16"]},
  {"key":"jtbd","t":"图 ④ JTBD 地图 + 机会热区 + 用户任务机会排行","forai":"功能性任务 13 个、情感性任务 6 个、社会性任务 0 个。机会热区 Top3 任务：#1 台面防护(44 分，周搜 8,093)、#2 沥水干燥(42 分，周搜 327,422)、#3 防滑吸水(41 分，周搜 160,873)。下方是高意图长尾机会与用户任务机会排行（1 台面防护 44、2 沥水干燥 42、3 防滑吸水 41、4 台面美化 41、5 收纳整理 40、6 沥干餐具 38）。","d":"给 AI：这是最亮的一页——把词聚成『任务』并打分。突出机会热区 Top3 与周搜索量，说明哪些任务需求在、竞争相对可控。","tag":["功能性任务 13","情感性任务 6","机会热区Top3：台面防护/沥水干燥/防滑吸水","长尾机会评分"]
 }
 ],
 "edit":"这组是核心可 4 段连切：①抓词 → ②漏斗(考虑型88%) → ③意图四象限 → ④JTBD 机会热区。④ 是最强记忆点，镜头停留最久，配上『把词变成任务』的字幕。"
})
SCENES.append({
 "t":"看用户 · 从『需求』到「能拍板的方案」",
 "sub":"用户画像 / 决策路径 + 洞察结论（Listing·产品·父体路线图）",
 "hook":"光看数据不够，它把『谁在买、卡在哪、要怎么改』直接写给你。",
 "voice":"它把结论写成能拍板的方案：标题怎么改、产品怎么升级、父体结构怎么搭，连必改项都列好——而且每一步都能回到证据。",
 "grp":"这里把『用户』落到具体的人和动作：先画出用户画像(谁在买/什么场景/要什么/卡在哪)和四阶段决策路径；再给出洞察结论——已验证的功能替代、产品口碑两极分化的根因，以及 Listing/产品/父体三条落地路线图。",
 "imgs":[
  {"key":"persona","t":"图 · 用户画像 + 决策路径","forai":"画像：25–45 岁、注重厨房颜值与整洁的女性，多为房主或长租客，拥有石英/大理石台面；习惯手洗碗、厌倦毛巾发霉和塑料垫积水；愿为美观和速干付 40–70 美元高价。分为核心场景(如餐碗随手置放/洗手液瓶底沥水)、核心需求(快速吸水且能自然蒸发/外观天然石材质感/易打理)、主要痛点(打开有化学气味/水洗多次后变色染色/吸水衰减/材质易脏)。下方决策路径四阶段：认知→考虑→决策→使用，各附证据。","d":"给 AI：突出『25-45 岁厨房颜控女性、愿付 40-70 美元』和三大痛点『化学气味/染色/吸水衰减』；这页讲的是需求从哪来、卡在哪。","tag":["25-45 岁女性","愿付 $40-70","核心痛点：气味/染色/吸水衰减","决策路径四阶段"]},
  {"key":"concl","t":"图 · 洞察结论（综合判断 + 方案落地）","forai":"综合判断：硅藻土沥水垫的『功能性替代』已被验证（确实快干、台面干爽、优于布垫和塑料），用户愿为颜值体验付 60 美元以上；但产品口碑两极分化，信任感被严重侵蚀，三大根因是化学气味、色泽不统一、吸水失败与四个月后发愁。并给出：Listing 方案建议（标题方向/关键词布局/视觉策略）、产品方案建议（核心规格/差异化/价格带/必改项）、父体结构建议（P0 灰米色大号16x16流量锚点、P1 米白色大号小众美学、P2 大号+方形托包多件套高客单）。","d":"给 AI：这是『结论落地』页——AI 直接给出『标题怎么改、产品怎么升级、父体怎么搭』，这是把洞察变成可执行动作的收尾。","tag":["可信的根因：气味/色差/吸水","Listing 方案","产品方案","父体结构 P0/P1/P2"]
 }
 ],
 "edit":"先给人物画像定性(谁+痛点)，再切到结论页把三条路线图(P0/P1/P2)逐条列出；这组讲『AI 不只看，还帮你做决定』，节奏 5 秒。"
})
SCENES.append({
 "t":"看能不能做 · 最后算一笔账",
 "sub":"利润计算器（成本·VAT·广告效率·父体综合利润率）",
 "hook":"前面再好看，最后还得算一笔账——到底能不能赚。",
 "voice":"售价 29.99、毛利率 32.3%，月净利近 3000 刀，广告 TACos 控制在 10%，盈亏平衡价 16.53 刀、安全边际 44.9%——这笔账一拍就算清。",
 "grp":"把前面的所有判断落到『能不能做』：输入售价、采购成本、FBA、佣金、广告等参数，快速得到父体毛利率、ACOS/TACos、月净利与盈亏平衡价，用来验证这个品到底值不值得投。",
 "imgs":[
  {"key":"profit","t":"图 · 利润计算器","forai":"左侧是默认变体参数：售价 $29.99、采购成本 ¥36、头程 $2、FBA $4.5、佣金 15%、退款率 3%、广告 CVR 10%、CPC $1、广告订单占比 30%；右侧父体利润分析：父体毛利率 32.3%、父体 TACos 10.0%、月总销量 300 件、月总销售额(含税) $8,997、月总广告花费 $900、月总净利润 $2,908；下方盈亏平衡价 $16.53、安全边际 44.9%，自然订单 210(70%) vs 广告订单 90(30%)。","d":"给 AI：突出『毛利率 32.3%』『月净利 $2,908』『TACos 10%』这几个决定性数字，把『能不能做』的结论视觉化。","tag":["毛利率 32.3%","月净利 $2,908","TACos 10%","盈亏平衡价 $16.53","自然单 70% / 广告单 30%"]
 }
 ],
 "edit":"只截关键数字：毛利率、月净利、TACos、盈亏平衡价；用色块放大这几个数字，最后落到『这笔账能不能做』。节奏 3–4 秒。"
})
html = []
html.append("<!DOCTYPE html><html lang=\"zh\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>AmzDev · 钩子视频分镜</title><style>"+CORE_CSS+"</style></head><body><div class=\"wrap\">")
html.append("<div class=\"cover\"><div class=\"tag\">钩子视频 · 分镜脚本</div><h1>同样做亚马逊，你为什么总选到红海？<br/>因为你只看「数据」，没看「用户」。</h1><p>目标人群：想用 AI / 工具做更高质高效市调的亚马逊卖家、运营、产品开发、选品负责人。<br/>核心差异：不是又一块看板，而是把大盘、关键词、竞品、评论收成一份能拍板的诊断——AI 结论可溯源、可复核，返回 0–N 个真实机会。</p><div class=\"meta\"><span>时长约 30–40s</span><span>人群：跨境电商 / 亚马逊运营</span><span>主推平台：抖音 · 小红书 · 视频号 · 知乎 · B站</span></div></div>")
html.append("<div class=\"toc\"><h2>分镜目录（按讲故事顺序，可整条用，也可分条发）</h2><ol>" + "".join("<li>"+s["t"]+"</li>" for s in SCENES) + "</ol></div>")
for i, s in enumerate(SCENES, 1):
    html.append(render_scene(i, s))
html.append("<div class=\"cta\"><h2>评论区扣「市调」，我把体验入口发你。</h2><p>看用户，才有真商机。</p></div>")
html.append("</div></body></html>")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "AmzDev-钩子视频分镜.html")
with open(out, "w", encoding="utf-8") as fh:
    fh.write("".join(html))
print("WROTE", out)
print("SCENES", len(SCENES))
