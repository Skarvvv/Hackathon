/* ============================================================
 * 乡居设计通 · 应用逻辑
 *  - 通话状态机 / 渐进式提问引擎
 *  - 方言命中、中文口语数字、面积/预算解析
 *  - Web Speech 语音朗读(朗读客服话术) + 语音识别(可选)
 *  - 需求 → 气候地质规则 → SVG 平面图/立面/预算/设计说明
 * ============================================================ */
'use strict';

/* ================= 1. 工具：口语数字 / 单位 / 方言 ================= */

/* 中文口语数字：支持 "一百二"(=120)、"八十"、"俩"、"两层" 等 */
function cnToNum(str) {
  if (typeof str === 'number') return str;
  const m = String(str).match(/[零一二两俩三四五六七八九十百千\.0-9]+/);
  if (!m) return NaN;
  let s = m[0].replace(/俩/g, '2');
  if (/^[\d.]+$/.test(s)) return parseFloat(s);
  const d = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let section = 0, num = 0, hasShi = /十/.test(s);
  for (const ch of s) {
    if (ch in d) num = d[ch];
    else if (ch === '十') { section += (num || 1) * 10; num = 0; }
    else if (ch === '百') { section += num * 100; num = 0; }
    else if (ch === '千') { section += num * 1000; num = 0; }
  }
  /* "一百二" → 百后余 2 按 20 计 */
  if (num !== 0 && section >= 100 && !hasShi) return section + num * 10;
  return section + num;
}

/* 面积解析：120平 / 两分地 / 一百二十个平方 / 0.3亩 → 平方米 */
function parseArea(text) {
  const t = text.replace(/个|方地/g, '');
  let m = t.match(/([零一二两三四五六七八九十百千\d.]+)\s*(亩)/);
  if (m) return Math.round(cnToNum(m[1]) * 666.67);
  m = t.match(/([零一二两三四五六七八九十百千\d.]+)\s*分(地)?/);
  if (m) return Math.round(cnToNum(m[1]) * 66.67);
  m = t.match(/([零一二两三四五六七八九十百千\d.]+)\s*(平方米|平米|平方|平|㎡)/);
  if (m) return Math.round(cnToNum(m[1]));
  /* 裸数字按平方米兜底（仅在数字 30~1000 之间可信） */
  const n = cnToNum(t);
  if (!isNaN(n) && n >= 30 && n <= 1000 && /\d|[一二两三四五六七八九十百千]/.test(t)) return Math.round(n);
  return NaN;
}

/* 方言命中（按词条长度降序，最长匹配） */
function detectDialect(text) {
  const hits = [];
  const words = DIALECT_WORDS.slice().sort((a, b) => b.word.length - a.word.length);
  let rest = text;
  for (const w of words) {
    if (rest.indexOf(w.word) !== -1) {
      hits.push(w);
      rest = rest.split(w.word).join(''); /* 命中片段摘除，避免子串重复命中 */
    }
  }
  return hits;
}

/* 肯定 / 否定 */
function isYes(t) { return /要得|中|好|可以|行|嗯|对|没错|没问题|出图|就这样|要的/.test(t); }
function isNo(t) { return /不要|没得|没有|不养|不盖|不搞|算了|不消|莫得|无/.test(t); }

/* ================= 2. 需求槽位 + 问卷脚本 ================= */

const defaultSlots = () => ({
  region: null, terrain: null, floors: null, plot: null,
  budget: null, bedrooms: null, kitchen: null, toilet: null,
  pig: false, chicken: false, storage: false, outhouse: false,
  hall: null, yard: null, priority: null
});

const QUESTIONS = [
  {
    id: 'region',
    ask: '大娘您好！我是乡居设计通的客服小居。今天打这个电话，就是想陪您把新房子的样子聊出来，大概耽误您十分钟，您用家乡话说就行，我听得懂。——您打算在哪个省、哪个地方盖房呀？',
    chips: ['四川', '河南', '湖南', '广东', '贵州', '陕西', '广西', '安徽'],
    parse(t) {
      for (const a in REGION_ALIAS) if (t.indexOf(a) !== -1) return REGION_ALIAS[a];
      const hits = Object.keys(REGIONS).filter(p => t.indexOf(p.replace(/省|市|壮族自治区|回族|维吾尔自治区|自治区/g, '')) !== -1 || t.indexOf(p) !== -1);
      return hits.length ? hits[0] : null;
    },
    retry: '莫急，您就跟我说个省名就行，比如“四川”“河南”，您看是哪儿呀？'
  },
  {
    id: 'terrain',
    ask: '好嘞！那您家那块地，是在平坝坝的平原上，还是镇子边上，或者是丘陵坡地、大山里头呀？',
    chips: ['平原坝子里', '镇子边上', '丘陵坡地上', '大山沟里头'],
    parse(t) {
      if (/平原|平坝|坝里|坝区|川道|塬上/.test(t)) return '平原';
      if (/镇|街|村边|路边|城郊/.test(t)) return '镇上';
      if (/丘陵|坡地|坡上|半山|梁上/.test(t)) return '丘陵';
      if (/山|沟|坳|岭|寨/.test(t)) return '山区';
      return null;
    },
    retry: '您就说地势平不平：是平原、镇上、坡地、还是山里？'
  },
  {
    id: 'floors',
    ask: '房子打算盖几层呢？是盖个平房，还是两层、两层半、三层的小洋楼？',
    chips: ['就盖一层平房', '盖两层', '两层半', '盖三层'],
    parse(t) {
      if (/两层半|2层半|二层半/.test(t)) return 3; /* 两层半按三层处理，三层做晒台 */
      if (/平房|一层|1层/.test(t)) return 1;
      if (/三层|3层|三楼/.test(t)) return 3;
      if (/两层|2层|二楼|俩层|小洋楼|半层/.test(t)) return 2;
      const n = cnToNum(t);
      if (!isNaN(n) && n >= 1 && n <= 3) return n;
      return null;
    },
    retry: '您说个层数就行：一层、两层，还是三层？'
  },
  {
    id: 'plot',
    ask: '您那块宅基地大概多大呀？按“平”说也行，按“分”“亩”说也行。比如“一百二十平”“两分地”，我都听得懂。',
    chips: ['一分地，大概67平', '两分地，130来平', '一百五十平', '三分地，200平'],
    parse(t) {
      const n = parseArea(t);
      if (isNaN(n) || n < 30 || n > 800) return NaN;
      return n;
    },
    invalid: '这个数我没大听懂。您再说说，比如“一百二十平”或者“两分地”？',
    retry: '地方有好大，您给我个大概数：多少平，或者几分地？'
  },
  {
    id: 'budget',
    ask: '盖房的钱您大概准备了多少万呀？除了主体，咱们还得留点装修和院子的钱。',
    chips: ['三四十万', '五十万左右', '六十来万', '钱够，不差钱'],
    parse(t) {
      let m = t.match(/([零一二两三四五六七八九十百千\d.]+)\s*万/);
      if (m) {
        if (/[三四]十/.test(m[1]) && /^[三四]/.test(m[1])) {
          if (m[1][0] === '三') return 35;
          if (m[1][0] === '四') return 45;
        }
        const n = cnToNum(m[1]);
        if (!isNaN(n) && n >= 10 && n <= 300) return Math.round(n);
      }
      if (/不差钱|钱够|随便花|越多越好/.test(t)) return 80;
      if (/三四十/.test(t)) return 35;
      if (/五六十/.test(t)) return 60;
      return null;
    },
    retry: '您说个大概数就行：准备了好多万？比如“五十万”。'
  },
  {
    id: 'bedrooms',
    ask: '家里想要几个卧室（睡房）呀？您和老伴一间在一楼，过年儿孙回来得住，您算上他们那份。',
    chips: ['两间够了', '三间', '四间', '五六间'],
    parse(t) {
      if (/五六|5\s*6/.test(t)) return 6;
      const m = t.match(/([零一二两俩三四五六七八九十\d]+)\s*[间个]?/);
      const n = cnToNum(m ? m[1] : t);
      if (!isNaN(n) && n >= 1 && n <= 8) return n;
      return null;
    },
    retry: '您就给我个数：要几间睡房？两间、三间还是四间？'
  },
  {
    id: 'kitchen',
    ask: '厨房（灶屋）想要大点还是小一点？要不要留个烧柴的柴火灶？',
    chips: ['要大厨房，带柴火灶', '一般大就行', '小一点，用煤气电器'],
    parse(t) {
      /* “一般大”要先于 /大/ 判断，否则会被误判成大厨房 */
      if (/一般|中等|普通|差不多|随缘/.test(t)) return 'mid';
      if (/大|宽敞|柴火|烧柴|火房/.test(t)) return 'big';
      if (/小|窄|凑活|煤气|电器/.test(t)) return 'small';
      return null;
    },
    retry: '厨房您想要大的还是小的？大的我给您配柴火灶。'
  },
  {
    id: 'toilet',
    ask: '厕所咋安排？是屋里装马桶带淋浴，还是院里头再留个老式蹲坑（旱厕）？',
    chips: ['屋里要马桶和淋浴', '屋里马桶，院里再留个蹲坑', '就搞个老式旱厕'],
    parse(t) {
      const indoor = /马桶|卫生间|淋浴|洗澡|冲水/.test(t);
      const out = /旱厕|蹲坑|茅|老式/.test(t);
      if (indoor && out) return 'both';
      if (indoor) return 'indoor';
      if (out) return 'outhouse';
      return null;
    },
    retry: '您说要马桶还是蹲坑？也可以两个都要。'
  },
  {
    id: 'pen',
    ask: '还养不养牲口？猪圈、鸡圈要不要留？杂物间（杂屋）需不需要？',
    chips: ['要猪圈', '养点鸡鸭', '猪圈鸡圈都要', '都不养，留个杂物间就行'],
    parse(t) {
      if (/都不养|不养|不要|莫得|没有|算了/.test(t) && /杂物|杂屋/.test(t))
        return { pig: false, chicken: false, storage: true };
      const none = /都不养|不养|啥都不要|一样不要/.test(t);
      return {
        pig: !none && /猪/.test(t),
        chicken: !none && /鸡|鸭|鹅/.test(t),
        storage: !none && /杂物|杂屋|农具/.test(t)
      };
    },
    retry: '您告诉我养啥就行：猪、鸡鸭，还是都不养？'
  },
  {
    id: 'courtyard',
    ask: '堂屋（一进门摆酒席、待客那间正屋）和院坝要不要？堂屋敞亮、院坝可以晒谷子停车。',
    chips: ['堂屋大院坝都要', '要堂屋，院子一般', '不用堂屋，留院子就行'],
    parse(t) {
      const hall = !(/不用堂屋|不要堂屋/.test(t)) && (/堂屋/.test(t) || /都要/.test(t) || /待客/.test(t));
      const yard = !(/不要院|没得院/.test(t)) && (/院|坝|晒谷|停车|都要/.test(t));
      if (!hall && !yard) return null;
      return { hall, yard };
    },
    retry: '您说堂屋要不要、院坝要不要就行，也可以都要。'
  },
  {
    id: 'priority',
    ask: '最后问您最要紧的一条：盖这个房子，您最看重啥？是省钱结实、养老方便、气派好看，还是过年儿孙回来住得下？',
    chips: ['省钱结实最重要', '养老住着方便', '修气派有面子', '儿孙回来住得下'],
    parse(t) {
      if (/省|结实|牢固|便宜|划算/.test(t)) return 'save';
      if (/养老|方便|腿脚|扶手|防滑|老人/.test(t)) return 'elder';
      if (/气派|好看|面子|排场|风光/.test(t)) return 'fancy';
      if (/儿孙|娃|回来|过年|团圆|住得下|人多/.test(t)) return 'family';
      return null;
    },
    retry: '您挑一个最要紧的：省钱、养老方便、气派，还是儿孙住得下？'
  },
  {
    id: 'confirm',
    ask() {
      const s = S;
      const pen = [s.pig ? '猪圈' : null, s.chicken ? '鸡圈' : null, s.storage ? '杂物间' : null].filter(Boolean).join('、') || '不养牲口';
      const toilet = { indoor: '室内卫生间', outhouse: '院头旱厕', both: '室内卫生间+院里旱厕' }[s.toilet];
      return '我跟您核对一下：' + s.region + '（' + TERRAIN_TXT[s.terrain] + '）盖' + s.floors +
        '层，宅基地约' + s.plot + '平，预算' + s.budget + '万，' + s.bedrooms + '间卧室，厨房' +
        (s.kitchen === 'big' ? '大间带柴火灶' : s.kitchen === 'small' ? '小间用电器' : '一般大') +
        '，' + toilet + '，' + pen + '，' + (s.hall ? '有堂屋' : '不设堂屋') + '、' +
        (s.yard ? '有院坝' : '院子从简') + '。我按' + s.region + '当地的雨水、地震情况把地基和屋顶都考虑上，这就给您出图，要得不？';
    },
    chips: ['要得，出图！', '等一下，我再补两句'],
    parse(t) {
      if (/等|补|不对|错了|改|重新说|莫忙/.test(t)) return 'change';
      if (isYes(t)) return 'ok';
      return null;
    },
    retry: '您说“要得”我就出图；要改哪儿，您直接说。'
  }
];

const TERRAIN_TXT = { 平原: '平原坝区', 镇上: '镇子边上', 丘陵: '丘陵坡地', 山区: '山区' };
const PRIORITY_TXT = { save: '省钱结实', elder: '养老方便', fancy: '气派好看', family: '儿孙住得下' };

/* ================= 3. 状态与 DOM ================= */

let S = defaultSlots();
let qIndex = 0;
let inCall = false;
let timerId = null;
let seconds = 0;
let recognizing = false;
let recognition = null;

/* AI 模式状态 */
let aiMode = false;
let aiBusy = false;
let aiAnswered = null;      /* 已问齐项的 Set */
let awaitingConfirm = false;
let confirmReceived = false;
let typingEl = null;

const $ = id => document.getElementById(id);
const els = {};

function bindEls() {
  ['dialScreen', 'callScreen', 'startCallBtn', 'hangupBtn', 'callTimer', 'transcript',
   'chipBar', 'textInput', 'sendBtn', 'micBtn',
   'slotRows', 'climateCard', 'designSection', 'planPanel', 'planTabs', 'tabPlan',
   'tabElevation', 'tabBudget', 'tabNotes', 'panelPlan', 'panelElevation',
   'panelBudget', 'panelNotes', 'summaryStrip', 'redialBtn', 'printBtn',
   'speechStatus', 'settingsBtn', 'settingsModal', 'settingsClose', 'llmPreset',
   'llmBase', 'llmModel', 'llmKey', 'llmTest', 'llmSave', 'llmTestResult', 'modelList',
   'modeAi', 'modeScript', 'modeHint', 'aiBadge', 'aiModelName', 'llmDot',
   'llmKeyLabel', 'llmPresetHint']
  .forEach(id => { els[id] = $(id); });
}

/* ================= 4. 通话流程 ================= */

function tick() {
  seconds++;
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  els.callTimer.textContent = '通话中 ' + m + ':' + ss;
}

function openCallScreen() {
  S = defaultSlots();
  qIndex = 0;
  seconds = 0;
  awaitingConfirm = false;
  confirmReceived = false;
  aiAnswered = new Set();
  inCall = true;
  els.dialScreen.classList.add('hidden');
  els.callScreen.classList.remove('hidden');
  els.transcript.innerHTML = '';
  els.chipBar.innerHTML = '';
  els.designSection.classList.add('hidden');
  tick();
  timerId = setInterval(tick, 1000);
  renderSlots();
  els.climateCard.classList.add('hidden');
}

function startCall() {
  if (aiMode) {
    if (!LLM.configured()) {
      openSettings('请先在“大模型设置”里填上 API Key，再用 AI 模式拨打；也可以先用离线演示话术。');
      return;
    }
    openCallScreen();
    els.aiBadge.classList.remove('hidden');
    els.aiModelName.textContent = LLM.loadCfg().model;
    LLM.reset(llmSnapshot());
    showTyping();
    LLM.turn(null, llmHooks()).then(afterAiTurn).catch(aiFail);
    return;
  }
  openCallScreen();
  els.aiBadge.classList.add('hidden');
  setTimeout(() => {
    agentSay(QUESTIONS[0].ask);
    showChips(0);
  }, 500);
}

function hangup() {
  inCall = false;
  clearInterval(timerId);
  stopSpeak();
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  els.dialScreen.classList.remove('hidden');
  els.callScreen.classList.add('hidden');
  els.chipBar.innerHTML = '';
}

function showTyping() {
  hideTyping();
  typingEl = document.createElement('div');
  typingEl.className = 'typing-row';
  typingEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  els.transcript.appendChild(typingEl);
  scrollBottom();
}
function hideTyping() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

function agentSay(text, opts) {
  showTyping();
  setTimeout(() => {
    hideTyping();
    addBubble('agent', text);
    speak(text);
    if (opts && opts.after) opts.after();
  }, opts && opts.fast ? 350 : 750);
}

function addBubble(role, text, dialectHits) {
  const b = document.createElement('div');
  b.className = 'bubble ' + role;
  b.innerHTML = '<span class="bubble-text"></span>';
  b.querySelector('.bubble-text').textContent = text;
  if (dialectHits && dialectHits.length) {
    const tag = document.createElement('div');
    tag.className = 'dialect-tag';
    tag.textContent = '方言识别：' + dialectHits.map(h => h.word + '→' + h.std).join('；');
    b.appendChild(tag);
  }
  els.transcript.appendChild(b);
  scrollBottom();
}

function scrollBottom() {
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function showChips(i) {
  els.chipBar.innerHTML = '';
  const q = QUESTIONS[i];
  (q.chips || []).forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = label;
    btn.onclick = () => { if (inCall && !(aiMode && aiBusy)) handleAnswer(label); };
    els.chipBar.appendChild(btn);
  });
}

function handleAnswer(rawText) {
  const text = String(rawText).trim();
  if (!text || !inCall) return;
  if (aiMode) { aiHandle(text); return; }
  const q = QUESTIONS[qIndex];
  const dialectHits = detectDialect(text);
  addBubble('user', text, dialectHits);
  const value = q.parse(text, S);

  if (value === null || (value !== value)) { /* null 或 NaN */
    agentSay(q.invalid || q.retry, { fast: true });
    return;
  }

  /* 落槽 */
  if (q.id === 'pen') {
    S.pig = value.pig; S.chicken = value.chicken; S.storage = value.storage;
  } else if (q.id === 'courtyard') {
    S.hall = value.hall; S.yard = value.yard;
  } else if (q.id === 'toilet') {
    S.toilet = value;
    S.outhouse = (value !== 'indoor');
  } else {
    S[q.id] = value;
  }
  renderSlots();
  if (q.id === 'region') renderClimate();

  /* 确认题分支 */
  if (q.id === 'confirm') {
    if (value === 'change') {
      agentSay('要得，您说，哪一项要改？（演示版可点右上角“重新拨打”重聊一遍，正式版人工客服会陪您逐项改）', {
        after: () => { setTimeout(() => agentSay(QUESTIONS[qIndex].ask()), 1400); }
      });
      return;
    }
    finishCall();
    return;
  }

  qIndex++;
  const next = QUESTIONS[qIndex];
  setTimeout(() => {
    agentSay(typeof next.ask === 'function' ? next.ask() : next.ask);
    showChips(qIndex);
  }, 450);
}

function presentDesign(model) {
  inCall = false;
  clearInterval(timerId);
  renderSlots();
  renderDesign(model);
  els.designSection.classList.remove('hidden');
  els.designSection.scrollIntoView({ behavior: 'smooth' });
}

function finishCall(silent) {
  els.chipBar.innerHTML = '';
  const model = buildModel();
  if (silent) { presentDesign(model); return; }
  agentSay('图给您出好喽！一共' + model.floors + '层，按' + model.region + '的雨水做了' +
    model.rr.slope + '度的' + model.rr.roof + '，按' + model.rd.seis + '度抗震配了圈梁构造柱，地基埋深也按规矩考虑了。您让屋里娃帮您看手机上的图，有啥不对再打电话来！', {
    after: () => presentDesign(model)
  });
}

/* ================= 4B. AI 真人大脑通话回路 ================= */

function llmSnapshot() {
  if (!S.region) return '（尚未开始记录）';
  const lines = [
    ['省份', S.region], ['地势', S.terrain], ['层数', S.floors], ['宅基地㎡', S.plot],
    ['预算(万)', S.budget], ['卧室数', S.bedrooms],
    ['厨房', { big: '大(柴火灶)', mid: '一般', small: '小(电气化)' }[S.kitchen]],
    ['厕所', { indoor: '室内', outhouse: '旱厕', both: '室内+旱厕' }[S.toilet]],
    ['猪圈', aiAnswered.has('pen') ? (S.pig ? '要' : '不要') : ''],
    ['鸡圈', aiAnswered.has('pen') ? (S.chicken ? '要' : '不要') : ''],
    ['杂物间', aiAnswered.has('pen') ? (S.storage ? '要' : '不要') : ''],
    ['堂屋', S.hall === null ? '' : (S.hall ? '要' : '不要')],
    ['院坝', S.yard === null ? '' : (S.yard ? '要' : '不要')],
    ['最看重', PRIORITY_TXT[S.priority]]
  ].filter(x => x[1] !== null && x[1] !== '' && x[1] !== undefined);
  return lines.map(x => '- ' + x[0] + '：' + x[1]).join('\n');
}

function missingSlots() {
  const miss = [];
  ['region', 'terrain', 'floors', 'plot', 'budget', 'bedrooms',
   'kitchen', 'toilet', 'priority'].forEach(k => { if (S[k] == null) miss.push(k); });
  if (!aiAnswered.has('pen')) miss.push('pen');
  if (S.hall === null || S.yard === null) miss.push('courtyard');
  return miss;
}

/* 校验并合并模型工具调用传来的字段，返回给模型的工具结果（中文，方便它据此追问） */
function aiMerge(patch) {
  const accepted = [];
  const reject = [];
  const put = (k, v, mark) => { S[k] = v; accepted.push(k); if (mark) aiAnswered.add(mark); };

  if (typeof patch.region === 'string') {
    let r = patch.region.trim();
    if (REGION_ALIAS[r]) r = REGION_ALIAS[r];
    else if (!REGIONS[r]) r = Object.keys(REGIONS).find(p => r.indexOf(p) !== -1 || p.indexOf(r) !== -1) || null;
    if (r) { put('region', r); renderClimate(); } else reject.push('region(省份没听清)');
  }
  if (['平原', '镇上', '丘陵', '山区'].includes(patch.terrain)) put('terrain', patch.terrain);
  if ([1, 2, 3].includes(patch.floors)) put('floors', patch.floors);
  if (typeof patch.plot === 'number' && patch.plot >= 30 && patch.plot <= 800) put('plot', Math.round(patch.plot));
  else if (patch.plot != null) reject.push('plot(面积要在30~800㎡)');
  if (typeof patch.budget === 'number' && patch.budget >= 10 && patch.budget <= 300) put('budget', patch.budget);
  else if (patch.budget != null) reject.push('budget(预算要在10~300万)');
  if (Number.isInteger(patch.bedrooms) && patch.bedrooms >= 1 && patch.bedrooms <= 8) put('bedrooms', patch.bedrooms);
  if (['big', 'mid', 'small'].includes(patch.kitchen)) put('kitchen', patch.kitchen);
  if (['indoor', 'outhouse', 'both'].includes(patch.toilet)) {
    S.toilet = patch.toilet; S.outhouse = patch.toilet !== 'indoor'; accepted.push('toilet');
  }
  if (['pig', 'chicken', 'storage'].some(k => typeof patch[k] === 'boolean')) {
    if (typeof patch.pig === 'boolean') S.pig = patch.pig;
    if (typeof patch.chicken === 'boolean') S.chicken = patch.chicken;
    if (typeof patch.storage === 'boolean') S.storage = patch.storage;
    aiAnswered.add('pen'); accepted.push('pen(猪圈/鸡圈/杂物间)');
  }
  if (typeof patch.hall === 'boolean' || typeof patch.yard === 'boolean') {
    if (typeof patch.hall === 'boolean') S.hall = patch.hall;
    if (typeof patch.yard === 'boolean') S.yard = patch.yard;
    if (S.hall !== null && S.yard !== null) aiAnswered.add('courtyard');
    accepted.push('courtyard(堂屋/院坝)');
  }
  if (['save', 'elder', 'fancy', 'family'].includes(patch.priority)) put('priority', patch.priority);

  /* 任何改动都意味着之前的确认作废，需要重新复述 */
  if (accepted.length) confirmReceived = false;
  renderSlots();

  const missing = missingSlots();
  const allDone = missing.length === 0;
  if (allDone && !awaitingConfirm) awaitingConfirm = true;
  return {
    accepted,
    rejected: reject,
    missing,
    allDone,
    instruction: allDone
      ? '信息已经问齐。请用家常话把全部信息给大妈复述一遍，最后问她“要得不/行不行”；她明确同意后再调用 finish_intake。'
      : '已记录。请继续只问下一个还缺的信息：' + missing[0]
  };
}

function llmHooks() {
  return {
    snapshot: llmSnapshot,
    onAgentText(text) {
      if (!inCall) return; /* 已挂断/已出图则忽略迟到回复 */
      hideTyping();
      addBubble('agent', text);
      speak(text);
    },
    onTool(patch) { return aiMerge(patch); },
    gateFinish() {
      const missing = missingSlots();
      if (missing.length) return { ok: false, reason: '信息还没问齐', missing };
      if (!confirmReceived) return { ok: false, reason: '大妈还没明确同意，请先复述全部信息并问“要得不”', missing: [] };
      return { ok: true };
    },
    onFinish() { if (inCall) finishCall(true); }
  };
}

function aiHandle(text) {
  if (aiBusy) return;
  const dialectHits = detectDialect(text);
  addBubble('user', text, dialectHits);
  els.chipBar.innerHTML = '';

  if (awaitingConfirm) {
    if (isYes(text)) confirmReceived = true;
    else if (/不对|错了|改|等|莫忙|不是/.test(text)) confirmReceived = false;
  }
  aiBusy = true;
  showTyping();
  LLM.turn(text, llmHooks())
    .then(afterAiTurn)
    .catch(aiFail);
}

function afterAiTurn() {
  aiBusy = false;
  hideTyping();
  if (!inCall) return; /* 已出图 */
  /* 给下一个未答项配快捷短语 */
  const miss = missingSlots();
  els.chipBar.innerHTML = '';
  if (!miss.length) {
    if (!confirmReceived) {
      addAiChips(['要得，就这样，出图！', '等一下，我还要改两句']);
    }
    return;
  }
  const q = QUESTIONS.find(x => x.id === miss[0]);
  if (q) showChips(QUESTIONS.indexOf(q));
}

function addAiChips(labels) {
  labels.forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = label;
    btn.onclick = () => { if (inCall && !aiBusy) handleAnswer(label); };
    els.chipBar.appendChild(btn);
  });
}

function aiFail(err) {
  aiBusy = false;
  hideTyping();
  if (!inCall) return;
  addBubble('agent', '（系统提示）大模型这一下没连上：' + (err && err.message ? err.message : '未知错误') +
    '。您可以再点上面的话重说一遍；网络不方便就挂断后用“演示话术模式”拨打，图纸照样能出。');
  els.speechStatus.textContent = 'AI 调用失败：' + (err && err.type ? err.type : 'error') + '（可在大模型设置里测试连接）';
  afterAiTurn();
}

/* ================= 5. 需求卡 / 气候卡 ================= */

const SLOT_DEFS = [
  { k: 'region', label: '建房地点', fmt: v => v || '' },
  { k: 'terrain', label: '地势', fmt: v => TERRAIN_TXT[v] || '' },
  { k: 'floors', label: '层数', fmt: v => v ? v + ' 层' : '' },
  { k: 'plot', label: '宅基地', fmt: v => v ? v + ' ㎡（约' + (v / 66.67).toFixed(1) + '分地）' : '' },
  { k: 'budget', label: '预算', fmt: v => v ? v + ' 万元' : '' },
  { k: 'bedrooms', label: '卧室', fmt: v => v ? v + ' 间' : '' },
  { k: 'kitchen', label: '厨房', fmt: v => ({ big: '大间·带柴火灶', mid: '一般大', small: '小间·电气化' })[v] || '' },
  { k: 'toilet', label: '厕所', fmt: v => ({ indoor: '室内马桶+淋浴', outhouse: '院头旱厕', both: '室内+旱厕都要' })[v] || '' },
  { k: 'pen', label: '附属棚圈', fmt: () => [S.pig ? '猪圈' : '', S.chicken ? '鸡圈' : '', S.storage ? '杂物间' : ''].filter(Boolean).join('、') || '暂不安排' },
  { k: 'courtyard', label: '堂屋院坝', fmt: () => (S.hall === null ? '' : [S.hall ? '堂屋' : '', S.yard ? '院坝' : ''].filter(Boolean).join('+') || '都不要') },
  { k: 'priority', label: '最看重', fmt: v => PRIORITY_TXT[v] || '' }
];

function renderSlots() {
  els.slotRows.innerHTML = SLOT_DEFS.map(d => {
    const val = d.fmt(S[d.k], S);
    return '<div class="slot-row ' + (val ? 'filled' : '') + '">' +
      '<span class="slot-label">' + d.label + '</span>' +
      '<span class="slot-value">' + (val || '待询问…') + '</span></div>';
  }).join('');
}

function renderClimate() {
  const r = REGIONS[S.region];
  if (!r) return;
  const rr = rainRule(r.rain);
  const rainPct = Math.min(100, Math.round(r.rain / 20));
  els.climateCard.classList.remove('hidden');
  els.climateCard.innerHTML =
    '<div class="climate-title">“' + S.region + '”自动调取 · 气候地质参考</div>' +
    '<div class="climate-row"><span>年均降雨</span><b>' + r.rain + ' mm</b><small>' + rr.tier + ' · 雨季' + r.months + '</small></div>' +
    '<div class="meter"><i style="width:' + rainPct + '%"></i></div>' +
    '<div class="climate-row"><span>抗震设防</span><b>' + r.seis + ' 度区</b><small>构造措施自动加强</small></div>' +
    '<div class="climate-row"><span>标准冻深</span><b>' + (r.frost ? r.frost + ' m' : '基本无冻土') + '</b><small>决定基础埋深</small></div>' +
    '<div class="climate-row"><span>典型土质</span><b></b><small>' + r.soil + '</small></div>' +
    '<div class="climate-row"><span>当地方言</span><b></b><small>' + r.dialect + '（词库已覆盖部分常用词）</small></div>';
}

/* ================= 6. 方案模型推导 ================= */

function buildModel() {
  const rd = REGIONS[S.region];
  const rr = rainRule(rd.rain);
  const sr = seisRule(rd.seis);
  const fr = frostRule(rd.frost);
  const tr = terrainRule(S.terrain);

  /* 主房基底：宅基地的 55% 左右，60~145㎡ 取整到 5；极小地块不超过地块的 95% */
  let base = 0;
  if (S.plot) base = Math.max(60, Math.min(145, Math.round(S.plot * 0.55 / 5) * 5));
  const dims = base <= 66 ? [8, 8] : base <= 90 ? [10, 9] : base <= 110 ? [11, 10] : base <= 130 ? [12, 10.5] : [13, 11];
  base = Math.round(dims[0] * dims[1]);
  const totalArea = Math.round(base * S.floors * 10) / 10;

  /* 附属房面积 */
  const annexArea = (S.pig ? 9 : 0) + (S.chicken ? 5 : 0) + (S.storage ? 8 : 0) + (S.toilet !== 'indoor' ? 4 : 0);

  /* 造价 */
  const unit = 1650 + (rd.seis === 8 ? 150 : 0) + (rd.seis >= 9 ? 520 : 0) + tr.extraCost;
  const finishUnit = S.priority === 'fancy' ? 800 : S.priority === 'save' ? 500 : 650;
  const structure = Math.round(totalArea * unit);
  const finish = Math.round(totalArea * finishUnit);
  const annexCost = annexArea * 900;
  const wallYard = S.yard ? 22000 : 10000;
  const drain = rd.rain > 1200 ? 20000 : rd.rain > 800 ? 14000 : 8000;
  const subtotal = structure + finish + annexCost + wallYard + drain;
  const reserve = Math.round(subtotal * 0.05 / 1000) * 1000;
  const totalCost = subtotal + reserve;

  return {
    region: S.region, rd, terrain: S.terrain, floors: S.floors, plot: S.plot,
    budget: S.budget, bedrooms: S.bedrooms, kitchen: S.kitchen, toilet: S.toilet,
    pig: S.pig, chicken: S.chicken, storage: S.storage, outhouse: S.outhouse,
    hall: S.hall, yard: S.yard, priority: S.priority,
    HW: dims[0], HD: dims[1], base, totalArea, annexArea,
    rr, sr, fr, tr,
    costs: {
      ['主体工程（含' + sr.struct + '/基础/楼板/屋顶）']: structure,
      '室内简装（地砖/涂料/门窗/洁具）': finish,
      '附属用房（圈舍/杂物/旱厕）': annexCost,
      '院墙·大门·院坝硬化': wallYard,
      '排水散水·化粪池（按降雨加强）': drain,
      '预备费 5%': reserve
    },
    totalCost
  };
}

/* ================= 7. SVG 平面图 ================= */

const ROOM_FILL = {
  bed: '#f7e8d4', hall: '#fdf3d9', kitchen: '#fbe0cd', bath: '#dcebf3',
  stair: '#e9e3d6', dine: '#f4ecdc', store: '#ece7db', balcony: '#e7f0e8',
  terrace: '#eef5ea', misc: '#f2efe6'
};

/* 行→单元格网格；u 为宽度权重，行高 f 为占房屋进深比例 */
function floorGrid(floor, m) {
  if (floor === 1) {
    const ku = m.kitchen === 'big' ? [2.6, 2.2, 1.3, 1.5, 1.2, 1.2]
      : m.kitchen === 'small' ? [1.7, 2.4, 1.3, 1.6, 1.5, 1.5]
        : [2.1, 2.3, 1.3, 1.6, 1.3, 1.4];
    const kLabel = m.kitchen === 'big' ? '厨房·柴火灶' : m.kitchen === 'small' ? '小厨房' : '厨房';
    const bathLabel = m.toilet === 'outhouse' ? '盥洗室' : '卫生间';
    const rightBack = m.bedrooms >= 2 ? ['次卧', 'bed'] : (m.storage ? ['杂物间', 'store'] : ['书房', 'misc']);
    return [
      { f: 0.54, cells: [
        { t: '老人房', s: '朝南', u: 3, c: 'bed' },
        { t: m.hall ? '堂屋' : '客厅', s: '待客摆席', u: 4, c: 'hall' },
        { t: rightBack[0], u: 3, c: rightBack[1] }
      ]},
      { f: 0.46, cells: [
        { t: kLabel, u: ku[0], c: 'kitchen' },
        { t: '餐厅', u: ku[1], c: 'dine' },
        { t: m.floors === 1 ? '楼梯位(预留)' : '楼梯', u: ku[2], c: 'stair' },
        { t: bathLabel, u: ku[3], c: 'bath' },
        { t: '玄关', u: ku[4], c: 'misc' },
        { t: '储物', u: ku[5], c: 'store' }
      ]}
    ];
  }
  if (floor === 2) {
    /* 一层已放 老人房+次卧 共2间，楼上标间数 = 卧室数-2，至少排2个开间，多余标为客房 */
    const labeled = Math.max(0, m.bedrooms - 2);
    const n = Math.min(Math.max(labeled, 2), 4);
    const back = [];
    for (let i = 0; i < n; i++) {
      back.push({ t: i < labeled ? '卧室' + (i + 3) : '客房' + (i - labeled + 1), u: 10 / n, c: 'bed' });
    }
    return [
      { f: 0.58, cells: back },
      { f: 0.42, cells: [
        { t: '起居小厅', u: 3.4, c: 'hall' },
        { t: '楼梯', u: 1.3, c: 'stair' },
        { t: '卫生间', u: 1.6, c: 'bath' },
        { t: '储物', u: 1.8, c: 'store' },
        { t: '阳台', u: 1.9, c: 'balcony' }
      ]}
    ];
  }
  /* 三层：卧室超过6间时楼上再加客房，其余储藏 + 大晒台 */
  const extra = Math.max(0, m.bedrooms - 6);
  const back = [];
  for (let i = 0; i < extra; i++) back.push({ t: '客房' + (i + 3), u: 3, c: 'bed' });
  back.push({ t: '储藏间', u: 10 - extra * 3, c: 'store' });
  return [
    { f: 0.5, cells: back },
    { f: 0.5, cells: [
      { t: '楼梯', u: 1.3, c: 'stair' },
      { t: '大晒台（晒粮·晾衣）', u: 8.7, c: 'terrace' }
    ]}
  ];
}

function renderPlan(m, floor) {
  const withYard = floor === 1;
  const HX = 150, HW = 420, HD = withYard ? 210 : 260;
  const HY = withYard ? 120 : 140;
  const vbH = withYard ? 600 : 470;
  let s = '<svg viewBox="0 0 720 ' + vbH + '" class="plan-svg" role="img" aria-label="' + floor + '层平面图">';
  s += '<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
       '<line x1="0" y1="0" x2="0" y2="8" stroke="#b9a98c" stroke-width="1.5"/></pattern></defs>';

  /* 指北针 */
  s += '<g transform="translate(56,64)"><circle r="24" fill="#fffdf8" stroke="#8a7a5e"/>' +
       '<polygon points="0,-15 6,8 0,3 -6,8" fill="#b4482e"/><text y="-30" text-anchor="middle" font-size="15" fill="#5a4d38" font-weight="700">北</text></g>';

  /* 尺寸标注：面宽 */
  s += '<line x1="' + HX + '" y1="' + (HY - 26) + '" x2="' + (HX + HW) + '" y2="' + (HY - 26) + '" stroke="#8a7a5e" stroke-width="1.2"/>' +
       '<line x1="' + HX + '" y1="' + (HY - 31) + '" x2="' + HX + '" y2="' + (HY - 21) + '" stroke="#8a7a5e"/>' +
       '<line x1="' + (HX + HW) + '" y1="' + (HY - 31) + '" x2="' + (HX + HW) + '" y2="' + (HY - 21) + '" stroke="#8a7a5e"/>' +
       '<text x="' + (HX + HW / 2) + '" y="' + (HY - 32) + '" text-anchor="middle" font-size="15" fill="#5a4d38">面宽 ' + m.HW + ' m</text>';
  /* 进深 */
  s += '<line x1="' + (HX - 24) + '" y1="' + HY + '" x2="' + (HX - 24) + '" y2="' + (HY + HD) + '" stroke="#8a7a5e" stroke-width="1.2"/>' +
       '<line x1="' + (HX - 29) + '" y1="' + HY + '" x2="' + (HX - 19) + '" y2="' + HY + '" stroke="#8a7a5e"/>' +
       '<line x1="' + (HX - 29) + '" y1="' + (HY + HD) + '" x2="' + (HX - 19) + '" y2="' + (HY + HD) + '" stroke="#8a7a5e"/>' +
       '<text x="' + (HX - 34) + '" y="' + (HY + HD / 2) + '" text-anchor="middle" font-size="15" fill="#5a4d38" transform="rotate(-90 ' + (HX - 34) + ' ' + (HY + HD / 2) + ')">进深 ' + m.HD + ' m</text>';

  /* 一层：后院附属棚圈（下风向，距主房≥6m） */
  if (floor === 1) {
    const annex = [];
    if (m.pig) annex.push({ t: '猪圈 9㎡', w: 110 });
    if (m.chicken) annex.push({ t: '鸡圈 5㎡', w: 84 });
    if (m.storage) annex.push({ t: '杂物间 8㎡', w: 100 });
    if (m.outhouse && m.toilet !== 'indoor') annex.push({ t: '旱厕 4㎡', w: 70 });
    const ay = HY - 78, ah = 44;
    s += '<text x="' + HX + '" y="' + (ay - 8) + '" font-size="14" fill="#7a5a35">后院 · 附属棚圈（位于下风向/侧院，与主房保持卫生距离）</text>';
    let ax = HX;
    annex.forEach(a => {
      s += '<rect x="' + ax + '" y="' + ay + '" width="' + a.w + '" height="' + ah + '" fill="#e7dcc8" stroke="#8f7a55" stroke-width="1.6" stroke-dasharray="5 3"/>' +
           '<text x="' + (ax + a.w / 2) + '" y="' + (ay + ah / 2 + 5) + '" text-anchor="middle" font-size="13.5" fill="#5f4a2c">' + a.t + '</text>';
      ax += a.w + 10;
    });
    s += '<line x1="' + (HX + HW - 90) + '" y1="' + (ay + ah) + '" x2="' + (HX + HW - 90) + '" y2="' + HY + '" stroke="#b4482e" stroke-width="1.3" stroke-dasharray="4 3"/>' +
         '<text x="' + (HX + HW - 80) + '" y="' + ((ay + ah + HY) / 2) + '" font-size="12.5" fill="#b4482e">间距≥6m</text>';
  }

  /* 房间网格 */
  const grid = floorGrid(floor, m);
  let y = HY;
  grid.forEach(row => {
    const rh = HD * row.f;
    const totalU = row.cells.reduce((a, c) => a + c.u, 0);
    let x = HX;
    row.cells.forEach(cell => {
      const cw = HW * cell.u / totalU;
      const areaM = (m.HW * cell.u / totalU * m.HD * row.f).toFixed(1);
      s += '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + rh + '" fill="' + ROOM_FILL[cell.c] + '" stroke="#9c8c6e" stroke-width="1.6"/>';
      if (cell.c === 'stair') s += '<rect x="' + (x + 6) + '" y="' + (y + 6) + '" width="' + (cw - 12) + '" height="' + (rh - 12) + '" fill="url(#hatch)" opacity="0.7"/>';
      s += '<text x="' + (x + cw / 2) + '" y="' + (y + rh / 2 - 2) + '" text-anchor="middle" font-size="' + (cell.t.length > 5 ? 13.5 : 16) + '" font-weight="700" fill="#3a3125">' + cell.t + '</text>' +
           '<text x="' + (x + cw / 2) + '" y="' + (y + rh / 2 + 17) + '" text-anchor="middle" font-size="12" fill="#8a7a5e">' + areaM + '㎡' + (cell.s ? ' · ' + cell.s : '') + '</text>';
      x += cw;
    });
    y += rh;
  });

  /* 外墙（加粗）+ 大门（南墙居中） */
  s += '<rect x="' + HX + '" y="' + HY + '" width="' + HW + '" height="' + HD + '" fill="none" stroke="#33291d" stroke-width="6"/>';
  const doorW = 30, dx = HX + HW / 2 - doorW / 2;
  s += '<rect x="' + dx + '" y="' + (HY + HD - 4) + '" width="' + doorW + '" height="8" fill="#faf5ec"/>' +
       '<path d="M' + dx + ' ' + (HY + HD) + ' A ' + doorW + ' ' + doorW + ' 0 0 1 ' + (dx + doorW) + ' ' + (HY + HD) + '" fill="none" stroke="#b4482e" stroke-width="1.4"/>' +
       '<text x="' + (HX + HW / 2) + '" y="' + (HY + HD - 10) + '" text-anchor="middle" font-size="13" fill="#b4482e" font-weight="700">入户大门</text>';
  /* 窗洞示意 */
  [[HX, HY + HD / 2, -1], [HX + HW, HY + HD / 2, 1], [HX + 70, HY, 0], [HX + HW - 70, HY, 0]].forEach(w => {
    if (w[2] === -1) s += '<rect x="' + (w[0] - 3) + '" y="' + (w[1] - 22) + '" width="7" height="44" fill="#bcd6e6"/>';
    if (w[2] === 1) s += '<rect x="' + (w[0] - 4) + '" y="' + (w[1] - 22) + '" width="7" height="44" fill="#bcd6e6"/>';
    if (w[2] === 0) s += '<rect x="' + (w[0] - 24) + '" y="' + (w[1] - 3) + '" width="48" height="7" fill="#bcd6e6"/>';
  });

  /* 一层：前院 */
  if (withYard) {
    const yy0 = HY + HD + 26, yy1 = vbH - 52;
    s += '<rect x="' + HX + '" y="' + yy0 + '" width="' + HW + '" height="' + (yy1 - yy0) + '" fill="#f3ecda" stroke="#b7a47e" stroke-width="1.6" stroke-dasharray="8 5"/>' +
         '<text x="' + (HX + HW / 2) + '" y="' + (yy0 + 40) + '" text-anchor="middle" font-size="17" font-weight="700" fill="#7a5a35">' + (m.yard ? '前院 / 院坝（晒谷·停车·摆酒席）' : '房前通道') + '</text>';
    /* 院门 */
    const gx = HX + HW / 2;
    s += '<rect x="' + (gx - 26) + '" y="' + (yy1 - 9) + '" width="10" height="14" fill="#8f5a3c"/>' +
         '<rect x="' + (gx + 16) + '" y="' + (yy1 - 9) + '" width="10" height="14" fill="#8f5a3c"/>' +
         '<line x1="' + (gx - 21) + '" y1="' + (yy1 - 8) + '" x2="' + (gx + 21) + '" y2="' + (yy1 - 8) + '" stroke="#8f5a3c" stroke-width="2"/>' +
         '<text x="' + gx + '" y="' + (yy1 + 24) + '" text-anchor="middle" font-size="13" fill="#5f4a2c">院门（朝外开）</text>';
  }

  s += '<text x="360" y="' + (vbH - 6) + '" text-anchor="middle" font-size="14" fill="#8a7a5e">' +
       ['一层平面图（主房 ' + m.base + '㎡）', '二层平面图', '三层平面图（坡屋顶下可用作储藏/客房）'][floor - 1] + '　比例示意 · 非正式施工图</text>';
  s += '</svg>';
  return s;
}

/* ================= 8. SVG 立面示意（降雨/抗震/冻土直接作用） ================= */

function renderElevation(m) {
  /* 三层高 + 陡坡屋顶时，地坪整体下移，保证屋脊不超出画布 */
  const groundY = 300 + (m.floors - 1) * 40, x0 = 190, x1 = 530, floorH = 78;
  const topY = groundY - floorH * m.floors;
  const ang = m.rr.slope;
  const rise = Math.tan(ang * Math.PI / 180) * (x1 - x0) / 2;
  const eavePx = 14 + m.rr.eave * 0.35;
  const fd = Math.max(m.fr.depth, m.terrain === '山区' ? 1.0 : 0.6);
  const fdPx = fd * 34;

  let s = '<svg viewBox="0 0 720 470" class="plan-svg" role="img" aria-label="立面示意图">';
  /* 地坪 */
  s += '<line x1="60" y1="' + groundY + '" x2="660" y2="' + groundY + '" stroke="#6b5d44" stroke-width="3"/>' +
       '<text x="66" y="' + (groundY - 8) + '" font-size="13" fill="#6b5d44">室外地坪（抬高' + (m.rd.rain > 1200 ? 30 : 15) + 'cm防潮）</text>';

  /* 基础 */
  s += '<rect x="' + (x0 + 14) + '" y="' + groundY + '" width="' + (x1 - x0 - 28) + '" height="' + fdPx + '" fill="#d8cdb6" stroke="#8a7a5e" stroke-width="1.5"/>' +
       '<text x="' + (x1 + 26) + '" y="' + (groundY + fdPx / 2 + 5) + '" font-size="13.5" fill="#5a4d38">基础埋深 ' + fd.toFixed(2) + 'm</text>';
  for (let i = 0; i < 6; i++)
    s += '<line x1="' + (x0 + 30 + i * 48) + '" y1="' + groundY + '" x2="' + (x0 + 40 + i * 48) + '" y2="' + (groundY + fdPx) + '" stroke="#b8a887" stroke-width="1"/>';

  /* 楼层墙体 */
  s += '<rect x="' + x0 + '" y="' + topY + '" width="' + (x1 - x0) + '" height="' + (groundY - topY) + '" fill="#f6ecdc" stroke="#33291d" stroke-width="4"/>';
  for (let f = 1; f < m.floors; f++) {
    const ly = groundY - floorH * f;
    s += '<line x1="' + x0 + '" y1="' + ly + '" x2="' + x1 + '" y2="' + ly + '" stroke="#33291d" stroke-width="3"/>';
  }
  /* 圈梁（每层顶部红线） */
  for (let f = 1; f <= m.floors; f++) {
    const ly = groundY - floorH * f + 6;
    s += '<line x1="' + x0 + '" y1="' + ly + '" x2="' + x1 + '" y2="' + ly + '" stroke="#b4482e" stroke-width="2" stroke-dasharray="7 4"/>';
  }
  /* 构造柱 */
  if (m.sr.col) {
    [x0, x1 - 12].forEach(cx => {
      for (let f = 0; f < m.floors; f++) {
        s += '<rect x="' + cx + '" y="' + (groundY - floorH * (f + 1) + 10) + '" width="12" height="' + (floorH - 14) + '" fill="#b4482e"/>';
      }
    });
    s += '<text x="' + (x0 - 10) + '" y="' + (topY - 26) + '" font-size="13" fill="#b4482e" font-weight="700">构造柱+圈梁（' + m.rd.seis + '度抗震）</text>';
  }

  /* 门窗（正立面） */
  s += '<rect x="' + ((x0 + x1) / 2 - 15) + '" y="' + (groundY - 46) + '" width="30" height="46" fill="#8f5a3c"/><line x1="' + ((x0 + x1) / 2) + '" y1="' + (groundY - 46) + '" x2="' + ((x0 + x1) / 2) + '" y2="' + groundY + '" stroke="#6b432c"/>';
  for (let f = 0; f < m.floors; f++) {
    const wy = groundY - floorH * f - 52;
    [x0 + 46, x1 - 82].forEach(wx => {
      s += '<rect x="' + wx + '" y="' + wy + '" width="36" height="32" fill="#cfe1ec" stroke="#5f7f96" stroke-width="1.6"/>';
    });
  }

  /* 屋顶 */
  if (ang <= 6) {
    s += '<rect x="' + (x0 - 10) + '" y="' + (topY - 12) + '" width="' + (x1 - x0 + 20) + '" height="12" fill="#9c8c6e" stroke="#33291d" stroke-width="2"/>' +
         '<text x="' + (x1 + 26) + '" y="' + (topY - 2) + '" font-size="13.5" fill="#5a4d38">平顶' + ang + '°，可晒粮</text>';
  } else {
    const lx = x0 - eavePx, rx = x1 + eavePx, ry = topY - 4, cx = (x0 + x1) / 2, cy = topY - 4 - rise;
    s += '<polygon points="' + lx + ',' + ry + ' ' + cx + ',' + cy + ' ' + rx + ',' + ry + '" fill="#a0522d" stroke="#33291d" stroke-width="2.5"/>' +
         '<line x1="' + lx + '" y1="' + ry + '" x2="' + rx + '" y2="' + ry + '" stroke="#33291d" stroke-width="3"/>';
    s += '<text x="' + (cx) + '" y="' + (cy - 10) + '" text-anchor="middle" font-size="14" fill="#b4482e" font-weight="700">坡屋顶 ' + ang + '°</text>' +
         '<text x="' + (x1 + 26) + '" y="' + (ry - rise / 2) + '" font-size="13" fill="#5a4d38">挑檐 ' + m.rr.eave + 'cm</text>';
  }
  /* 散水/排水沟 */
  s += '<rect x="' + (x0 - 26) + '" y="' + (groundY + 2) + '" width="34" height="7" fill="#9aa7ad"/>' +
       '<rect x="' + (x1 - 8) + '" y="' + (groundY + 2) + '" width="34" height="7" fill="#9aa7ad"/>' +
       '<text x="' + (x0 - 30) + '" y="' + (groundY + 26) + '" font-size="12.5" fill="#5f6d73">散水' + (m.rd.rain > 800 ? '80cm+排水沟' : '') + '</text>';

  s += '<text x="360" y="408" text-anchor="middle" font-size="14" fill="#8a7a5e">正立面示意 · 降雨 ' + m.rd.rain + 'mm / 抗震 ' + m.rd.seis + '度 / ' + m.rr.struct + '</text>';
  s += '</svg>';
  return s;
}

/* ================= 9. 预算 + 说明 + 概要 ================= */

function renderBudget(m) {
  const items = Object.entries(m.costs);
  const max = Math.max.apply(null, items.map(i => i[1]).concat([m.budget * 10000]));
  let html = '<div class="budget-total"><div><b>' + (m.totalCost / 10000).toFixed(1) + '</b> 万元<span>估算总造价</span></div>' +
    '<div class="budget-pair">预算 ' + m.budget + ' 万　总建面 ' + m.totalArea + ' ㎡　约 ' +
    Math.round(m.totalCost / m.totalArea) + ' 元/㎡</div></div>';
  html += '<div class="budget-bars">';
  items.forEach(([name, val]) => {
    html += '<div class="bar-row"><span class="bar-label">' + name + '</span>' +
      '<div class="bar-track"><i style="width:' + Math.max(4, Math.round(val / max * 100)) + '%"></i></div>' +
      '<span class="bar-num">' + (val / 10000).toFixed(1) + '万</span></div>';
  });
  html += '</div>';
  const diff = m.budget * 10000 - m.totalCost;
  if (diff >= 0) {
    html += '<div class="budget-ok">在预算内，还剩约 ' + (diff / 10000).toFixed(1) + ' 万元机动钱，建议留作家具家电。</div>';
  } else {
    html += '<div class="budget-warn">超出预算约 ' + (-diff / 10000).toFixed(1) + ' 万元。建议：' +
      (m.floors >= 3 ? '三层先缓建、预留钢筋接口；' : '') + '装修分两期；附属棚圈可先搭简易棚。</div>';
  }
  return html;
}

function renderNotes(m) {
  const n = [];
  n.push(['降雨 ' + m.rd.rain + 'mm（' + m.rr.tier + '）',
    '屋顶用' + m.rr.roof + '、坡度 ' + m.rr.slope + '°，挑檐出 ' + m.rr.eave + 'cm；' + m.rr.drain + '。']);
  n.push(['抗震 ' + m.rd.seis + ' 度',
    '采用' + m.sr.struct + '，' + m.sr.measure + '；四大角及楼梯间重点加强，不可随意拆墙打洞。']);
  n.push(['地基与土质',
    m.fr.text + '。' + m.rd.soil + '，基槽必须挖到老土层，雨季施工要防基坑泡水。']);
  n.push([TERRAIN_TXT[m.terrain] + '场地', m.tr.text + '。']);
  if (m.pig || m.chicken) {
    n.push(['圈舍卫生', '猪圈鸡圈放后院下风向，与主房保持 6m 以上距离；硬化地面、设化粪池/三级沉淀池，定期清掏还田。']);
  }
  if (m.toilet !== 'outhouse') {
    n.push(['室内给排水', '室内卫生间做三级化粪池，生活污水与雨水分开排；老人常用卫生间地面防滑、装扶手、用淋浴凳。']);
  }
  if (m.priority === 'elder') {
    n.push(['适老化设计', '老人房放一层朝南，带卫生间或就近如厕；全屋无门槛、坡道代替台阶、楼梯双侧扶手、夜灯感应。']);
  }
  if (m.priority === 'family') {
    n.push(['春节团聚模式', '卧室总数 ' + m.bedrooms + ' 间，二层做大起居厅，三层留客房/晒台；院坝可摆 4~6 桌酒席。']);
  }
  if (m.kitchen === 'big') {
    n.push(['柴火灶', '大厨房双灶布置（柴灶+煤气灶），柴灶旁设烟囱高出屋面 50cm，柴房与灶间用砖墙分隔防火。']);
  }
  return '<ul class="notes-list">' + n.map(x =>
    '<li><b>' + x[0] + '</b><p>' + x[1] + '</p></li>').join('') +
    '<li class="note-disclaimer"><b>重要提示</b><p>本图为电话沟通后的<b>初步意向方案</b>，用于造价摸底和家庭商量；正式开工前必须请持证设计师出施工图，并做地质勘探、办理建房审批。</p></li></ul>';
}

function renderSummary(m) {
  const chips = [
    m.region + '·' + TERRAIN_TXT[m.terrain],
    m.floors + '层',
    '主房 ' + m.HW + '×' + m.HD + 'm/' + m.base + '㎡',
    '总建面约' + m.totalArea + '㎡',
    m.bedrooms + '卧',
    m.rr.roof + m.rr.slope + '°',
    '抗震' + m.rd.seis + '度',
    m.sr.struct,
    '预算' + m.budget + '万'
  ];
  els.summaryStrip.innerHTML = chips.map(c => '<span class="sum-chip">' + c + '</span>').join('');
}

/* ================= 10. 设计输出装配 + Tab ================= */

function renderDesign(m) {
  renderSummary(m);
  /* 楼层 tab */
  els.planTabs.innerHTML = '';
  for (let f = 1; f <= m.floors; f++) {
    const b = document.createElement('button');
    b.className = 'tab-btn' + (f === 1 ? ' active' : '');
    b.textContent = f + ' 层平面图';
    b.onclick = () => {
      els.planTabs.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      els.planPanel.innerHTML = renderPlan(m, f);
    };
    els.planTabs.appendChild(b);
  }
  els.planPanel.innerHTML = renderPlan(m, 1);
  $('panelElevation').innerHTML = renderElevation(m);
  $('panelBudget').innerHTML = renderBudget(m);
  $('panelNotes').innerHTML = renderNotes(m);

  [['tabPlan', 'panelPlan'], ['tabElevation', 'panelElevation'],
   ['tabBudget', 'panelBudget'], ['tabNotes', 'panelNotes']].forEach(([tb, pn]) => {
    $(tb).onclick = () => {
      document.querySelectorAll('.design-tab-btn').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.design-panel').forEach(x => x.classList.add('hidden'));
      $(tb).classList.add('active');
      $(pn).classList.remove('hidden');
    };
  });
  document.querySelectorAll('.design-tab-btn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.design-panel').forEach(x => x.classList.add('hidden'));
  $('tabPlan').classList.add('active');
  $('panelPlan').classList.remove('hidden');
}

/* ================= 11. 语音：TTS / ASR ================= */

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, ''));
    u.lang = 'zh-CN';
    u.rate = 0.92;
    u.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find(v => /zh|Chinese|中文|普通话/i.test(v.lang + v.name));
    if (zh) u.voice = zh;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}
function stopSpeak() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    els.micBtn.classList.add('disabled');
    els.micBtn.title = '当前浏览器不支持语音识别，可用打字或点选回答';
    els.speechStatus.textContent = '本机浏览器不支持语音识别，演示可点选/打字；正式版走电话线路+方言ASR';
    return;
  }
  recognition = new SR();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = e => {
    const said = e.results[0][0].transcript;
    handleAnswer(said);
  };
  recognition.onend = () => {
    recognizing = false;
    els.micBtn.classList.remove('recording');
  };
  recognition.onerror = () => {
    recognizing = false;
    els.micBtn.classList.remove('recording');
  };
  els.micBtn.onclick = () => {
    if (!inCall) return;
    if (recognizing) { recognition.stop(); return; }
    try { recognition.start(); recognizing = true; els.micBtn.classList.add('recording'); } catch (e) {}
  };
}

/* ================= 12. 初始化 ================= */

/* ================= 13. 大模型设置弹窗 + 模式切换 ================= */

function openSettings(note) {
  const cfg = LLM.loadCfg();
  els.llmPreset.innerHTML = LLM.PRESETS.map((p, i) => '<option value="' + i + '">' + p.name + '</option>').join('');
  /* 匹配当前配置对应的预设（代理/直连分别匹配 base） */
  let idx = LLM.PRESETS.findIndex(p => !!p.viaProxy === !!cfg.viaProxy && p.base === cfg.baseUrl);
  if (idx === -1) idx = cfg.viaProxy ? 0 : 2;
  els.llmPreset.value = String(idx);
  fillModelDatalist(idx);
  els.llmBase.value = cfg.baseUrl;
  els.llmModel.value = cfg.model;
  els.llmKey.value = cfg.apiKey;
  applyPresetUi(idx, false);
  els.llmTestResult.textContent = note || '';
  els.llmTestResult.className = 'test-result' + (note ? ' warn' : '');
  els.settingsModal.classList.remove('hidden');
}
function closeSettings() { els.settingsModal.classList.add('hidden'); }
function fillModelDatalist(idx) {
  els.modelList.innerHTML = LLM.PRESETS[idx].models.map(m => '<option value="' + m + '">').join('');
}
function applyPresetUi(idx, resetKey) {
  const p = LLM.PRESETS[idx];
  if (p.viaProxy) {
    els.llmKeyLabel.textContent = '代理访问口令 APP_TOKEN（服务端没设口令就留空）';
    els.llmKey.placeholder = '可选：与 Worker/Python 代理里的 APP_TOKEN 一致';
  } else {
    els.llmKeyLabel.textContent = 'API Key（只存在本机浏览器 localStorage，不写入代码、不上传）';
    els.llmKey.placeholder = 'sk-...';
  }
  els.llmPresetHint.textContent = p.hint || '';
  if (resetKey) els.llmKey.value = '';
}
function currentPreset() { return LLM.PRESETS[+els.llmPreset.value] || LLM.PRESETS[0]; }
function formCfg() {
  return {
    baseUrl: els.llmBase.value.trim() || LLM.DEFAULT_BASE,
    model: els.llmModel.value.trim() || LLM.DEFAULT_MODEL,
    apiKey: els.llmKey.value.trim(),
    viaProxy: !!currentPreset().viaProxy
  };
}
function updateLlmDot() {
  const on = LLM.configured();
  els.llmDot.className = 'llm-dot ' + (on ? 'on' : 'off');
  els.llmDot.title = on ? ('已配置：' + LLM.loadCfg().model) : (LLM.loadCfg().viaProxy ? '代理地址未配置好' : '未配置 Key');
}
function setMode(mode) {
  aiMode = mode === 'ai';
  els.modeAi.classList.toggle('active', aiMode);
  els.modeScript.classList.toggle('active', !aiMode);
  if (aiMode) {
    els.modeHint.textContent = LLM.configured()
      ? 'AI 模式：小居由真实大模型驱动，能自由听懂方言、临场追问'
      : ('AI 模式未就绪：请先点右上角“大模型设置”' + (LLM.loadCfg().viaProxy ? '填好代理地址' : '填 Key 或改选代理预设'));
    els.modeHint.className = 'mode-hint ' + (LLM.configured() ? 'ok' : 'warn');
  } else {
    els.modeHint.textContent = '演示话术模式：固定剧本，无需联网和 Key，路演最稳';
    els.modeHint.className = 'mode-hint';
  }
}

function initSettings() {
  updateLlmDot();
  setMode('script');

  els.settingsBtn.onclick = () => openSettings();
  els.settingsClose.onclick = closeSettings;
  els.settingsModal.addEventListener('click', e => { if (e.target === els.settingsModal) closeSettings(); });
  els.llmPreset.onchange = () => {
    const idx = +els.llmPreset.value;
    const p = LLM.PRESETS[idx];
    els.llmBase.value = p.base;
    els.llmModel.value = p.models[0];
    fillModelDatalist(idx);
    applyPresetUi(idx, true);
    els.llmTestResult.textContent = '';
  };
  els.llmSave.onclick = () => {
    LLM.saveCfg(formCfg());
    updateLlmDot();
    setMode(aiMode ? 'ai' : 'script');
    els.llmTestResult.textContent = '已保存到本机浏览器。';
    els.llmTestResult.className = 'test-result ok';
    setTimeout(closeSettings, 700);
  };
  els.llmTest.onclick = async () => {
    /* 测试前先暂存当前表单值 */
    LLM.saveCfg(formCfg());
    els.llmTestResult.textContent = '正在连接…';
    els.llmTestResult.className = 'test-result';
    try {
      const reply = await LLM.testConnection();
      els.llmTestResult.textContent = '连接成功，模型回复：' + reply;
      els.llmTestResult.className = 'test-result ok';
      updateLlmDot();
    } catch (e) {
      els.llmTestResult.textContent = '连接失败：' + e.message;
      els.llmTestResult.className = 'test-result warn';
    }
  };
  els.modeAi.onclick = () => {
    if (!LLM.configured()) {
      setMode('ai');
      const cfg = LLM.loadCfg();
      openSettings(cfg.viaProxy ? '先把代理地址换成你部署好的 Worker / 本地代理地址，再“测试连接”。'
                                : '用 AI 模式前先填 API Key，或改用上面的 Worker 代理预设；填好保存后直接拨打。');
      return;
    }
    setMode('ai');
  };
  els.modeScript.onclick = () => setMode('script');
}

window.addEventListener('DOMContentLoaded', () => {
  bindEls();
  initSettings();
  els.startCallBtn.onclick = startCall;
  els.hangupBtn.onclick = hangup;
  els.redialBtn.onclick = () => { hangup(); setTimeout(startCall, 150); };
  els.printBtn.onclick = () => window.print();
  els.sendBtn.onclick = () => {
    const v = els.textInput.value;
    els.textInput.value = '';
    handleAnswer(v);
  };
  els.textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') els.sendBtn.click();
  });
  initRecognition();
  renderSlots();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
  }
});
