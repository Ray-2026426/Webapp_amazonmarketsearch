/**
 * AI 请求地址的通道判定 + SSRF 目标校验。
 *
 * 背景（用户诉求）：请求地址要默认指向对应大模型的地址、可改、并支持接第三方中转 API。
 * 这里锁死三件容易出错的事：
 *   1. 8 个内置供应商的"官方地址"与"本站默认实际转发到的地址"必须都记录在案
 *      —— 其中 DeepSeek 走的是第三方中转 openrouter.fans（既有设定，不是 bug），界面上必须可见；
 *   2. 填了绝对地址时必须判定为"经服务端转发"（浏览器直连会被 CORS 拦），且"没填地址"时必须
 *      保持今天的同源代理行为（**零回归**）；
 *   3. 服务端转发是 SSRF 面：内网/环回/云元数据/带账号密码/非 http(s) 的地址必须被拒。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_ENDPOINT_FACTS,
  decideAiTransport,
  isSameOriginUrl,
  providerEndpointFact,
  providerRequiresCustomUrl,
  providersWithNonOfficialDefault,
  validateRelayTarget,
} from '../src/utils/aiEndpoints';
import { AI_PROVIDERS, sanitizeAiSettings } from '../src/utils/aiConfig';
import {
  modelsAuthHeaders,
  modelsUrlWithKey,
  parseModelsResponse,
  planModelsRequest,
} from '../src/utils/aiModels';
import { parseRelayUpstream } from '../api/ai/[action]';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

console.log('aiEndpoints：请求地址事实表');

test('每个内置供应商都有官方地址与本站默认目标，且都是 https', () => {
  for (const p of AI_PROVIDERS) {
    const fact = providerEndpointFact(p.id);
    assert(fact, `${p.id} 缺少地址事实`);

    // 「自定义 / 第三方中转」是唯一例外：它没有官方地址、也没有本站默认目标，必须由用户填
    if (providerRequiresCustomUrl(p.id)) {
      assert(p.id === 'custom', `只有 custom 允许没有默认地址，实际是 ${p.id}`);
      assert(fact.officialUrl === '' && fact.proxyTarget === '', `${p.id} 不应有官方/默认地址`);
      assert(p.baseUrl === '', `${p.id} 的 baseUrl 应为空（否则会拼出一个 404 的同源路径）`);
      assert(p.defaultModel === '', `${p.id} 不应有默认模型（必须用户填）`);
      continue;
    }

    assert(/^https:\/\//.test(fact.officialUrl), `${p.id} 官方地址必须是 https：${fact.officialUrl}`);
    assert(/^https:\/\//.test(fact.proxyTarget), `${p.id} 默认目标必须是 https：${fact.proxyTarget}`);
    assert(!fact.officialUrl.endsWith('/'), `${p.id} 官方地址不应以 / 结尾`);
  }
  assert(Object.keys(AI_ENDPOINT_FACTS).length === AI_PROVIDERS.length, '事实表与供应商列表数量不一致');
});

test('「自定义 / 第三方中转」必须能配出自己的地址（用户诉求原话）', () => {
  const custom = AI_PROVIDERS.find((p) => p.id === 'custom');
  assert(custom, '供应商列表里必须有 custom');
  assert(custom?.name.includes('中转'), `名称要能一眼看懂用途，实际「${custom?.name}」`);
  assert(providerRequiresCustomUrl('custom') === true, 'custom 应被标为"必须自填地址"');
  assert(providerRequiresCustomUrl('openai') === false, '内置供应商不应被标为必须自填');

  // 填了地址 → 走服务端转发（绝对地址直连会被 CORS 拦）
  const d = decideAiTransport({ customUrl: 'https://relay.example.com/v1' });
  assert(d.transport === 'relay', `custom + 绝对地址应为 relay，实际 ${d.transport}`);
  // 没填 → 仍按"未填"处理（真正的报错由 buildEndpoint 抛出明确提示）
  assert(decideAiTransport({ customUrl: '' }).transport === 'proxy', '没填地址时判定为默认通道');
});

test('如实记录"默认走第三方中转"的供应商 —— 当前是 deepseek，且不是官方地址', () => {
  const relayed = providersWithNonOfficialDefault();
  assert(relayed.includes('deepseek'), 'deepseek 必须被标为默认走中转');
  const fact = providerEndpointFact('deepseek');
  assert(fact.relayedByDefault === true, 'deepseek 的 relayedByDefault 必须为 true');
  assert(fact.proxyTarget !== fact.officialUrl, 'deepseek 的默认目标与官方地址必须不同（否则标记没意义）');
  assert(fact.proxyTarget.includes('openrouter.fans'), `默认目标应指向 openrouter.fans，实际 ${fact.proxyTarget}`);
  assert(fact.officialUrl === 'https://api.deepseek.com', `官方地址应为 api.deepseek.com，实际 ${fact.officialUrl}`);
  // 其余 7 个必须与官方一致，否则界面提示会误导
  for (const p of AI_PROVIDERS) {
    if (p.id === 'deepseek') continue;
    const f = providerEndpointFact(p.id);
    assert(f.proxyTarget === f.officialUrl, `${p.id} 的默认目标应等于官方地址`);
    assert(!f.relayedByDefault, `${p.id} 不应被标为走中转`);
  }
});

test('事实表与 vercel.json / vite.config.ts 的转发目标一致（防止改了代码没改转发）', () => {
  const vercel = read('vercel.json');
  assert(/api-proxy\/deepseek[\s\S]{0,80}openrouter\.fans/.test(vercel), 'vercel.json 的 deepseek 转发目标应仍是 openrouter.fans');
  assert(/api-proxy\/openai[\s\S]{0,80}api\.openai\.com/.test(vercel), 'vercel.json 的 openai 转发目标应是 api.openai.com');
  assert(/api-proxy\/claude[\s\S]{0,80}api\.anthropic\.com/.test(vercel), 'vercel.json 的 claude 转发目标应是 api.anthropic.com');
  const vite = read('vite.config.ts');
  assert(/api-proxy\/deepseek[\s\S]{0,120}openrouter\.fans/.test(vite), 'vite.config.ts 的 deepseek dev 代理目标应仍是 openrouter.fans');
});

console.log('aiEndpoints：通道判定（proxy / relay / direct）');

test('没填自定义地址 → 走同源代理（零回归，这是现状）', () => {
  const d = decideAiTransport({ customUrl: '' });
  assert(d.transport === 'proxy', `应为 proxy，实际 ${d.transport}`);
  assert(decideAiTransport({ customUrl: null }).transport === 'proxy', 'null 也应视为没填');
  assert(decideAiTransport({ customUrl: '   ' }).transport === 'proxy', '纯空白也应视为没填');
  assert(d.reason.includes('同源'), '理由要说明为什么安全');
});

test('填了同源相对路径 → 直连（自建网关场景）', () => {
  const d = decideAiTransport({ customUrl: '/api-proxy/deepseek' });
  assert(d.transport === 'direct', `应为 direct，实际 ${d.transport}`);
  assert(isSameOriginUrl('/api-proxy/deepseek') === true, '同源判断应成立');
  assert(isSameOriginUrl('https://api.deepseek.com') === false, '绝对地址不是同源');
});

test('填了绝对地址 → 经服务端转发（否则会被 CORS 拦）', () => {
  const d = decideAiTransport({ customUrl: 'https://my-relay.example.com/v1' });
  assert(d.transport === 'relay', `应为 relay，实际 ${d.transport}`);
  assert(d.reason.includes('跨域') || d.reason.includes('转'), '理由要说明为什么不是直连');
  assert(d.reason.includes('不保存') || d.reason.includes('不记录'), '要如实说明 Key 的流向');
});

test('用户明确选直连 → 尊重选择，但仍提示跨域风险', () => {
  const d = decideAiTransport({ customUrl: 'https://my-relay.example.com/v1', preferDirect: true });
  assert(d.transport === 'direct', `应为 direct，实际 ${d.transport}`);
  assert(d.reason.includes('跨域'), '直连时必须提示对方要允许跨域');
});

console.log('aiEndpoints：SSRF 目标校验（服务端转发前必须过这一关）');

const DANGEROUS = [
  'http://127.0.0.1:8080/v1/chat/completions',
  'http://localhost/v1',
  'http://localhost:3000/api',
  'http://169.254.169.254/latest/meta-data',
  'http://10.0.0.5/v1',
  'http://172.16.5.4/v1',
  'http://172.31.255.1/v1',
  'http://192.168.1.1/v1',
  'http://100.64.0.1/v1',
  'http://0.0.0.0/v1',
  'http://[::1]/v1',
  'http://[fd00::1]/v1',
  'http://[fe80::1]/v1',
  'http://metadata.google.internal/computeMetadata/v1',
  'http://nas/v1',
  'http://router/v1',
  'http://printer.local/v1',
  'http://intranet.internal/v1',
  'file:///etc/passwd',
  'ftp://example.com/v1',
  'https://user:pass@example.com/v1',
  'javascript:alert(1)',
  'not-a-url',
  '',
];

test(`危险地址全部被拒（共 ${DANGEROUS.length} 个）`, () => {
  const leaked: string[] = [];
  for (const url of DANGEROUS) {
    const res = validateRelayTarget(url);
    if (res.ok) {
      leaked.push(url || '(空字符串)');
      continue;
    }
    const reason: string = res.reason;
    assert(reason.length > 0, `${url} 的拒绝理由不能为空`);
  }
  assert(leaked.length === 0, `这些地址没被拒绝：${leaked.join(', ')}`);
});

test('合法的第三方中转地址被放行', () => {
  const ok = [
    'https://my-relay.example.com/v1',
    'https://api.deepseek.com/v1/chat/completions',
    'http://relay.example.cn:8080/v1',
    'https://1.1.1.1/v1',
  ];
  for (const url of ok) {
    const res = validateRelayTarget(url);
    if (!res.ok) {
      const reason: string = res.reason;
      throw new Error(`应放行却拒绝了：${url}（${reason}）`);
    }
    assert(res.url === url, '应原样返回地址');
  }
});

test('校验只做字面量，不做 DNS 解析（诚实边界要写在注释里）', () => {
  const src = read('src/utils/aiEndpoints.ts');
  assert(/不做 DNS 解析/.test(src), '必须写明"未做 DNS 解析后复核"这一边界');
  assert(/多租户/.test(src), '必须写明上线到多租户前需要补解析后复核');
});

console.log('aiEndpoints：源码级守卫');

test('服务端转发路由必须复用同一份校验（不许两边各写一份）', () => {
  const route = read('api/ai/[action].ts');
  assert(route.includes('validateRelayTarget'), 'api/ai 必须调用 validateRelayTarget');
  assert(route.includes('verifyToken'), 'api/ai 必须要求登录');
  assert(route.includes('redactSecrets') || route.includes('maskKey'), 'api/ai 必须做密钥脱敏');
  const src = read('src/utils/aiEndpoints.ts');
  assert(!/function validateRelayTarget[\s\S]*?function validateRelayTarget/.test(src), '校验函数只应有一处实现');
});

test('设置页不把绝对地址预填进输入框（避免静默把所有请求变成跨域）', () => {
  const panel = read('src/components/AiSettingsPanel.tsx');
  assert(!/value=\{officialUrl\}/.test(panel), '不得把官方地址直接作为输入框的 value');
  assert(panel.includes('decideAiTransport'), '设置页应使用通道判定来说明实际会怎么发请求');
  assert(panel.includes('providerRequiresCustomUrl'), '设置页应识别"必须自填地址"的供应商');
  assert(panel.includes('本站默认转发到'), '必须把本站默认实际转发目标显示出来（deepseek 走中转这件事要可见）');
  assert(panel.includes('不保存、不记录'), '走服务端转发时要如实说明 Key 的流向');
});

test('运行时真的会走转发：文本与视觉两条 AI 调用路径都经过同一判定', () => {
  const src = read('src/utils/aiConfig.ts');
  assert(src.includes('sendOpenAICompatOnce'), '应存在统一的发送函数');
  const uses = src.match(/await sendOpenAICompatOnce\(/g) || [];
  assert(uses.length >= 2, `文本与视觉两条路径都应使用它，实际 ${uses.length} 处`);
  assert(src.includes("fetch('/api/ai/chat'"), '转发通道必须调用 /api/ai/chat');
  assert(/decision\.transport !== 'relay'/.test(src), '非 relay 时应保持原样直连（零回归）');
  // 直连只允许出现在两处：统一发送函数内部、以及流式函数（流式无法经转发，已在入口降级）
  const direct = src.match(/const res = await fetch\(endpoint, \{/g) || [];
  assert(direct.length === 2, `直连 fetch 应恰好 2 处（发送函数 + 流式），实际 ${direct.length} 处`);
});

test('流式经转发时降级为一次性返回，不静默失败', () => {
  const src = read('src/utils/aiConfig.ts');
  const stream = src.slice(src.indexOf('export async function* streamText'));
  assert(/transport === 'relay'/.test(stream), 'streamText 必须在入口判定 relay');
  assert(/yield text;/.test(stream), 'relay 时应降级为一次性返回整段文本');
  assert(/不支持流式|退化成一次性/.test(stream), '降级原因要写在代码里');
});

console.log('aiEndpoints：上游返回解析（中转站填错时的提示必须能照着改）');

test('正常的 OpenAI 兼容返回 → 取到 content', () => {
  const r = parseRelayUpstream(200, JSON.stringify({ choices: [{ message: { content: '你好' } }] }));
  assert(r.ok, `应解析成功：${r.error}`);
  assert(r.content === '你好', `content 不对：${r.content}`);
});

test('上游返回网页（把首页当 API 地址）→ 明确提示要填完整 API 地址', () => {
  const r = parseRelayUpstream(200, '<!DOCTYPE html><html><body>Welcome</body></html>');
  assert(!r.ok, '不应判定成功');
  assert(r.error.includes('网页'), '要指出拿到的是网页');
  assert(r.error.includes('/v1'), '要给出可照着改的建议');
});

test('上游 401/429 → 带上游状态与信息（便于用户判断是 Key 还是额度问题）', () => {
  const r = parseRelayUpstream(401, JSON.stringify({ error: { message: 'invalid api key' } }));
  assert(!r.ok, '不应判定成功');
  assert(r.error.includes('401') && r.error.includes('invalid api key'), `错误信息不完整：${r.error}`);
});

test('上游格式不是 OpenAI 兼容 → 提示确认中转站接口形态', () => {
  const r = parseRelayUpstream(200, JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }));
  assert(!r.ok, '不应判定成功');
  assert(r.error.includes('OpenAI 兼容'), `应提示兼容性：${r.error}`);
});

test('空返回与非 JSON 都能给出人话', () => {
  assert(!parseRelayUpstream(200, '').ok, '空返回应失败');
  const r = parseRelayUpstream(502, 'Bad Gateway');
  assert(!r.ok && r.error.includes('JSON'), `应提示不是 JSON：${r.error}`);
});

console.log('aiModels：获取模型列表（请求计划 + 各单位返回形状）');

test('模型列表路径与鉴权方式逐家正确（这是"点一下列不出来"的高发点）', () => {
  // OpenAI 兼容：/v1/models + Bearer
  const openai = planModelsRequest({ provider: 'openai' });
  assert(openai.url === '/api-proxy/openai/v1/models', `openai 路径不对：${openai.url}`);
  assert(openai.authStyle === 'bearer', 'openai 应用 Bearer');
  assert(openai.transport === 'proxy', '内置供应商默认走同源代理');

  // 智谱：路径不同
  const zhipu = planModelsRequest({ provider: 'zhipu' });
  assert(zhipu.url.endsWith('/api/paas/v4/models'), `智谱路径不对：${zhipu.url}`);

  // 豆包：v3 段在 base 里
  const doubao = planModelsRequest({ provider: 'doubao' });
  assert(doubao.url.endsWith('/api/v3/models'), `豆包路径不对：${doubao.url}`);

  // Claude：x-api-key + anthropic-version
  const claude = planModelsRequest({ provider: 'claude' });
  assert(claude.authStyle === 'x-api-key', 'Claude 应用 x-api-key');
  assert(claude.extraHeaders['anthropic-version'], 'Claude 必须带 anthropic-version');

  // Gemini：Key 在 query
  const gemini = planModelsRequest({ provider: 'gemini' });
  assert(gemini.authStyle === 'query', 'Gemini 的 Key 应在 query');
  assert(gemini.url.includes('/v1beta/models'), `Gemini 路径不对：${gemini.url}`);
});

test('Key 按各自方式落到正确位置', () => {
  const bearer = modelsAuthHeaders(planModelsRequest({ provider: 'openai' }), 'sk-abc');
  assert(bearer.Authorization === 'Bearer sk-abc', 'Bearer 方式不对');
  const xkey = modelsAuthHeaders(planModelsRequest({ provider: 'claude' }), 'sk-ant-abc');
  assert(xkey['x-api-key'] === 'sk-ant-abc', 'x-api-key 方式不对');
  assert(xkey['anthropic-version'], 'Claude 的额外头不能丢');
  const g = modelsUrlWithKey(planModelsRequest({ provider: 'gemini' }), 'AIza123');
  assert(g.includes('key=AIza123'), `Gemini 的 Key 应拼进 query：${g}`);
  // 非 query 方式不应改 URL
  assert(modelsUrlWithKey(planModelsRequest({ provider: 'openai' }), 'sk-abc').includes('key=') === false, 'Bearer 方式不应改 URL');
});

test('填了自定义地址 → 取模型也走服务端转发（否则被 CORS 拦）', () => {
  const plan = planModelsRequest({ provider: 'custom', customBaseUrl: 'https://relay.example.com/v1' });
  assert(plan.transport === 'relay', `应判定为 relay，实际 ${plan.transport}`);
  assert(plan.url.startsWith('https://relay.example.com/v1'), `地址不对：${plan.url}`);
  assert(plan.note.includes('不保存'), '要如实说明 Key 的流向');
});

test('自定义供应商没填地址 → 明确让人先填，而不是拼一个坏地址', () => {
  const plan = planModelsRequest({ provider: 'custom' });
  assert(plan.url === '', '不应给出地址');
  assert(plan.note.includes('请先填写'), `应提示先填地址：${plan.note}`);
});

test('解析：OpenAI 兼容 / Gemini / 纯数组 / 中转包装 四种形状都能认', () => {
  const openai = parseModelsResponse(200, JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }));
  assert(openai.ok && openai.models.length === 2, `OpenAI 形状没认出来：${openai.error}`);

  const gemini = parseModelsResponse(200, JSON.stringify({ models: [{ name: 'models/gemini-2.0-flash' }] }));
  assert(gemini.ok && gemini.models[0] === 'gemini-2.0-flash', `Gemini 应去掉 models/ 前缀：${gemini.models[0]}`);

  const plain = parseModelsResponse(200, JSON.stringify(['a-model', 'b-model']));
  assert(plain.ok && plain.models.length === 2, '纯数组没认出来');

  const wrapped = parseModelsResponse(200, JSON.stringify({ data: { models: [{ id: 'x' }] } }));
  assert(wrapped.ok && wrapped.models[0] === 'x', '中转包装形状没认出来');
});

test('解析：去重 + 排序 + 各类失败都给能照着改的中文', () => {
  const dup = parseModelsResponse(200, JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] }));
  assert(dup.models.length === 2 && dup.models[0] === 'a', '应去重并排序');

  const html = parseModelsResponse(200, '<!DOCTYPE html><html>welcome</html>');
  assert(!html.ok && html.error.includes('/v1'), `首页当地址应给建议：${html.error}`);

  const notJson = parseModelsResponse(502, 'Bad Gateway');
  assert(!notJson.ok && notJson.error.includes('JSON'), '非 JSON 应说明');

  const empty = parseModelsResponse(200, '');
  assert(!empty.ok && empty.error.includes('空'), '空返回应说明');

  const noList = parseModelsResponse(200, JSON.stringify({ foo: 'bar' }));
  assert(!noList.ok && noList.error.includes('手动填写'), '无模型列表应提示可手填');

  const err = parseModelsResponse(401, JSON.stringify({ error: { message: 'invalid api key' } }));
  assert(!err.ok && err.error.includes('401'), '上游错误应带上状态');
});

console.log('aiModels：源码级守卫');

test('界面有「获取模型」按钮，且与聊天共用同一通道判定', () => {
  const panel = read('src/components/AiSettingsPanel.tsx');
  assert(panel.includes('获取模型'), '必须有「获取模型」按钮');
  assert(panel.includes('fetchAvailableModels'), '按钮应调用 fetchAvailableModels');
  assert(panel.includes('planModelsRequest'), '应显示这次取模型会怎么发');
  assert(!panel.includes("fetch('https://api.openai.com"), '界面不得绕过通道判定直连官方站点');

  const cfg = read('src/utils/aiConfig.ts');
  assert(cfg.includes("fetch('/api/ai/models'"), '转发通道应调用 /api/ai/models');

  const route = read('api/ai/[action].ts');
  assert(route.includes('parseModelsResponse'), '服务端解析必须复用同一份实现');
  assert(/models,\s*\n?\s*chat|chat,\s*\n?\s*models/.test(route.replace(/\s+/g, ' ')) || route.includes('models:'), 'models action 必须注册');
  assert(route.includes('validateRelayTarget'), '取模型列表同样要过 SSRF 校验');
});

test('浏览器直连开关：勾了就不经服务端，Key 不进本站', () => {
  const relayed = decideAiTransport({ customUrl: 'https://api.deepseek.com/v1' });
  assert(relayed.transport === 'relay', '默认应经服务端转发');

  const direct = decideAiTransport({ customUrl: 'https://api.deepseek.com/v1', preferDirect: true });
  assert(direct.transport === 'direct', `勾选直连后应为 direct，实际 ${direct.transport}`);
  assert(direct.reason.includes('跨域'), '直连必须提示对方要允许跨域');

  // 取模型列表同样尊重该开关
  const m = planModelsRequest({ provider: 'deepseek', customBaseUrl: 'https://api.deepseek.com/v1', preferDirect: true });
  assert(m.transport === 'direct', `取模型也应直连，实际 ${m.transport}`);

  // 设置项要能存下来并被净化
  const kept = sanitizeAiSettings({
    provider: 'deepseek',
    apiKey: 'k',
    model: 'deepseek-flash',
    allowBrowserDirect: true,
  });
  assert(kept.allowBrowserDirect === true, 'allowBrowserDirect 必须被保留');
  const dropped = sanitizeAiSettings({ provider: 'deepseek', apiKey: 'k', model: 'm' });
  assert(dropped.allowBrowserDirect === false, '未勾选时应显式落成 false');
});

test('构建指纹：诊断面板与启动日志都要能看出"这是哪次构建"', () => {
  const vite = read('vite.config.ts');
  assert(vite.includes('__BUILD_STAMP__'), 'vite.config 必须注入构建指纹');
  assert(vite.includes('VERCEL_GIT_COMMIT_SHA'), '线上应带上 commit 短哈希');
  const diag = read('src/components/SystemDiagnosticsPanel.tsx');
  assert(diag.includes('BUILD_STAMP'), '诊断面板必须显示构建指纹');
  assert(diag.includes('前端构建'), '要用中文写清楚这一行是什么');
  assert(/typeof __BUILD_STAMP__ === 'string'/.test(diag), '未注入时要有兜底，不能白屏');
  const main = read('src/main.tsx');
  assert(main.includes('__BUILD_STAMP__'), '启动时应把指纹打到控制台');
  const dts = read('src/vite-env.d.ts');
  assert(dts.includes('declare const __BUILD_STAMP__'), '全局声明要写进 vite-env.d.ts');
});

test('界面提供「浏览器直连」开关（有些接口确实允许跨域）', () => {
  const panel = read('src/components/AiSettingsPanel.tsx');
  assert(panel.includes('allowBrowserDirect'), '设置页必须有该开关');
  assert(panel.includes('浏览器直连'), '开关文案要说人话');
  assert(panel.includes('不经过本站服务端'), '要如实说明勾选后的数据流向');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

