const NAV = [
  { id: 'inicio', label: 'Inicio', shortLabel: 'Inicio', icon: '⌂' },
  { id: 'progreso', label: 'Mi progreso', shortLabel: 'Progreso', icon: '▥' },
  { id: 'lectura', label: 'Practicar lectura', shortLabel: 'Leer', icon: '文' },
  { id: 'trazos', label: 'Seguir trazos', shortLabel: 'Trazos', icon: '笔' },
  { id: 'escritura', label: 'Escritura', shortLabel: 'Escribir', icon: '写' },
  { id: 'vocabulario', label: 'Vocabulario', shortLabel: 'Palabras', icon: '▤' },
];

const STORE_KEY = 'hanzi-diario-v1';
const officialHskWords = window.HSK1_WORDS || [];
function mergeHsk1Words(existingWords = []) {
  const byHanzi = new Map(existingWords.map(word => [word.hanzi, word]));
  const officialHanzi = new Set(officialHskWords.map(word => word.hanzi));
  const official = officialHskWords.map(word => {
    const previous = byHanzi.get(word.hanzi);
    return { ...word, ...previous, id: previous?.id || word.id, hanzi: word.hanzi, pinyin: word.pinyin, meaning: word.meaning, category: 'HSK 1', hsk1: true, learned: Boolean(previous?.learned), type: word.type };
  });
  const custom = existingWords.filter(word => !officialHanzi.has(word.hanzi));
  const extrasByHanzi = new Map(custom.map(word => [word.hanzi, word]));
  return [...official, ...extrasByHanzi.values()];
}
function freshState() {
  return { words: officialHskWords.map(word => ({ ...word })), daily: {}, streak: 0, lastPractice: '', totalSessions: 0, totalMinutes: 0, goalMinutes: 15, level: 'HSK 1', score: 0, tracing: { completed: [], total: 0 } };
}
let state;
try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || freshState(); } catch { state = freshState(); }
if (!Array.isArray(state.words)) state = freshState();
state = { ...freshState(), ...state, words: mergeHsk1Words(state.words), daily: state.daily || {}, tracing: { completed: Array.isArray(state.tracing?.completed) ? state.tracing.completed : [], total: Number(state.tracing?.total) || 0 } };
const savedTheme = localStorage.getItem('hanzi-diario-theme') || 'light';
document.body.dataset.theme = savedTheme;
let page = 'inicio';
let mode = 'carácter';
let questionIndex = 0;
let answerState = null;
let optionQuestionId = null;
let optionIds = [];
let showPinyin = false;
let writingIndex = 0;
let writingValue = '';
let writingAttempt = null;
let traceIndex = 0;
let traceWriter = null;
let traceLoadPromise = null;
let cloudUser = null;
let cloudConfigured = false;
let cloudStatus = 'loading';
let filter = 'todas';
let query = '';
let deferredInstall = null;
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const save = () => {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  window.hanziCloud?.save(state);
};
window.hanziGetState = () => state;
const todayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fmtDate = (date = new Date(), options = { weekday: 'long', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('es-ES', options).format(date);
const dateKeyBack = n => { const date = new Date(); date.setDate(date.getDate() - n); return todayKey(date); };
const learnedWords = () => state.words.filter(word => word.learned);
const weeklyMinutes = () => Array.from({ length: 7 }, (_, index) => state.daily[dateKeyBack(6 - index)]?.minutes || 0);
const totalMinutesWeek = () => weeklyMinutes().reduce((sum, value) => sum + value, 0);
const dateLabels = () => Array.from({ length: 7 }, (_, index) => fmtDate(new Date(Date.now() - (6 - index) * 86400000), { weekday: 'narrow' }));

function updateStreak() {
  const today = todayKey();
  if (state.lastPractice && state.lastPractice !== today && state.lastPractice !== dateKeyBack(1)) state.streak = 0;
}
function navMarkup(className) {
  return NAV.map(item => `<button class="nav-item ${page === item.id ? 'active' : ''}" data-page="${item.id}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${className === 'mobile' ? item.shortLabel : item.label}</span>${item.id === 'vocabulario' ? `<span class="nav-count">${state.words.length}</span>` : ''}</button>`).join('');
}
function renderNav() {
  $('#desktop-nav').innerHTML = navMarkup('desktop');
  $('#mobile-nav').innerHTML = navMarkup('mobile');
  $('#page-breadcrumb').textContent = NAV.find(item => item.id === page)?.label.toLocaleUpperCase('es-ES') || 'INICIO';
}
function navigate(nextPage) {
  if(page==='trazos'&&nextPage!=='trazos')traceWriter?.cancelQuiz();
  page = nextPage;
  answerState = null;
  showPinyin = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function metric(label, value, suffix, icon) {
  return `<div class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${value}<span class="metric-suffix">${suffix}</span></div></div>`;
}
function wordRow(word) {
  return `<div class="word-row"><div class="word-hanzi" lang="zh">${esc(word.hanzi)}</div><div class="word-detail"><strong>${esc(word.meaning)}</strong><small>${esc(word.pinyin)}</small></div><span class="word-tag ${word.learned ? '' : 'learning'}">${word.learned ? 'Aprendida' : 'En práctica'}</span></div>`;
}
function streakDaysMarkup() {
  const todayIndex = (new Date().getDay() + 6) % 7;
  return ['L','M','X','J','V','S','D'].map((day, index) => {
    const offset = todayIndex - index;
    const done = offset >= 0 && Boolean(state.daily[dateKeyBack(offset)]?.answers);
    return `<span class="streak-day ${done ? 'done' : ''} ${index === todayIndex ? 'today' : ''}">${day}</span>`;
  }).join('');
}
function homePage() {
  const learned = learnedWords().length;
  const minutes = state.daily[todayKey()]?.minutes || 0;
  const percent = Math.min(100, Math.round((minutes / state.goalMinutes) * 100));
  const bars = weeklyMinutes();
  const labels = dateLabels();
  return `<div class="welcome-line"><div><div class="eyebrow">${fmtDate(new Date(), { weekday: 'long' }).toLocaleUpperCase('es-ES')} DE NUEVOS COMIENZOS</div><h1 class="page-title">Hola, aprendiz 👋</h1><p class="page-subtitle">Cada carácter que lees te acerca un poco más al chino.</p></div><div class="date-chip">${fmtDate()}</div></div>
  <div class="dashboard-grid">
    <section><div class="hero-card"><div class="hero-copy"><div class="hero-label">UN PASO CADA DÍA</div><h2>Tu chino, <em>a tu ritmo.</em></h2><p>Dedica unos minutos a leer algo nuevo. Tu progreso se guarda aquí, día a día.</p><div class="hero-actions"><button class="primary-button" data-page="lectura">Practicar lectura <span>↗</span></button><button class="hero-trace-link" data-page="trazos">Seguir trazos <span>→</span></button></div></div><div class="hero-art" aria-hidden="true"><span class="hero-kanji">读</span><span class="hero-small a">学</span><span class="hero-small b">好</span></div></div>
    <div class="metrics">${metric('Palabras aprendidas', learned, 'en total', '文')}${metric('Tiempo esta semana', totalMinutesWeek(), 'minutos', '◷')}${metric('Días de práctica', state.totalSessions, 'en total', '↗')}</div></section>
    <aside class="right-column"><div class="streak-card"><div class="streak-top">TU RACHA</div><div class="streak-number">${state.streak}<span class="metric-suffix">${state.streak === 1 ? 'día' : 'días'}</span></div><div class="streak-caption">${state.streak ? '¡Sigue así! Tu hábito está creciendo.' : 'Un ratito hoy puede ser el comienzo.'}</div><span class="streak-flower" aria-hidden="true">✳</span><div class="streak-days">${streakDaysMarkup()}</div></div>
    <div class="panel vocab-panel"><div class="panel-heading"><h3>Un repaso rápido</h3><button class="panel-link" data-page="vocabulario">Ver vocabulario ↗</button></div><div class="word-list">${state.words.length ? state.words.slice(-3).reverse().map(wordRow).join('') : '<div class="empty-state">Añade tu primera palabra y aparecerá aquí.</div>'}</div></div></aside>
    <section class="panel study-panel"><div class="panel-heading"><h3>Tu semana, en pequeños pasos</h3><button class="panel-link" data-page="progreso">Ver mi progreso ↗</button></div><div class="study-content"><div class="study-quote"><span class="quote-mark">“</span><p>Leerás con más soltura <strong>una palabra a la vez.</strong><small>Tu meta diaria: ${state.goalMinutes} minutos</small></p></div><div class="daily-progress"><div class="progress-ring" style="--progress:${percent * 3.6}deg"><span>${percent}%</span></div><div class="progress-label"><strong>${minutes} de ${state.goalMinutes} min</strong><small>${minutes >= state.goalMinutes ? '¡Meta de hoy cumplida!' : 'Tu práctica de hoy'}</small></div></div><div class="week-days">${bars.map((value,index) => `<div class="day-column ${index === 6 ? 'today' : ''}"><div class="day-bar-wrap"><div class="day-bar" style="height:${Math.min(100, value / Math.max(1, state.goalMinutes) * 100)}%"></div></div><small>${labels[index]}</small></div>`).join('')}</div></div></section>
  </div>`;
}
function progressPage() {
  const bars = weeklyMinutes(); const labels = dateLabels(); const max = Math.max(state.goalMinutes, ...bars, 1);
  return `<div class="welcome-line"><div><div class="eyebrow">PASO A PASO</div><h1 class="page-title">Tu progreso</h1><p class="page-subtitle">Mira todo lo que ya has recorrido. Cada minuto cuenta.</p></div><div class="date-chip">Semana del ${fmtDate(new Date(Date.now()-6*86400000), { day:'numeric', month:'short' })}</div></div>
  <div class="stat-row"><div class="stat-panel"><span>Palabras aprendidas</span><strong>${learnedWords().length}</strong></div><div class="stat-panel"><span>Minutos esta semana</span><strong>${totalMinutesWeek()}<small class="metric-suffix">min</small></strong></div><div class="stat-panel"><span>Racha actual</span><strong>${state.streak}<small class="metric-suffix">${state.streak === 1 ? 'día' : 'días'}</small></strong></div></div>
  <div class="content-grid"><section class="panel chart-panel"><div class="panel-heading"><h3>Minutos de práctica</h3><span class="section-kicker">ÚLTIMOS 7 DÍAS</span></div><div class="chart-area">${bars.map((value,index) => `<div class="chart-col ${index===6?'current':''}"><div class="chart-bar" style="height:${Math.max(2,value/max*100)}%" title="${value} minutos"></div><span>${labels[index]}</span></div>`).join('')}</div><div class="goal-card"><strong><span class="goal-dot"></span>Tu objetivo: ${state.goalMinutes} minutos al día</strong><p>La constancia se construye con metas pequeñas.</p><button class="panel-link" data-action="goal">Cambiar objetivo ↗</button></div></section>
  <aside><div class="level-card"><div class="level-kicker">TU NIVEL ACTUAL</div><div class="level-large">${esc(state.level)}</div><div class="level-name">HSK 3.0 · principiante</div><div class="level-track"><span style="width:${Math.min(100,Math.round(learnedWords().filter(word=>word.hsk1).length/300*100))}%"></span></div><div class="level-note">${learnedWords().filter(word=>word.hsk1).length} de 300 palabras HSK 1 aprendidas</div><button class="panel-link" style="padding:12px 0 0" data-action="level">Cambiar nivel ↗</button><br /><button class="panel-link" style="padding:12px 0 0" data-action="export">Descargar copia de mis datos ↓</button><button class="panel-link" style="padding:12px 0 0" data-action="import">Restaurar desde una copia ↑</button><input id="backup-file" type="file" accept="application/json,.json" hidden /><p class="level-note" style="line-height:1.6;margin-top:12px">Tus datos se guardan en este navegador. Usa una copia para llevarlos a otro dispositivo.</p></div><div class="goal-card"><strong>Tu cuaderno va creciendo</strong><p>Ya tienes ${state.words.length} ${state.words.length===1?'palabra':'palabras'} en tu vocabulario. Añade las que encuentres en tus lecturas.</p></div></aside></div>`;
}
const readingPhrases = [
  { id: 'phrase-01', hanzi: '我叫 Albert。', pinyin: 'Wǒ jiào Albert.', meaning: 'Me llamo Albert.', category: 'Presentarse' },
  { id: 'phrase-02', hanzi: '你叫什么名字？', pinyin: 'Nǐ jiào shénme míngzi?', meaning: '¿Cómo te llamas?', category: 'Presentarse' },
  { id: 'phrase-03', hanzi: '我是学生。', pinyin: 'Wǒ shì xuésheng.', meaning: 'Soy estudiante.', category: 'Presentarse' },
  { id: 'phrase-04', hanzi: '我喜欢喝茶。', pinyin: 'Wǒ xǐhuan hē chá.', meaning: 'Me gusta beber té.', category: 'Comida y bebida' },
  { id: 'phrase-05', hanzi: '今天很热。', pinyin: 'Jīntiān hěn rè.', meaning: 'Hoy hace mucho calor.', category: 'El tiempo' },
  { id: 'phrase-06', hanzi: '我们去学校。', pinyin: 'Wǒmen qù xuéxiào.', meaning: 'Vamos a la escuela.', category: 'Lugares' },
  { id: 'phrase-07', hanzi: '你会说汉语吗？', pinyin: 'Nǐ huì shuō Hànyǔ ma?', meaning: '¿Sabes hablar chino?', category: 'Idiomas' },
  { id: 'phrase-08', hanzi: '我家有三个人。', pinyin: 'Wǒ jiā yǒu sān ge rén.', meaning: 'En mi familia somos tres personas.', category: 'Familia' },
  { id: 'phrase-09', hanzi: '现在几点？', pinyin: 'Xiànzài jǐ diǎn?', meaning: '¿Qué hora es ahora?', category: 'La hora' },
  { id: 'phrase-10', hanzi: '他在北京工作。', pinyin: 'Tā zài Běijīng gōngzuò.', meaning: 'Él trabaja en Pekín.', category: 'Trabajo' },
  { id: 'phrase-11', hanzi: '这本书很好看。', pinyin: 'Zhè běn shū hěn hǎokàn.', meaning: 'Este libro es muy interesante.', category: 'Objetos' },
  { id: 'phrase-12', hanzi: '我想买一个杯子。', pinyin: 'Wǒ xiǎng mǎi yí ge bēizi.', meaning: 'Quiero comprar una taza.', category: 'Compras' },
  { id: 'phrase-13', hanzi: '妈妈在家。', pinyin: 'Māma zài jiā.', meaning: 'Mamá está en casa.', category: 'Familia' },
  { id: 'phrase-14', hanzi: '请问，商店在哪里？', pinyin: 'Qǐngwèn, shāngdiàn zài nǎlǐ?', meaning: 'Disculpe, ¿dónde está la tienda?', category: 'Lugares' },
  { id: 'phrase-15', hanzi: '我今天很忙。', pinyin: 'Wǒ jīntiān hěn máng.', meaning: 'Hoy estoy muy ocupado.', category: 'Rutina' },
  { id: 'phrase-16', hanzi: '他们是我的朋友。', pinyin: 'Tāmen shì wǒ de péngyou.', meaning: 'Ellos son mis amigos.', category: 'Personas' },
  { id: 'phrase-17', hanzi: '你想吃什么？', pinyin: 'Nǐ xiǎng chī shénme?', meaning: '¿Qué quieres comer?', category: 'Comida' },
  { id: 'phrase-18', hanzi: '爸爸在家吗？', pinyin: 'Bàba zài jiā ma?', meaning: '¿Papá está en casa?', category: 'Familia' },
  { id: 'phrase-19', hanzi: '我们明天去北京。', pinyin: 'Wǒmen míngtiān qù Běijīng.', meaning: 'Mañana vamos a Pekín.', category: 'Tiempo y lugares' },
  { id: 'phrase-20', hanzi: '我没有哥哥。', pinyin: 'Wǒ méiyǒu gēge.', meaning: 'No tengo hermano mayor.', category: 'Familia' },
];
function questionPool() {
  if(mode==='frase') return readingPhrases;
  const eligible = state.words.filter(word => mode === 'carácter' ? [...word.hanzi].length === 1 : [...word.hanzi].length > 1);
  return eligible.length ? eligible : state.words;
}
function optionsForQuestion(question) {
  const answerBank=mode==='frase'?readingPhrases:state.words;
  const availableIds=new Set(answerBank.map(word=>word.id));
  if(optionQuestionId!==question.id||optionIds.some(id=>!availableIds.has(id))) {
    const others=answerBank.filter(word=>word.id!==question.id).sort(()=>Math.random()-.5).slice(0,3);
    optionQuestionId=question.id;
    optionIds=[question.id,...others.map(word=>word.id)];
    for(let index=optionIds.length-1;index>0;index--) {
      const swapIndex=Math.floor(Math.random()*(index+1));
      [optionIds[index],optionIds[swapIndex]]=[optionIds[swapIndex],optionIds[index]];
    }
  }
  const wordsById=new Map(answerBank.map(word=>[word.id,word]));
  return optionIds.map(id=>wordsById.get(id)).filter(Boolean);
}
function readingPage() {
  const pool=questionPool(); const question=pool.length?pool[questionIndex%pool.length]:null;
  if(!question) return `<div class="welcome-line"><div><div class="eyebrow">UN RATITO PARA TI</div><h1 class="page-title">Practica la lectura</h1><p class="page-subtitle">Añade palabras al vocabulario para empezar tus ejercicios.</p></div></div><div class="panel empty-box"><button class="add-button" data-action="add-word">Añadir mi primera palabra</button></div>`;
  const optionWords=optionsForQuestion(question);
  const allOptions=optionWords.map(word=>`<button class="answer-option ${answerState?.selected===word.id?(answerState.correct?'correct':'wrong'):''} ${answerState?.correct&&word.id===question.id?'correct':''}" data-answer="${esc(word.id)}" ${answerState?'disabled':''}>${esc(word.meaning)}</button>`).join('');
  const answered=state.daily[todayKey()]?.answers||0;
  return `<div class="welcome-line"><div><div class="eyebrow">UN RATITO PARA TI</div><h1 class="page-title">Practica la lectura</h1><p class="page-subtitle">Mira los caracteres, piensa un momento y elige su significado.</p></div><div class="date-chip">${fmtDate()}</div></div>
  <div class="reading-layout"><section class="practice-card"><div class="practice-top"><span class="practice-badge">LECTURA ${mode==='carácter'?'DE CARACTERES':'DE FRASES'}</span><span class="question-progress">${answered} ${answered===1?'respuesta':'respuestas'} hoy</span></div><div class="mode-switch"><button class="mode-button ${mode==='carácter'?'active':''}" data-mode="carácter">Caracteres</button><button class="mode-button ${mode==='frase'?'active':''}" data-mode="frase">Frases</button></div><div class="question-card"><div class="question-caption">¿QUÉ SIGNIFICA?</div><div class="question-hanzi" lang="zh">${esc(question.hanzi)}</div><div class="question-pinyin ${showPinyin?'visible':''}" aria-live="polite">${showPinyin?esc(question.pinyin):''}</div><div class="question-hint">${answerState?esc(question.category):'Tómate tu tiempo para leerlo'}</div><button class="pinyin-toggle" data-action="toggle-pinyin" aria-expanded="${showPinyin}">${showPinyin?'Ocultar pinyin':'Mostrar pinyin'} <span aria-hidden="true">${showPinyin?'↑':'↓'}</span></button></div><div class="answer-title">Elige la traducción correcta</div><div class="answer-options">${allOptions}</div>${answerState?`<div class="feedback ${answerState.correct?'':'incorrect'}"><span>${answerState.correct?'¡Muy bien! ':'Casi. La respuesta es: '}${esc(question.meaning)} <strong>· ${esc(question.pinyin)}</strong></span><button data-action="next">Siguiente →</button></div>`:''}</section>
  <aside class="practice-aside"><div class="tips-card"><h3>Una pista para leer</h3><p>Antes de buscar la respuesta, intenta reconocer cada carácter. <strong>Los tonos y el contexto</strong> te ayudan a recordar qué significa la palabra.</p></div><div class="session-card"><h3>Tu práctica de hoy</h3><div class="session-row"><span>Respuestas</span><strong>${answered}</strong></div><div class="session-row"><span>Aciertos</span><strong>${state.daily[todayKey()]?.correct||0}</strong></div><div class="session-row"><span>Tu objetivo</span><strong>${state.goalMinutes} min</strong></div></div></aside></div>`;
}
const tracingWords = officialHskWords.filter(word => [...word.hanzi].length === 1);
const currentTraceWord = () => tracingWords[traceIndex % tracingWords.length];
function tracingPage() {
  const word = currentTraceWord();
  const completed = new Set(state.tracing.completed).size;
  const progress = Math.round((completed / tracingWords.length) * 100);
  return `<div class="welcome-line"><div><div class="eyebrow">ESCRIBE CON ORDEN</div><h1 class="page-title">Seguir trazos</h1><p class="page-subtitle">Aprende por dónde empieza cada trazo y practícalo con el dedo o el ratón.</p></div><div class="date-chip">${completed} de ${tracingWords.length} caracteres practicados</div></div>
  <div class="trace-layout"><section class="trace-card"><div class="trace-card-heading"><div class="trace-heading-mark" aria-hidden="true">笔</div><div><span class="trace-kicker">HSK 1 · CARACTERES</span><h2>Un trazo cada vez</h2></div><span class="trace-complete-chip"><strong id="trace-completed-number">${completed}</strong> / ${tracingWords.length}</span></div>
    <div class="trace-progress" role="progressbar" aria-label="Caracteres practicados" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${tracingWords.length}"><span id="trace-progress-fill" style="width:${progress}%"></span></div>
    <label class="trace-select-label" for="trace-character-select">Elige un carácter</label><select id="trace-character-select" class="trace-select">${tracingWords.map((item,index)=>`<option value="${esc(item.id)}" ${index===traceIndex?'selected':''}>${esc(item.hanzi)}　${esc(item.pinyin)} · ${esc(item.meaning)}</option>`).join('')}</select>
    <div class="trace-character-meta"><div class="trace-character-name" lang="zh">${esc(word.hanzi)}</div><div><strong>${esc(word.meaning)}</strong><span>${esc(word.pinyin)}</span></div><span class="trace-hsk-tag">HSK 1</span></div>
    <div class="trace-stage"><div class="trace-guides" aria-hidden="true"><i></i><i></i><i></i></div><div id="trace-canvas" role="img" aria-label="Guía interactiva de trazos para ${esc(word.hanzi)}"><span class="trace-fallback-hanzi" lang="zh">${esc(word.hanzi)}</span></div></div>
    <div class="trace-status" id="trace-status" role="status" aria-live="polite">Preparando la guía de trazos…</div><div class="trace-stroke-progress"><span>TRAZOS</span><strong><span id="trace-stroke-count">0</span><span class="trace-stroke-divider"> / </span><span id="trace-stroke-total">—</span></strong></div>
    <div class="trace-actions"><button class="trace-secondary-button" type="button" data-action="trace-animate" disabled><span aria-hidden="true">▷</span> Ver el orden</button><button class="trace-primary-button" type="button" data-action="trace-start" disabled><span aria-hidden="true">✎</span> Empezar a trazar</button></div>
    <div class="trace-character-nav"><button type="button" data-action="trace-previous">← Anterior</button><span>${traceIndex + 1} de ${tracingWords.length}</span><button type="button" data-action="trace-next">Siguiente →</button></div>
  </section><aside class="trace-aside"><section class="trace-coach-card"><div class="trace-coach-mark" aria-hidden="true">顺</div><span class="trace-kicker">CÓMO PRACTICAR</span><h3>Respeta el orden natural</h3><p>El carácter aparecerá como una guía tenue. Dibuja cada trazo de una sola vez, siguiendo su dirección.</p><div class="trace-coach-steps"><div><span>01</span><p>Mira la animación del orden</p></div><div><span>02</span><p>Repítelo con el dedo</p></div><div><span>03</span><p>Completa el carácter</p></div></div></section><section class="trace-progress-card"><div class="trace-progress-title"><span aria-hidden="true">✦</span><div><strong>Tu recorrido</strong><small>Tu avance se guarda con tu progreso</small></div></div><div class="trace-progress-number"><strong id="trace-completed-aside">${completed}</strong><span>caracteres practicados</span></div><div class="trace-progress-track"><span id="trace-progress-aside-fill" style="width:${progress}%"></span></div></section></aside></div>`;
}
function loadHanziWriter() {
  if (window.HanziWriter) return Promise.resolve(window.HanziWriter);
  if (traceLoadPromise) return traceLoadPromise;
  traceLoadPromise = new Promise((resolve,reject) => {
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/hanzi-writer@3.5/dist/hanzi-writer.min.js';
    script.async=true;
    script.onload=()=>window.HanziWriter?resolve(window.HanziWriter):reject(new Error('No se encontró Hanzi Writer.'));
    script.onerror=()=>reject(new Error('No se pudo cargar la guía de trazos.'));
    document.head.appendChild(script);
  });
  return traceLoadPromise;
}
async function mountTracingPractice() {
  const target=$('#trace-canvas');
  if(!target)return;
  const status=$('#trace-status');
  try {
    const HanziWriter=await loadHanziWriter();
    if(page!=='trazos'||!$('#trace-canvas'))return;
    if(traceWriter)traceWriter.cancelQuiz();
    const word=currentTraceWord();
    const targetSize=Math.max(220,Math.min(290,Math.floor(target.clientWidth||270)));
    const darkMode=document.body.dataset.theme==='dark';
    traceWriter=HanziWriter.create(target,word.hanzi,{
      width:targetSize,height:targetSize,padding:22,showOutline:true,showCharacter:false,
      strokeColor:darkMode?'#dce8ef':'#334d67',
      outlineColor:darkMode?'#657782':'#eff1eb',
      highlightColor:'#e2a987',radicalColor:'#d68a70',drawingColor:'#d68a70',drawingWidth:12,
      showHintAfterMisses:2,highlightOnComplete:false,
      onLoadCharDataSuccess(data){
        target.querySelector('.trace-fallback-hanzi')?.remove();
        const total=$('#trace-stroke-total');
        if(total)total.textContent=data.strokes.length;
        const currentStatus=$('#trace-status');
        if(currentStatus)currentStatus.textContent='Guía lista. Sigue la forma tenue con el dedo o el ratón.';
        document.querySelectorAll('[data-action^="trace-"][disabled]').forEach(button=>button.disabled=false);
      },
      onLoadCharDataError(){
        const currentStatus=$('#trace-status');
        if(currentStatus)currentStatus.textContent='No encontramos la guía de este carácter. Comprueba tu conexión e inténtalo de nuevo.';
      },
    });
  } catch(error) {
    console.error('No se pudo preparar la práctica de trazos:',error);
    if(status)status.textContent='No se pudo cargar la guía. Comprueba tu conexión y vuelve a intentarlo.';
  }
}
function completeTracePractice() {
  const word=currentTraceWord();
  if(!state.tracing.completed.includes(word.hanzi))state.tracing.completed.push(word.hanzi);
  state.tracing.total++;
  save();
  const completed=new Set(state.tracing.completed).size;
  const progress=Math.round((completed/tracingWords.length)*100);
  const completedNumber=$('#trace-completed-number');
  if(!completedNumber)return;
  completedNumber.textContent=completed;
  $('#trace-completed-aside').textContent=completed;
  $('#trace-progress-fill').style.width=`${progress}%`;
  $('#trace-progress-aside-fill').style.width=`${progress}%`;
  $('.trace-progress[role="progressbar"]').setAttribute('aria-valuenow',completed);
  $('#trace-status').textContent=`¡Muy bien! Has completado ${word.hanzi} siguiendo el orden correcto.`;
  showToast(`¡Carácter ${word.hanzi} completado!`);
}
const writingPrompts = [
  { prompt: 'Tengo 22 años.', accepted: ['我二十二岁', '我今年二十二岁', '我22岁', '我今年22岁'], answer: '我二十二岁。', pinyin: 'Wǒ èrshí’èr suì.' },
  { prompt: 'Me llamo Albert.', accepted: ['我叫Albert', '我叫阿尔伯特'], answer: '我叫 Albert。', pinyin: 'Wǒ jiào Albert.' },
  { prompt: 'Soy estudiante.', accepted: ['我是学生'], answer: '我是学生。', pinyin: 'Wǒ shì xuésheng.' },
  { prompt: '¿Cómo te llamas?', accepted: ['你叫什么名字'], answer: '你叫什么名字？', pinyin: 'Nǐ jiào shénme míngzi?' },
  { prompt: 'Me gusta beber té.', accepted: ['我喜欢喝茶'], answer: '我喜欢喝茶。', pinyin: 'Wǒ xǐhuan hē chá.' },
  { prompt: 'Hoy hace mucho calor.', accepted: ['今天很热'], answer: '今天很热。', pinyin: 'Jīntiān hěn rè.' },
  { prompt: 'Vamos a la escuela.', accepted: ['我们去学校'], answer: '我们去学校。', pinyin: 'Wǒmen qù xuéxiào.' },
  { prompt: '¿Qué hora es ahora?', accepted: ['现在几点'], answer: '现在几点？', pinyin: 'Xiànzài jǐ diǎn?' },
  { prompt: 'Él trabaja en Pekín.', accepted: ['他在北京工作'], answer: '他在北京工作。', pinyin: 'Tā zài Běijīng gōngzuò.' },
  { prompt: 'Este libro es muy interesante.', accepted: ['这本书很好看'], answer: '这本书很好看。', pinyin: 'Zhè běn shū hěn hǎokàn.' },
  { prompt: 'Quiero comprar una taza.', accepted: ['我想买一个杯子'], answer: '我想买一个杯子。', pinyin: 'Wǒ xiǎng mǎi yí ge bēizi.' },
  { prompt: '¿Dónde está la tienda?', accepted: ['商店在哪里', '请问商店在哪里'], answer: '商店在哪里？', pinyin: 'Shāngdiàn zài nǎlǐ?' },
];
function writingPage() {
  const exercise = writingPrompts[writingIndex % writingPrompts.length];
  const attempt = writingAttempt;
  const progress = Math.round(((writingIndex + 1) / writingPrompts.length) * 100);
  return `<div class="welcome-line"><div><div class="eyebrow">ESCRIBE CON HANZI</div><h1 class="page-title">Escritura en chino</h1><p class="page-subtitle">Pasa tus ideas del español al chino, una frase a la vez.</p></div><div class="date-chip">${writingIndex + 1} de ${writingPrompts.length} ejercicios</div></div>
  <div class="writing-layout"><section class="writing-card">
    <div class="writing-card-top"><div class="writing-card-label"><span class="writing-card-icon" aria-hidden="true">写</span><span><strong>Práctica de escritura</strong><small>ESPAÑOL <span>→</span> HANZI</small></span></div><div class="writing-step"><small>RETO</small><strong>${String(writingIndex + 1).padStart(2, '0')}<span> / ${String(writingPrompts.length).padStart(2, '0')}</span></strong></div></div>
    <div class="writing-progress" role="progressbar" aria-label="Progreso de ejercicios" aria-valuenow="${writingIndex + 1}" aria-valuemin="1" aria-valuemax="${writingPrompts.length}"><span style="width:${progress}%"></span></div>
    <div class="writing-prompt"><div class="writing-prompt-mark" aria-hidden="true">文</div><div class="writing-prompt-copy"><span>TRADUCE ESTA FRASE</span><h2>${esc(exercise.prompt)}</h2><p>¿Cómo lo dirías en chino? Escríbelo en caracteres Hanzi.</p></div></div>
    <form id="writing-form" class="writing-form"><div class="writing-input-heading"><label for="writing-answer">Tu respuesta</label><span lang="zh">中文</span></div><textarea id="writing-answer" name="answer" lang="zh" rows="4" placeholder="Empieza a escribir aquí…" autocomplete="off" autocapitalize="off" spellcheck="false" ${attempt ? 'disabled' : ''}>${esc(writingValue)}</textarea><div class="writing-input-note"><span aria-hidden="true">✦</span><small>Puedes usar el teclado chino de tu dispositivo.</small></div><div class="writing-form-foot"><small>La puntuación es opcional</small><button class="primary-button" type="submit" ${attempt ? 'disabled' : ''}><span>Comprobar respuesta</span><span class="writing-submit-icon" aria-hidden="true">↗</span></button></div></form>
    ${attempt ? `<div class="writing-feedback ${attempt.correct ? 'correct' : 'incorrect'}"><div class="writing-feedback-title"><span class="writing-feedback-icon" aria-hidden="true">${attempt.correct ? '✓' : '↻'}</span><strong>${attempt.correct ? '¡Muy bien!' : 'Casi, sigue practicando'}</strong></div><p>${attempt.correct ? 'Has escrito la frase correctamente.' : 'Esta es una forma correcta de escribirlo:'}</p><div class="writing-model-answer" lang="zh">${esc(exercise.answer)}<small>${esc(exercise.pinyin)}</small></div><button class="add-button" type="button" data-action="writing-next">Siguiente frase <span aria-hidden="true">→</span></button></div>` : ''}
  </section><aside class="writing-aside"><section class="writing-coach-card"><div class="writing-coach-glyph" aria-hidden="true">学</div><span class="writing-coach-kicker">UN PASO A LA VEZ</span><h3>Piensa. Escribe. Aprende.</h3><p>La mejor forma de recordar una frase es construirla tú mismo.</p><div class="writing-coach-steps"><div><span>01</span><p>Lee la frase en español</p></div><div><span>02</span><p>Recuerda los caracteres</p></div><div><span>03</span><p>Comprueba tu respuesta</p></div></div></section><section class="writing-today-card"><div class="writing-today-heading"><span class="writing-today-icon" aria-hidden="true">◷</span><div><strong>Tu práctica de hoy</strong><small>Vas sumando, poco a poco</small></div></div><div class="writing-today-stats"><div><strong>${state.daily[todayKey()]?.answers || 0}</strong><span>respuestas</span></div><i aria-hidden="true"></i><div><strong>${state.daily[todayKey()]?.correct || 0}</strong><span>aciertos</span></div></div></section></aside></div>`;
}
function vocabPage() {
  const filtered=state.words.filter(word=>(filter==='todas'||(filter==='aprendidas'?word.learned:filter==='practica'?!word.learned:filter==='hsk1'?word.hsk1:false))&&(`${word.hanzi} ${word.pinyin} ${word.meaning} ${word.category}`).toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  return `<div class="welcome-line"><div><div class="eyebrow">TU CUADERNO PERSONAL</div><h1 class="page-title">Mi vocabulario</h1><p class="page-subtitle">Guarda aquí las palabras que vas aprendiendo.</p></div><div class="date-chip">${state.words.length} palabras · ${officialHskWords.length} HSK 1</div></div><div class="vocab-toolbar"><div class="search-box"><input type="search" id="word-search" placeholder="Buscar palabra, pinyin o significado…" value="${esc(query)}" aria-label="Buscar vocabulario" /></div><select class="filter-select" id="word-filter" aria-label="Filtrar vocabulario"><option value="todas" ${filter==='todas'?'selected':''}>Todas</option><option value="hsk1" ${filter==='hsk1'?'selected':''}>HSK 1 (${officialHskWords.length})</option><option value="aprendidas" ${filter==='aprendidas'?'selected':''}>Aprendidas</option><option value="practica" ${filter==='practica'?'selected':''}>En práctica</option></select><button class="add-button" data-action="add-word">＋ Añadir palabra</button></div>
  <section class="panel vocab-table"><div class="vocab-table-head"><span>CARÁCTER</span><span>PINYIN</span><span>CATEGORÍA</span><span>ESTADO</span><span></span></div>${filtered.length?filtered.map(word=>`<div class="vocab-table-row"><div class="hanzi" lang="zh">${esc(word.hanzi)}</div><div class="pinyin">${esc(word.pinyin)}</div><div class="category">${esc(word.category)}</div><span class="status-pill ${word.learned?'':'learning'}">${word.learned?'Aprendida':'En práctica'}</span><div class="row-actions"><button title="${word.learned?'Marcar en práctica':'Marcar aprendida'}" aria-label="${word.learned?'Marcar en práctica':'Marcar aprendida'}" data-action="toggle-word" data-id="${esc(word.id)}">${word.learned?'✓':'○'}</button></div></div>`).join(''):'<div class="empty-box">No encontramos palabras con esa búsqueda. Puedes añadirla a tu cuaderno.</div>'}</section>`;
}
function render() {
  updateStreak();
  $('#today-label').textContent=fmtDate(new Date(),{day:'numeric',month:'short'});
  renderNav();
  const views={inicio:homePage,progreso:progressPage,lectura:readingPage,trazos:tracingPage,escritura:writingPage,vocabulario:vocabPage};
  $('#page-content').innerHTML=(views[page]||homePage)();
  bindPageEvents();
  if(page==='trazos')mountTracingPractice();
}
function bindPageEvents() {
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.page)));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;questionIndex=0;answerState=null;optionQuestionId=null;optionIds=[];showPinyin=false;render()}));
  document.querySelectorAll('[data-action="toggle-pinyin"]').forEach(button=>button.addEventListener('click',()=>{showPinyin=!showPinyin;render()}));
  document.querySelectorAll('[data-answer]').forEach(button=>button.addEventListener('click',()=>answer(button.dataset.answer)));
  document.querySelectorAll('[data-action="next"]').forEach(button=>button.addEventListener('click',()=>{questionIndex++;answerState=null;optionQuestionId=null;optionIds=[];showPinyin=false;render()}));
  document.querySelectorAll('[data-action="writing-next"]').forEach(button=>button.addEventListener('click',nextWritingPrompt));
  const traceSelect=$('#trace-character-select');
  if(traceSelect)traceSelect.addEventListener('change',()=>{traceIndex=tracingWords.findIndex(word=>word.id===traceSelect.value);render()});
  document.querySelectorAll('[data-action="trace-previous"]').forEach(button=>button.addEventListener('click',()=>moveTrace(-1)));
  document.querySelectorAll('[data-action="trace-next"]').forEach(button=>button.addEventListener('click',()=>moveTrace(1)));
  document.querySelectorAll('[data-action="trace-animate"]').forEach(button=>button.addEventListener('click',()=>{
    if(!traceWriter)return;
    $('#trace-stroke-count').textContent='0';
    $('#trace-status').textContent='Mira la dirección y el orden de cada trazo.';
    traceWriter.animateCharacter({onComplete:()=>{if($('#trace-status'))$('#trace-status').textContent='Ahora prueba a dibujarlo tú.'}});
  }));
  document.querySelectorAll('[data-action="trace-start"]').forEach(button=>button.addEventListener('click',()=>{
    if(!traceWriter)return;
    $('#trace-stroke-count').textContent='0';
    $('#trace-status').textContent='Empieza a dibujar el carácter en orden.';
    traceWriter.quiz({
      onMistake(){if($('#trace-status'))$('#trace-status').textContent='No pasa nada. Observa la guía tenue e inténtalo otra vez.'},
      onCorrectStroke(data){const count=$('#trace-stroke-count');if(count)count.textContent=data.strokeNum+1},
      onComplete(){completeTracePractice()},
    });
  }));
  const writingForm=$('#writing-form');
  if(writingForm) {
    const writingInput=$('#writing-answer');
    writingInput.addEventListener('input',event=>{writingValue=event.currentTarget.value});
    writingInput.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229) {
        event.preventDefault();
        writingForm.requestSubmit();
      }
    });
    writingForm.addEventListener('submit',event=>{event.preventDefault();submitWritingAnswer()});
  }
  document.querySelectorAll('[data-action="add-word"]').forEach(button=>button.addEventListener('click',showAddDialog));
  document.querySelectorAll('[data-action="toggle-word"]').forEach(button=>button.addEventListener('click',()=>{const word=state.words.find(item=>item.id===button.dataset.id);if(word){word.learned=!word.learned;save();render();showToast(word.learned?'¡Palabra aprendida!':'Palabra en práctica')}}));
  document.querySelectorAll('[data-action="level"]').forEach(button=>button.addEventListener('click',changeLevel));
  document.querySelectorAll('[data-action="goal"]').forEach(button=>button.addEventListener('click',showGoalDialog));
  document.querySelectorAll('[data-action="export"]').forEach(button=>button.addEventListener('click',exportBackup));
  document.querySelectorAll('[data-action="import"]').forEach(button=>button.addEventListener('click',()=>$('#backup-file')?.click()));
  const backupFile=$('#backup-file'); if(backupFile) backupFile.addEventListener('change',importBackup);
  const search=$('#word-search'); if(search) search.addEventListener('input',()=>{query=search.value;const pos=search.selectionStart;render();const next=$('#word-search');next.focus();next.setSelectionRange(pos,pos)});
  const select=$('#word-filter'); if(select) select.addEventListener('change',()=>{filter=select.value;render()});
}
function moveTrace(offset) {
  traceIndex=(traceIndex+offset+tracingWords.length)%tracingWords.length;
  render();
}
function answer(id) {
  const question=questionPool()[questionIndex%questionPool().length];
  const correct=id===question.id;
  answerState={selected:id,correct};
  recordPracticeAnswer(correct,mode==='carácter'?question:null);
  render();
}
function recordPracticeAnswer(correct, learnedWord = null) {
  const today=todayKey(); state.daily[today] ||= {minutes:0,answers:0,correct:0};
  state.daily[today].answers++;
  state.daily[today].minutes++;state.totalMinutes++;
  if(correct){state.daily[today].correct++;state.score++;if(learnedWord)learnedWord.learned=true;}
  if(state.lastPractice!==today){state.streak=state.lastPractice===dateKeyBack(1)?(state.streak||0)+1:1;state.lastPractice=today;state.totalSessions++;}
  save();
}
function normalizeWriting(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('es').replace(/[\s。，、！？；：,.!?;:'"“”‘’]/gu,'');
}
function submitWritingAnswer() {
  if(writingAttempt)return;
  if(!normalizeWriting(writingValue)) { showToast('Escribe tu respuesta en chino antes de enviarla.'); return; }
  const exercise=writingPrompts[writingIndex%writingPrompts.length];
  const answer=normalizeWriting(writingValue);
  const correct=exercise.accepted.some(option=>normalizeWriting(option)===answer);
  writingAttempt={correct};
  recordPracticeAnswer(correct);
  render();
}
function nextWritingPrompt() {
  writingIndex=(writingIndex+1)%writingPrompts.length;
  writingValue='';
  writingAttempt=null;
  render();
}
function changeLevel() {
  const levels=['HSK 1','HSK 2','HSK 3','HSK 4','HSK 5','HSK 6'];
  const index=levels.indexOf(state.level);state.level=levels[(index+1)%levels.length];save();render();showToast(`Nivel actualizado a ${state.level}`);
}
function showGoalDialog() {
  const backdrop=document.createElement('div');backdrop.className='dialog-backdrop';backdrop.innerHTML=`<form class="dialog" id="goal-form"><div class="dialog-header"><h2>Tu meta diaria</h2><button type="button" class="dialog-close" aria-label="Cerrar">×</button></div><p class="page-subtitle">Elige cuánto tiempo quieres dedicar a practicar cada día.</p><div class="form-field"><label for="goal-minutes">Minutos por día</label><input id="goal-minutes" name="minutes" type="number" min="5" max="180" step="5" value="${state.goalMinutes}" required /></div><div class="dialog-actions"><button type="button" class="secondary-button">Cancelar</button><button class="add-button" type="submit">Guardar objetivo</button></div></form>`;
  document.body.appendChild(backdrop);const close=()=>backdrop.remove();
  backdrop.addEventListener('click',event=>{if(event.target===backdrop||event.target.closest('.dialog-close')||event.target.closest('.secondary-button'))close()});
  $('#goal-form',backdrop).addEventListener('submit',event=>{event.preventDefault();const value=Number(new FormData(event.currentTarget).get('minutes'));if(!Number.isFinite(value)||value<5||value>180)return;state.goalMinutes=value;save();close();render();showToast('Meta diaria actualizada')});
  $('#goal-minutes',backdrop).focus();
}
function exportBackup() {
  const content=JSON.stringify({format:'hanzi-diario',version:1,exportedAt:new Date().toISOString(),data:state},null,2);
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`hanzi-diario-${todayKey()}.json`;link.click();URL.revokeObjectURL(url);
  showToast('Copia de seguridad descargada');
}
async function importBackup(event) {
  const file=event.target.files?.[0];if(!file)return;
  try {
    const backup=JSON.parse(await file.text());
    if(backup.format!=='hanzi-diario'||backup.version!==1||!Array.isArray(backup.data?.words)||!backup.data?.daily||typeof backup.data.daily!=='object') throw new Error('Ese archivo no parece una copia de Hanzi Diario.');
    if(!window.confirm('Restaurar esta copia reemplazará los datos guardados ahora en este navegador. ¿Quieres continuar?')) { event.target.value='';return; }
    state={...freshState(),...backup.data,tracing:{completed:Array.isArray(backup.data.tracing?.completed)?backup.data.tracing.completed:[],total:Number(backup.data.tracing?.total)||0}};save();render();showToast('Copia restaurada correctamente');
  } catch(error) { showToast(error instanceof SyntaxError?'No se pudo leer el archivo JSON.':error.message||'No se pudo restaurar la copia'); }
  event.target.value='';
}
function showToast(message,duration=2200) {
  const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),duration);
}
function updateThemeControl() {
  const dark=document.body.dataset.theme==='dark';
  const button=$('#theme-toggle');
  button.textContent=dark?'☀':'☾';
  button.setAttribute('aria-label',dark?'Activar modo claro':'Activar modo oscuro');
  button.title=dark?'Activar modo claro':'Activar modo oscuro';
  $('meta[name="theme-color"]').content=dark?'#17212a':'#f7f7f3';
}
function toggleTheme() {
  const next=document.body.dataset.theme==='dark'?'light':'dark';
  document.body.dataset.theme=next;
  localStorage.setItem('hanzi-diario-theme',next);
  updateThemeControl();
  if(traceWriter) {
    traceWriter.updateColor('strokeColor',next==='dark'?'#dce8ef':'#334d67');
    traceWriter.updateColor('outlineColor',next==='dark'?'#596b76':'#dfe4dd');
    traceWriter.updateColor('drawingColor',next==='dark'?'#e4a987':'#d68a70');
  }
}
function renderAccount() {
  const button=$('#google-signin');
  const label=$('#account-label');
  const avatar=$('#top-avatar');
  if(!button||!label||!avatar)return;
  const name=cloudUser?.displayName?.split(' ')[0]||cloudUser?.email?.split('@')[0]||'';
  button.disabled=cloudStatus==='loading';
  button.classList.toggle('connected',Boolean(cloudUser));
  label.textContent=cloudUser?`Salir · ${name}`:cloudStatus==='loading'?'Conectando con Firebase…':cloudStatus==='error'?'Firebase no disponible':cloudConfigured?'Entrar con Google':'Configurar Google';
  button.title=cloudUser?`Cerrar sesión de ${cloudUser.email||name}`:cloudStatus==='loading'?'Conectando con Firebase':cloudStatus==='error'?'Firebase no pudo inicializarse; revisa la conexión':cloudConfigured?'Iniciar sesión y sincronizar con Google':'Añade primero la configuración web de Firebase';
  avatar.textContent=cloudUser?name.slice(0,1).toLocaleUpperCase('es'):'你';
  avatar.title=cloudUser?.email||'Mi perfil';
}
async function handleGoogleClick() {
  if(cloudUser) {
    try { await window.hanziCloud?.signOut(); }
    catch { showToast('No se pudo cerrar la sesión. Inténtalo de nuevo.'); }
    return;
  }
  if(!cloudConfigured||!window.hanziCloud) {
    showToast(cloudStatus==='error'?'Firebase no pudo inicializarse. Revisa el error mostrado y vuelve a cargar la app.':'Para activar Google, configura firebase-config.js con tu app web de Firebase.');
    return;
  }
  try { await window.hanziCloud.signIn(); }
  catch(error) {
    console.error('Error al iniciar sesión con Google:', error);
    const messages={
      'auth/unauthorized-domain':`Firebase no autoriza ${location.hostname}. Añádelo en Authentication → Settings → Authorized domains.`,
      'auth/operation-not-allowed':'El acceso con Google está desactivado. Actívalo en Firebase → Authentication → Sign-in method.',
      'auth/invalid-api-key':'Firebase no acepta la apiKey. Copia de nuevo la configuración de la app web.',
      'auth/api-key-not-valid':'Firebase no acepta la apiKey. Revisa también sus restricciones en Google Cloud.',
      'auth/popup-blocked':'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta página.',
      'auth/popup-closed-by-user':'Se cerró la ventana de Google antes de terminar el acceso.',
      'auth/network-request-failed':'No se pudo conectar con Firebase. Comprueba la conexión e inténtalo de nuevo.'
    };
    showToast(messages[error?.code]||`Falló el acceso con Google${error?.code?` (${error.code})`:''}. Revisa Firebase Authentication.`);
  }
}
function showAddDialog() {
  const backdrop=document.createElement('div');backdrop.className='dialog-backdrop';backdrop.innerHTML=`<form class="dialog" id="add-word-form"><div class="dialog-header"><h2>Una palabra nueva</h2><button type="button" class="dialog-close" aria-label="Cerrar">×</button></div><div class="form-field"><label for="new-hanzi">Carácter o frase en chino *</label><input id="new-hanzi" name="hanzi" lang="zh" required maxlength="24" placeholder="朋友" /></div><div class="form-field"><label for="new-pinyin">Pinyin *</label><input id="new-pinyin" name="pinyin" required maxlength="50" placeholder="péng you" /></div><div class="form-field"><label for="new-meaning">Significado en español *</label><input id="new-meaning" name="meaning" required maxlength="80" placeholder="amigo / amiga" /></div><div class="form-field"><label for="new-category">Categoría</label><input id="new-category" name="category" maxlength="30" placeholder="Personas" /></div><div class="dialog-actions"><button type="button" class="secondary-button">Cancelar</button><button class="add-button" type="submit">Guardar palabra</button></div></form>`;
  document.body.appendChild(backdrop);
  const close=()=>backdrop.remove();backdrop.addEventListener('click',event=>{if(event.target===backdrop||event.target.closest('.dialog-close')||event.target.closest('.secondary-button'))close()});
  $('#add-word-form',backdrop).addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);const hanzi=String(data.get('hanzi')).trim();state.words.unshift({id:`custom-${Date.now()}`,hanzi,pinyin:String(data.get('pinyin')).trim(),meaning:String(data.get('meaning')).trim(),category:String(data.get('category')).trim()||'Personal',learned:false,type:[...hanzi].length>2?'frase':'carácter'});save();close();page='vocabulario';render();showToast('Palabra guardada en tu cuaderno')});
  $('#new-hanzi',backdrop).focus();
}

window.addEventListener('hanzi-cloud-ready',event=>{cloudConfigured=Boolean(event.detail?.configured);cloudStatus=event.detail?.error?'error':'ready';renderAccount()});
window.addEventListener('hanzi-auth-state',event=>{cloudUser=event.detail?.user||null;renderAccount();if(cloudUser)showToast(`Sesión iniciada: ${cloudUser.displayName||cloudUser.email}`)});
window.addEventListener('hanzi-cloud-owner',event=>{if(!event.detail?.uid)return;state.cloudUid=event.detail.uid;save()});
window.addEventListener('hanzi-cloud-data',event=>{const {progress,uid,reset}=event.detail||{};if(!uid)return;state=reset?freshState():{...freshState(),...progress,words:mergeHsk1Words(progress?.words||[]),daily:progress?.daily||{}};state.cloudUid=uid;save();render()});
window.addEventListener('hanzi-cloud-error',event=>showToast(event.detail?.message||'No se pudo sincronizar el progreso.',6500));
$('#theme-toggle').addEventListener('click',toggleTheme);
$('#google-signin').addEventListener('click',handleGoogleClick);
updateThemeControl();
renderAccount();
if('serviceWorker' in navigator&&location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('#install-button').hidden=false});
$('#install-button').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#install-button').hidden=true});
render();
