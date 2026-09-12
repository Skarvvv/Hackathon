/* ============================================================
 * 乡居设计通 · 数据层
 * 1) REGIONS    各省（区/市）气候地质参考值 + 方言区提示
 * 2) DIALECT    方言口语词 → 普通话标准意图（最长匹配，命中展示）
 * 3) RULES      降雨/抗震/冻土 → 房屋构造措施的映射规则
 * 说明：表中数值为面向"初步沟通方案"的经验参考值，
 *      正式施工图必须以当地地勘报告与现行规范为准。
 * ============================================================ */

/* ---------- 省级参考数据 ---------- */
const REGIONS = {
  '北京':   { rain: 580,  months: '7-8月', seis: 8, frost: 0.8, soil: '华北平原，粉质黏土',     dialect: '北方官话' },
  '天津':   { rain: 560,  months: '7-8月', seis: 7, frost: 0.6, soil: '滨海软土、回填土多',     dialect: '北方官话' },
  '河北':   { rain: 550,  months: '7-8月', seis: 7, frost: 0.8, soil: '平原黄土/山前碎石土',    dialect: '北方官话' },
  '山西':   { rain: 500,  months: '7-8月', seis: 8, frost: 1.0, soil: '黄土台地，湿陷性黄土',   dialect: '晋语' },
  '内蒙古': { rain: 280,  months: '7-8月', seis: 7, frost: 2.0, soil: '草原砂砾土/冻土',        dialect: '晋语/东北官话' },
  '辽宁':   { rain: 680,  months: '7-8月', seis: 8, frost: 1.2, soil: '平原黏土、山坡碎石',     dialect: '东北官话' },
  '吉林':   { rain: 620,  months: '7-8月', seis: 7, frost: 1.6, soil: '黑土、季节性冻土',       dialect: '东北官话' },
  '黑龙江': { rain: 540,  months: '7-8月', seis: 7, frost: 2.0, soil: '黑土、深冻土',           dialect: '东北官话' },
  '上海':   { rain: 1180, months: '6-9月', seis: 7, frost: 0,   soil: '长江三角洲软土、水位高', dialect: '吴语' },
  '江苏':   { rain: 1000, months: '6-9月', seis: 7, frost: 0,   soil: '平原软土、河网密布',     dialect: '江淮官话/吴语' },
  '浙江':   { rain: 1500, months: '5-9月', seis: 6, frost: 0,   soil: '丘陵红黏土/山岩',        dialect: '吴语' },
  '安徽':   { rain: 1100, months: '6-8月', seis: 7, frost: 0,   soil: '平原黏土/皖南山地',      dialect: '江淮官话/赣语' },
  '福建':   { rain: 1650, months: '5-9月', seis: 7, frost: 0,   soil: '沿海丘陵红土、台风区',   dialect: '闽语/客家话' },
  '江西':   { rain: 1550, months: '4-9月', seis: 6, frost: 0,   soil: '丘陵红黏土、地下水位高', dialect: '赣语/客家话' },
  '山东':   { rain: 680,  months: '7-8月', seis: 7, frost: 0.5, soil: '丘陵棕壤/平原淤土',      dialect: '北方官话' },
  '河南':   { rain: 700,  months: '7-8月', seis: 7, frost: 0.5, soil: '黄淮冲积平原、湿陷性土', dialect: '中原官话' },
  '湖北':   { rain: 1150, months: '5-8月', seis: 6, frost: 0,   soil: '江汉平原软土/鄂西山地',  dialect: '西南官话' },
  '湖南':   { rain: 1400, months: '4-8月', seis: 6, frost: 0,   soil: '丘陵红黏土、多雨潮湿',   dialect: '湘语/西南官话' },
  '广东':   { rain: 1750, months: '4-9月', seis: 7, frost: 0,   soil: '丘陵赤红壤、台风暴雨区', dialect: '粤语/客家话/潮汕话' },
  '广西':   { rain: 1600, months: '5-9月', seis: 6, frost: 0,   soil: '岩溶(喀斯特)红黏土',     dialect: '粤语/壮语/西南官话' },
  '海南':   { rain: 1900, months: '5-10月',seis: 8, frost: 0,   soil: '砖红壤、台风频发',       dialect: '海南话/粤语' },
  '重庆':   { rain: 1150, months: '5-9月', seis: 6, frost: 0,   soil: '山城岩石边坡、红黏土',   dialect: '西南官话(重庆话)' },
  '四川':   { rain: 1000, months: '6-9月', seis: 7, frost: 0,   soil: '盆地红黏土/川西高原',    dialect: '西南官话(四川话)' },
  '贵州':   { rain: 1150, months: '5-9月', seis: 6, frost: 0,   soil: '喀斯特岩溶、山地斜坡',   dialect: '西南官话' },
  '云南':   { rain: 1100, months: '6-10月',seis: 8, frost: 0,   soil: '高原红土、活动断裂带',   dialect: '西南官话/多民族语言' },
  '西藏':   { rain: 450,  months: '7-8月', seis: 8, frost: 1.2, soil: '高原砂砾土、高烈度区',   dialect: '藏语' },
  '陕西':   { rain: 600,  months: '7-9月', seis: 8, frost: 0.6, soil: '关中黄土/秦岭山地',      dialect: '中原官话/晋语' },
  '甘肃':   { rain: 350,  months: '7-8月', seis: 8, frost: 1.2, soil: '黄土高原、湿陷性强',     dialect: '兰银官话/中原官话' },
  '青海':   { rain: 380,  months: '7-8月', seis: 7, frost: 1.5, soil: '高原冻土、盐渍土',       dialect: '中原官话/藏语' },
  '宁夏':   { rain: 280,  months: '7-8月', seis: 8, frost: 1.2, soil: '黄土、干旱少雨',         dialect: '兰银官话' },
  '新疆':   { rain: 160,  months: '6-8月', seis: 8, frost: 1.5, soil: '戈壁砂砾土、干旱冻土',   dialect: '兰银官话/维吾尔语' }
};

/* 省份别名 / 简称 */
const REGION_ALIAS = {
  '川': '四川', '蜀': '四川', '四川话': '四川',
  '渝': '重庆',
  '豫': '河南', '河南话': '河南',
  '湘': '湖南',
  '赣': '江西',
  '粤': '广东', '广东话': '广东',
  '桂': '广西',
  '陕': '陕西', '秦': '陕西',
  '滇': '云南', '云': '云南',
  '黔': '贵州', '贵': '贵州'
};

/* ---------- 方言/口语词典（命中后在气泡下打标签，可持续扩充） ---------- */
/* 顺序即优先级：渲染前按词条长度降序匹配，避免"圈"误替换"猪栏圈"  */
const DIALECT_WORDS = [
  /* 川渝 / 西南官话 */
  { word: '茅司', std: '厕所',   area: '川渝' },
  { word: '茅厮', std: '厕所',   area: '川渝' },
  { word: '灶屋', std: '厨房',   area: '川渝/湘' },
  { word: '睡房', std: '卧室',   area: '川渝' },
  { word: '坝坝', std: '院子',   area: '川渝' },
  { word: '坝子', std: '院子',   area: '川渝' },
  { word: '院坝', std: '院子',   area: '川渝' },
  { word: '好多钱', std: '多少钱', area: '川渝' },
  { word: '好多层', std: '几层',   area: '川渝' },
  { word: '好多平', std: '多少平方米', area: '川渝' },
  { word: '要得', std: '可以/确认', area: '川渝' },
  { word: '咋个', std: '怎么',   area: '川渝' },
  { word: '啥子', std: '什么',   area: '川渝' },
  { word: '屋头', std: '家里',   area: '川渝' },
  { word: '圈圈', std: '猪圈',   area: '川渝' },
  /* 中原 / 西北 */
  { word: '灶房', std: '厨房',   area: '中原/西北' },
  { word: '茅子', std: '旱厕',   area: '中原/西北' },
  { word: '中中中', std: '可以', area: '中原' },
  { word: '咋整', std: '怎么办', area: '东北/北方' },
  { word: '俩层', std: '2层',    area: '北方' },
  /* 东北 */
  { word: '茅楼', std: '旱厕',   area: '东北' },
  { word: '外屋地', std: '厨房', area: '东北' },
  /* 湘赣 */
  { word: '猪栏', std: '猪圈',   area: '湘赣' },
  { word: '栏里', std: '猪圈',   area: '湖南' },
  { word: '杂屋', std: '杂物间', area: '湘赣' },
  { word: '地坪', std: '院子',   area: '湖南' },
  { word: '灶下', std: '厨房',   area: '江西' },
  { word: '禾场', std: '晒谷场', area: '江西' },
  /* 粤语 / 客家 */
  { word: '屋企', std: '家里',   area: '粤语区' },
  { word: '几多层', std: '几层', area: '粤语区' },
  { word: '地头', std: '宅基地', area: '粤语区' },
  { word: '几多钱', std: '多少钱', area: '粤语区' },
  /* 通用口语 */
  { word: '平房', std: '1层',    area: '通用口语' },
  { word: '小洋楼', std: '2-3层', area: '通用口语' },
  { word: '火房', std: '柴火灶厨房', area: '西南' },
  { word: '蹲坑', std: '旱厕',   area: '通用口语' }
];

/* ---------- 构造规则：降雨 / 抗震 / 冻土 / 地形 ---------- */
function rainRule(rain) {
  if (rain < 400) {
    return { tier: '干旱少雨', roof: '平顶(可晒粮)', slope: 5, eave: 20,
      drain: '屋面有组织排水，院内集水窖', risk: '防风沙、保温' };
  }
  if (rain < 800) {
    return { tier: '降雨适中', roof: '双坡屋顶', slope: 18, eave: 40,
      drain: '檐沟+落水管，房屋四周做散水', risk: '防雨一般设防' };
  }
  if (rain < 1200) {
    return { tier: '雨水较多', roof: '双坡屋顶', slope: 25, eave: 60,
      drain: '深挑檐+檐沟，散水宽80cm，院内地沟排水', risk: '防潮、基础抬高' };
  }
  if (rain < 1600) {
    return { tier: '多雨潮湿', roof: '陡坡屋顶', slope: 30, eave: 70,
      drain: '坡屋面+深挑檐，院内排水沟+化粪池防倒灌', risk: '首层架空或抬高30cm、地面防潮' };
  }
  return { tier: '暴雨/台风区', roof: '陡坡屋顶', slope: 35, eave: 80,
    drain: '强排水+双檐沟，屋面瓦抗风固定，院内管网排水', risk: '抗风揭、防潮、抬高地基' };
}

function seisRule(seis) {
  if (seis <= 6) return { struct: '砖混结构', measure: '地圈梁+屋面圈梁', col: false };
  if (seis === 7) return { struct: '砖混结构', measure: '圈梁+四大角构造柱', col: true };
  if (seis === 8) return { struct: '砖混(加强)或框架', measure: '圈梁+构造柱加密(开间≤4m)', col: true };
  return { struct: '推荐框架结构', measure: '全梁柱框架，控制层高与开洞，专业抗震计算', col: true };
}

function frostRule(frost) {
  if (!frost) return { depth: 0.6, text: '无冻土问题，基础埋深≥0.6m' };
  return { depth: +(frost + 0.25).toFixed(2),
    text: '当地标准冻深约' + frost + 'm，基础必须坐到冻土层以下，埋深≥' + (frost + 0.25).toFixed(2) + 'm' };
}

function terrainRule(t) {
  if (t === '平原')  return { text: '地势平坦：注意回填土分层夯实，排水找坡', extraCost: 0 };
  if (t === '镇上')  return { text: '镇边场地：做好与道路衔接、化粪池位置预留', extraCost: 0 };
  if (t === '丘陵')  return { text: '丘陵坡地：依坡就势错层布置，坡上设截水沟', extraCost: 80 };
  return { text: '山区场地：先做边坡勘察，必须设挡土墙/护坡，避开滑坡和汇水线', extraCost: 180 };
}
