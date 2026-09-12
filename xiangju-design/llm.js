/* ============================================================
 * 乡居设计通 · 真实大模型接入层（DeepSeek / OpenAI 兼容协议）
 *  - 浏览器直连 /chat/completions（支持 tools/function calling）
 *  - Key / baseUrl / model 仅存本机 localStorage，不随代码提交
 *  - 未配置或调用失败时由 app.js 明确提示并切回演示话术，绝不伪装成 AI
 * ============================================================ */
'use strict';

const LLM = (() => {

  const STORE_KEY = 'xjsd_llm_cfg_v1';
  const DEFAULT_BASE = 'https://api.deepseek.com';
  const DEFAULT_MODEL = 'deepseek-chat';

  /* viaProxy=true：密钥在服务端代理（Worker / 本地 Python），浏览器不持 Key；
     此时 apiKey 字段复用为“代理访问口令 APP_TOKEN”（可空） */
  const PRESETS = [
    { name: '我的 Cloudflare Worker 代理（推荐，Key 藏服务端）', base: 'https://你的worker地址.workers.dev/v1',
      models: ['deepseek-chat'], viaProxy: true,
      hint: '先部署 proxy-worker 并 wrangler secret put DEEPSEEK_API_KEY，再把这里换成你的 Worker 地址（含 /v1）。' },
    { name: '本地一键代理（local_proxy.ps1 / .py，演示用）', base: 'http://127.0.0.1:8788/v1',
      models: ['deepseek-chat'], viaProxy: true,
      hint: '双击/运行 local_proxy.ps1（Windows 零安装，推荐）并粘贴 Key；或有 Python 时运行 local_proxy.py。页面直接开 http://127.0.0.1:8788/ 还能免跨域。' },
    { name: 'DeepSeek 直连（浏览器持有 Key）', base: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { name: '通义千问(兼容模式)', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-flash'] },
    { name: '硅基流动', base: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-V2.5'] },
    { name: 'OpenAI / 自定义兼容网关', base: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o'] }
  ];

  function loadCfg() {
    try {
      return Object.assign({ baseUrl: DEFAULT_BASE, apiKey: '', model: DEFAULT_MODEL, viaProxy: false },
        JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
    } catch (e) { return { baseUrl: DEFAULT_BASE, apiKey: '', model: DEFAULT_MODEL, viaProxy: false }; }
  }
  function saveCfg(cfg) {
    const cur = loadCfg();
    localStorage.setItem(STORE_KEY, JSON.stringify({
      baseUrl: cfg.baseUrl || cur.baseUrl,
      model: cfg.model || cur.model,
      apiKey: cfg.apiKey != null ? cfg.apiKey : cur.apiKey,
      viaProxy: !!(cfg.viaProxy != null ? cfg.viaProxy : cur.viaProxy)
    }));
  }
  function configured() {
    const cfg = loadCfg();
    if (cfg.viaProxy) return /^https?:\/\/.+/i.test(cfg.baseUrl) && !/你的worker地址/.test(cfg.baseUrl);
    return !!cfg.apiKey.trim();
  }

  /* ---------------- 系统提示词与工具定义 ---------------- */

  function systemPrompt(snapshot) {
    return `你是“乡居设计通”公益热线的人工客服，名字叫小居，28岁，热情、耐心、像亲侄女一样。
你的客户是50~70岁、小学没毕业、在外打工二十多年、准备回老家花约50万盖自建房的农村大妈。她们说各地方言，不会说普通话书面语，容易答非所问。

【说话风格 · 必须遵守】
1. 一次只问一个问题，等大妈回答了再问下一个；句子短、大白话，多用“嘞、呀、嘛、您看”，禁用任何专业术语（如“宅基地面积”改成“那块地有好大”）。
2. 对方言口语直接听懂、不纠正（如：灶屋=厨房，茅司/茅厮=厕所，坝子/院坝=院子，猪栏/圈圈=猪圈，睡房=卧室，要得=好的，好多钱=多少钱）。
3. 听到数字主动换算成标准值：1分地≈66.67㎡，1亩≈666.67㎡；“五十万左右/上下”按50；“三四十万”按35；“两层半”按3层（三层做晒台）。
4. 对不合理输入温和追问；拿不准的信息绝不替大妈猜；拿到关键信息后用她能懂的话复述确认。
5. 绝对不要提 AI、模型、JSON、工具、系统这些词；你就是打电话的人工客服小居。

【需要逐项问全的信息（按此顺序，一项一项来）】
- region 建房省份：必须是可识别的中国省级名称（如 四川、河南、广东），必要时问清是县还是省；
- terrain 地势：平原 / 镇上 / 丘陵 / 山区；
- floors 层数：1~3 的整数（两层半记为3）；
- plot 宅基地面积㎡：按上面的换算折成平方米，合理范围 30~800；
- budget 预算（万元）：10~300；
- bedrooms 卧室间数：1~8；
- kitchen 厨房：big=大厨房（通常要柴火灶）/ mid=一般大 / small=小厨房（电气化）；
- toilet 厕所：indoor=室内马桶淋浴 / outhouse=院头旱厕 / both=室内加院里旱厕；
- pig / chicken / storage：要不要猪圈、鸡(鸭鹅)圈、杂物间（布尔值，明确说不要也要如实记 false）；
- hall / yard：要不要堂屋、院坝（布尔）；
- priority 最看重：save=省钱结实 / elder=养老方便 / fancy=气派好看 / family=儿孙回来住得下。

【工具调用纪律】
1. 每次从大妈话里听到新信息，立即调用 update_requirements 记录，只传本次新确认或需要修改的字段；不要因为一个字段没问就跳过其他已明确的信息。
2. 调用后看工具返回：它会告诉你还缺哪些项，就按顺序继续问下一项；若提示“信息已齐”，你要用家常话把全部信息复述一遍并问“要得不/行不行”，**必须拿到大妈明确同意后**，再调用 finish_intake 出图。
3. 大妈要改信息时，调用 update_requirements 覆盖对应字段，然后重新复述确认。
4. 复述确认前，严禁调用 finish_intake。

【当前已记录】
${snapshot}

【当前阶段】
等下一次用户发言或开场问候。开场先亲热问候，说明“用家乡话说就行，我听得懂”，然后只问第一个问题：在哪个省盖房。`;
  }

  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'update_requirements',
        description: '把刚刚从大妈话里确认的建房需求记录/更新到工单。每次只传本次新确认或有改动的字段。',
        parameters: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '建房所在省/直辖市/自治区的标准名称，如 四川、河南、内蒙古、广西' },
            terrain: { type: 'string', enum: ['平原', '镇上', '丘陵', '山区'] },
            floors: { type: 'integer', minimum: 1, maximum: 3 },
            plot: { type: 'number', description: '宅基地面积，单位平方米（1分地≈66.67㎡，1亩≈666.67㎡）', minimum: 30, maximum: 800 },
            budget: { type: 'number', description: '建房总预算，单位万元', minimum: 10, maximum: 300 },
            bedrooms: { type: 'integer', minimum: 1, maximum: 8 },
            kitchen: { type: 'string', enum: ['big', 'mid', 'small'], description: 'big大厨房带柴火灶 / mid一般大 / small小厨房电气化' },
            toilet: { type: 'string', enum: ['indoor', 'outhouse', 'both'], description: 'indoor室内马桶 / outhouse院头旱厕 / both两者都要' },
            pig: { type: 'boolean' }, chicken: { type: 'boolean' }, storage: { type: 'boolean' },
            hall: { type: 'boolean', description: '要不要堂屋' },
            yard: { type: 'boolean', description: '要不要院坝/院子' },
            priority: { type: 'string', enum: ['save', 'elder', 'fancy', 'family'] }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'finish_intake',
        description: '当全部信息问齐、且已经向大妈复述并得到明确同意（如“要得/行/就这样”）后调用，系统据此出初步设计图。',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  /* ---------------- 会话状态 ---------------- */

  let history = [];

  function reset(snapshot) {
    history = [{ role: 'system', content: systemPrompt(snapshot || '（尚无记录）') }];
  }

  function refreshSystem(snapshot) {
    if (history.length && history[0].role === 'system') history[0].content = systemPrompt(snapshot);
  }

  /* ---------------- 底层请求 ---------------- */

  async function request(messages, opts) {
    const cfg = loadCfg();
    if (!configured()) {
      throw makeError('nokey', cfg.viaProxy ? '代理地址还没填好，请在“大模型设置”里粘贴代理地址（含 /v1）' : '还没有填写 API Key');
    }
    const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.viaProxy) {
      /* 代理模式：密钥在服务端；apiKey 字段存的是可选的访问口令 */
      if (cfg.apiKey.trim()) headers['X-App-Token'] = cfg.apiKey.trim();
    } else {
      headers['Authorization'] = 'Bearer ' + cfg.apiKey.trim();
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeoutMs) || 45000);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model || DEFAULT_MODEL,
          messages,
          tools: opts && opts.withTools ? TOOLS : undefined,
          tool_choice: opts && opts.withTools ? 'auto' : undefined,
          temperature: opts && opts.temperature != null ? opts.temperature : 0.6,
          max_tokens: opts && opts.maxTokens || 600
        }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw makeError('timeout', '大模型响应超时（45秒），信号不好时可以再说一遍');
      throw makeError('network', '连不上模型服务，可能是网络问题或浏览器拦截了跨域请求（CORS）');
    }
    clearTimeout(timer);

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json()).error.message || ''; } catch (e) {}
      if (resp.status === 401) throw makeError('auth', 'API Key 不对或已失效，请点右上角“模型设置”检查（' + detail + '）');
      if (resp.status === 402 || resp.status === 429) throw makeError('quota', '账户余额/额度不足或请求太频繁：' + detail);
      if (resp.status === 404) throw makeError('model', '模型名或接口地址不对（' + cfg.model + '），请在模型设置里核对：' + detail);
      throw makeError('http', '模型服务返回错误 ' + resp.status + (detail ? '：' + detail : ''));
    }
    const data = await resp.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw makeError('empty', '模型没有返回内容，请再说一遍试试');
    return msg;
  }

  function makeError(type, text) { const e = new Error(text); e.type = type; return e; }

  /* ---------------- 对外：一轮对话（可含多次工具续轮） ----------------
   * hooks: { onAgentText(text), onTool(patch), onFinish(), snapshot(), gateFinish() }
   * --------------------------------------------------------------------- */
  async function turn(userText, hooks) {
    if (userText !== null) history.push({ role: 'user', content: userText });

    for (let i = 0; i < 6; i++) {
      refreshSystem(hooks.snapshot());
      const msg = await request(history, { withTools: true, temperature: 0.6 });
      history.push(msg);

      if (msg.content && msg.content.trim()) {
        hooks.onAgentText(msg.content.trim());
      }

      const calls = msg.tool_calls || [];
      if (!calls.length) return; /* 模型这一轮只想说话，等大妈回答 */

      for (const call of calls) {
        let patch = {};
        try { patch = JSON.parse(call.function.arguments || '{}'); } catch (e) { patch = {}; }
        let resultText;

        if (call.function.name === 'update_requirements') {
          const clean = hooks.onTool(patch); /* 返回 {accepted, missing, allDone, awaitingConfirm} */
          resultText = JSON.stringify(clean);
        } else if (call.function.name === 'finish_intake') {
          const gate = hooks.gateFinish();
          if (gate.ok) {
            history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, text: '用户已确认，正在生成设计图' }) });
            hooks.onFinish();
            return;
          }
          resultText = JSON.stringify({ ok: false, reason: gate.reason, missing: gate.missing });
        } else {
          resultText = JSON.stringify({ ok: false, reason: '未知工具' });
        }
        history.push({ role: 'tool', tool_call_id: call.id, content: resultText });
      }
      /* 有工具调用 → 续一轮，让模型根据工具结果继续说话/追问/复述 */
    }
  }

  async function testConnection() {
    const msg = await request([{ role: 'user', content: '回复两个字：在的' }],
      { withTools: false, maxTokens: 10, temperature: 0, timeoutMs: 20000 });
    return (msg.content || '').trim();
  }

  return { PRESETS, DEFAULT_BASE, DEFAULT_MODEL, loadCfg, saveCfg, configured, reset, turn, testConnection };
})();
