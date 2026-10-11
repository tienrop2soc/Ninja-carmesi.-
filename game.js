'use strict';
/* ===== Núcleo: constantes, utilidades, sonido, entrada, progreso ===== */
const TS = 32, VW = 960, VH = 544;
const GRAV = 1650, RUN = 205, JUMPV = 610, STEP = 1 / 60;
const PW = 22, PH = 34;
// Cámara: se acerca un 15 %. La vista es VWV x VHV unidades de mundo; VWV se ajusta a la proporción de la pantalla.
const ZOOM = 1.15, VHV = VH / ZOOM, CAMY = VH - VHV, ARENA_PX = 30 * TS;
let VWV = VW / ZOOM;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const $ = id => document.getElementById(id);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

let view = 'home';
let paused = false;

/* ---------- Sonido (WebAudio, sin ficheros) ---------- */
let actx = null, muted = false;
function initAudio() {
  try {
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
    if (actx && actx.state === 'suspended') actx.resume();
  } catch (e) { /* sin audio */ }
}
function tone(f, d, type, v, slide, delay) {
  if (!actx || muted) return;
  const t = actx.currentTime + (delay || 0);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(v || 0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + d + 0.03);
}
function noise(d, v) {
  if (!actx || muted) return;
  const n = Math.floor(actx.sampleRate * d);
  const b = actx.createBuffer(1, n, actx.sampleRate), a = b.getChannelData(0);
  for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = actx.createBufferSource(); s.buffer = b;
  const g = actx.createGain(); g.gain.value = v || 0.06;
  s.connect(g); g.connect(actx.destination); s.start();
}
const SFX = {
  throw: () => tone(900, 0.09, 'triangle', 0.045, -500),
  jump: () => tone(340, 0.14, 'square', 0.035, 260),
  hit: () => tone(190, 0.09, 'square', 0.05, -90),
  kill: () => { tone(260, 0.12, 'sawtooth', 0.05, -200); noise(0.12, 0.04); },
  shot: () => { noise(0.16, 0.05); tone(120, 0.14, 'sawtooth', 0.04, -60); },
  pistol: () => { noise(0.09, 0.07); tone(520, 0.08, 'square', 0.045, -380); },
  slash: () => { noise(0.1, 0.05); tone(700, 0.1, 'sawtooth', 0.035, -500); },
  crate: () => { noise(0.1, 0.06); tone(300, 0.1, 'square', 0.045, 200); },
  pickup: () => { tone(520, 0.08, 'square', 0.045); tone(780, 0.08, 'square', 0.045, 0, 0.08); tone(1040, 0.12, 'square', 0.045, 0, 0.16); },
  hurt: () => tone(230, 0.25, 'sawtooth', 0.07, -150),
  boom: () => { noise(0.5, 0.12); tone(85, 0.4, 'sawtooth', 0.07, -40); },
  flag: () => { tone(660, 0.1, 'triangle', 0.055); tone(990, 0.18, 'triangle', 0.055, 0, 0.1); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.055, 0, i * 0.13)),
  lose: () => [330, 262, 196].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.05, 0, i * 0.2))
};
function sfx(n) { try { if (SFX[n]) SFX[n](); } catch (e) { /* ignorar */ } }

/* ---------- Entrada ---------- */
const keys = Object.create(null);
const touch = { left: false, right: false, jump: false, attack: false };
let jumpPressed = false, attackPressed = false;
const K_LEFT = ['ArrowLeft', 'KeyA'], K_RIGHT = ['ArrowRight', 'KeyD'];
const K_JUMP = ['ArrowUp', 'KeyW', 'Space'], K_ATK = ['KeyX', 'KeyJ', 'KeyK', 'KeyZ'], K_DOWN = ['ArrowDown', 'KeyS'];
const anyKey = l => l.some(k => keys[k]);
const inp = {
  get left() { return anyKey(K_LEFT) || touch.left; },
  get right() { return anyKey(K_RIGHT) || touch.right; },
  get jump() { return anyKey(K_JUMP) || touch.jump; },
  get attack() { return anyKey(K_ATK) || touch.attack; },
  get down() { return anyKey(K_DOWN); }
};
const GAME_KEYS = new Set([].concat(K_LEFT, K_RIGHT, K_JUMP, K_ATK, K_DOWN, ['Escape', 'KeyP']));
window.addEventListener('keydown', e => {
  initAudio();
  if (view === 'play' && GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (K_JUMP.indexOf(e.code) >= 0) jumpPressed = true;
  if (K_ATK.indexOf(e.code) >= 0) attackPressed = true;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (view === 'play') setPause(!paused); }
  if (e.code === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) onEnterKey();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
function releaseAll() { for (const k in keys) keys[k] = false; touch.left = touch.right = touch.jump = touch.attack = false; }
window.addEventListener('blur', () => { releaseAll(); if (view === 'play') setPause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && view === 'play') setPause(true); });

function bindTouch() {
  document.querySelectorAll('#touch [data-k]').forEach(b => {
    const k = b.dataset.k;
    const on = e => {
      e.preventDefault(); initAudio(); touch[k] = true;
      if (k === 'jump') jumpPressed = true;
      if (k === 'attack') attackPressed = true;
      b.classList.add('on');
    };
    const off = e => { e.preventDefault(); touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  });
  window.addEventListener('touchstart', () => document.body.classList.add('has-touch'), { once: true, passive: true });
}

/* ---------- Progreso (localStorage, opcional) ---------- */
const SAVE_KEY = 'sombra-carmesi-v1';
let save = { cleared: 0, best: {} };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (s && typeof s === 'object') {
    save.cleared = clamp(parseInt(s.cleared, 10) || 0, 0, 20);
    save.best = (s.best && typeof s.best === 'object') ? s.best : {};
  }
} catch (e) { /* sin almacenamiento */ }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignorar */ } }
const unlockedMax = () => Math.min(20, save.cleared + 1);

/* ---------- Vistas ---------- */
const VIEWS = ['home', 'levels', 'intro', 'play', 'result', 'over'];
function show(v) {
  view = v;
  VIEWS.forEach(n => { $('v-' + n).hidden = (n !== v); });
  try { window.scrollTo(0, 0); } catch (e) { /* ignorar */ }
}
/* ===== Escenarios, jefes y generador de niveles ===== */
// [nombre, historia, jefe, cieloArriba, cieloAbajo, lejos, medio, sueloSup, sueloRelleno, plataforma, platSup, decorado, foso, efecto, astro, colorAstro, uniforme, ribete, estiloSuelo, colorFoso]
const TH_RAW = [
  ['Aldea en llamas', 'Tu aldea arde. Los soldados del General Tetsu se llevaron a Sakura hacia el norte. Sigue su rastro.', 'Cabo Ceniza', '#24112b', '#d9582f', '#4a1f33', '#2b1426', '#8a5a33', '#44302a', '#8b5e3c', '#b57a4a', 'houses', 'spikes', 'embers', 'sun', '#ffb347', '#4d5f94', '#e9b949', 'dirt', ''],
  ['Bosque de bambú', 'Huellas de botas entre el bambú. Los soldados tienen prisa: el rastro sigue hacia el río.', 'Sargento Pólvora', '#16304a', '#8cc9a3', '#2d6a5a', '#1f4d42', '#6fbf5a', '#4a3a2b', '#8a6a3f', '#b08a52', 'bamboo', 'spikes', 'leaves', 'sun', '#fff1b0', '#9a4d4d', '#e9b949', 'grass', ''],
  ['Río brumoso', 'Un puesto vigila los vados del río. Cruza sin mojarte, o no cruzarás.', 'Alférez Remo', '#1d2f4d', '#9fb9c9', '#4b6b86', '#35546d', '#78b08a', '#4c4a44', '#7b6a50', '#a38c68', 'pine', 'water', 'fog', 'moon', '#eef3f8', '#4a7a5a', '#f1e7b8', 'grass', '#3d82b8'],
  ['Puerto de Umi', 'Un barco imperial zarpa al amanecer. Sakura podría estar a bordo.', 'Capitán Ancla', '#10294a', '#f0a56a', '#2e4b6e', '#1d3350', '#b59a72', '#5a4a3a', '#9b7345', '#c49a5e', 'mast', 'water', 'none', 'sun', '#ffd18a', '#355c91', '#ffffff', 'plank', '#2f6fa8'],
  ['Templo abandonado', 'Un monje herido te habla de un convoy que sube hacia las montañas.', 'Teniente Incienso', '#2b1d3d', '#c9806a', '#5a3a52', '#3a2540', '#8d8a6a', '#4b4660', '#7d7385', '#a79fb0', 'tower', 'void', 'leaves', 'moon', '#f2e6d2', '#6b4a8a', '#e9b949', 'stone', ''],
  ['Sendero nevado', 'La nieve borra las huellas, pero no el humo de sus campamentos.', 'Sargento Ventisca', '#223a5c', '#bcd4e6', '#7d9bb8', '#5b7b99', '#f2f8ff', '#7f8fa6', '#8fa6bf', '#ffffff', 'pine', 'water', 'snow', 'sun', '#fff6d6', '#8a3b3b', '#f4f4f4', 'snow', '#5fa3cf'],
  ['Paso helado', 'El ejército ha fortificado el paso. Tetsu sabe que vas tras él.', 'Capitán Escarcha', '#15233f', '#8fb0d6', '#587aa3', '#3d5a80', '#e6f1fb', '#6b7d99', '#7d92ad', '#eef6ff', 'spire', 'void', 'snow', 'moon', '#eaf2ff', '#3f6b73', '#e9b949', 'snow', ''],
  ['Desfiladero del viento', 'Tiradores apostados entre las rocas. Aquí cada bala cuenta.', 'Mayor Roca', '#3a2a3f', '#e0a070', '#7a4a48', '#573636', '#c28a56', '#7a4f3a', '#9a6b45', '#c8935e', 'spire', 'void', 'dust', 'sun', '#ffd9a0', '#566a8a', '#e9b949', 'sand', ''],
  ['Desierto rojo', 'El convoy cruzó el desierto. Entre la arena encuentras un pañuelo de Sakura.', 'Teniente Duna', '#552a2a', '#f2b36b', '#a8553f', '#7e3d30', '#e0a860', '#a5633f', '#b8794a', '#e0a068', 'cactus', 'spikes', 'dust', 'sun', '#fff0b8', '#3d5a8c', '#f2d27a', 'sand', ''],
  ['Oasis fortificado', 'El ejército usa el oasis como cuartel. Hay que liberarlo.', 'Capitán Oasis', '#143a4a', '#f1c27a', '#3f8f7a', '#2b6b5e', '#7fcf6a', '#8a6a43', '#a77f4c', '#d3a566', 'palm', 'water', 'none', 'sun', '#ffe2a0', '#7a3b4a', '#f2d27a', 'grass', '#2f8fa8'],
  ['Mina de hierro', 'De aquí salen las armas de Tetsu. Si cae la mina, caen sus cañones.', 'Mayor Yunque', '#16151f', '#3a3548', '#2a2838', '#201e2c', '#8a8498', '#3e3b4c', '#6a6478', '#9a94aa', 'tower', 'void', 'dust', 'none', '#ffffff', '#8a6a3a', '#d9d9d9', 'stone', ''],
  ['Cavernas de cristal', 'Oyes pasos lejanos entre los cristales. Sakura sigue con vida.', 'Coronel Cristal', '#0f1630', '#2b3d7a', '#26407a', '#1b2f63', '#8fb6ff', '#2f3b6b', '#4a5fa0', '#9fc0ff', 'crystal', 'void', 'stars', 'none', '#ffffff', '#8a5fb8', '#bfe3ff', 'stone', ''],
  ['Pantano sombrío', 'La niebla esconde arcabuceros. Camina con cuidado y salta con más cuidado.', 'Capitán Niebla', '#10201c', '#4a6a52', '#2a4a3c', '#1c3a2e', '#6a8f3f', '#3a3a28', '#6b5a3a', '#8c7a52', 'dead', 'water', 'fog', 'moon', '#d8e8c0', '#a0522d', '#e9d9a0', 'grass', '#2f6d5a'],
  ['Bosque maldito', 'Los árboles secos guardan a los hombres de Tetsu. Ya estás cerca.', 'Mayor Raíz', '#120d1f', '#4a2a4f', '#2e1b3a', '#1f1229', '#6a4a8a', '#2d2236', '#4d3a5e', '#7b5f96', 'dead', 'spikes', 'leaves', 'moon', '#e8dcff', '#a04a6a', '#e9b949', 'grass', ''],
  ['Cañón del volcán', 'El camino a la fortaleza cruza el volcán. No hay otra ruta.', 'Coronel Magma', '#2a0f14', '#d05a2a', '#6a2420', '#471814', '#8a6a50', '#4a2c28', '#7a4a3a', '#a8704f', 'spire', 'lava', 'embers', 'sun', '#ff9a4a', '#3f6a8a', '#ffd27a', 'ash', ''],
  ['Forja infernal', 'Aquí funden los cañones del General. Que no salga ninguno más.', 'Coronel Fragua', '#1a0a0c', '#8a2a18', '#4a1a14', '#2c0f0c', '#9a8a82', '#3a2a2a', '#6a5a58', '#9a8a86', 'tower', 'lava', 'embers', 'none', '#ffffff', '#4a6f9a', '#ffcf70', 'stone', ''],
  ['Muralla imperial', 'La gran muralla. Cada torre es un puesto que debes liberar.', 'Comandante Muralla', '#1f2f55', '#d9a07a', '#5a6a8a', '#3a4766', '#b9b3a6', '#6b6a73', '#8d8a94', '#c0bdc6', 'tower', 'void', 'none', 'sun', '#ffe0b0', '#a63d3d', '#ffd27a', 'stone', ''],
  ['Ciudad imperial', 'Las calles nocturnas están llenas de soldados. Tetsu te espera arriba.', 'Comandante Farol', '#080a1a', '#2a2f5a', '#1f2548', '#151a38', '#8d8aa8', '#2c2e4a', '#51557a', '#8186b0', 'houses', 'water', 'stars', 'moon', '#f4f1e0', '#b3424a', '#ffd27a', 'stone', '#27407a'],
  ['Tejados del palacio', 'Saltas de tejado en tejado. Ya ves la torre donde retienen a Sakura.', 'Brigadier Teja', '#0b0f24', '#5a3a6a', '#2a2350', '#1c1840', '#6d7fa8', '#3a3f66', '#5a4a3a', '#8a6a4a', 'tower', 'void', 'stars', 'moon', '#f4eee0', '#c2503f', '#ffd27a', 'tile', ''],
  ['Fortaleza del General', 'Última batalla: Tetsu o tú. Sakura te espera al otro lado.', 'General Tetsu', '#120808', '#7a1f2a', '#3a1418', '#240b0f', '#a89a8a', '#3c2c32', '#6a5a60', '#9a8a90', 'tower', 'lava', 'embers', 'moon', '#ffb0a0', '#35353f', '#e9b949', 'stone', '']
];
const THEMES = TH_RAW.map(a => ({
  name: a[0], story: a[1], boss: a[2], skyTop: a[3], skyBot: a[4], far: a[5], mid: a[6],
  gTop: a[7], gFill: a[8], gDark: 'rgba(0,0,0,.22)', plat: a[9], platTop: a[10], decor: a[11], pit: a[12],
  fx: a[13], orb: a[14], orbCol: a[15], army: a[16], trim: a[17], ground: a[18], pitCol: a[19]
}));

const outpostCount = n => 3 + Math.floor(n / 8);

function genLevel(n) {
  const d = (n - 1) / 19, rng = mulberry32(n * 104729 + 7);
  const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const th = THEMES[n - 1];
  const START = 10, ARENA = 30, C = 165 + 2 * n, W = START + C + ARENA;
  const gh = new Array(W).fill(13);
  const plats = [], crates = [], spawns = [], outposts = [];
  let h = 13;
  const addPlat = (tx, row, len) => plats.push({ px: tx * TS, py: row * TS, pw: len * TS });
  const pick = roam => {
    const w = [['rifle', 4], ['patrol', roam ? 3 : 1.4]];
    if (n >= 4) w.push(['blunder', 1 + d * 3]);
    if (n >= 8) w.push(['cannon', d * 3.2]);
    let t = w.reduce((s, a) => s + a[1], 0) * rng();
    for (const a of w) { t -= a[1]; if (t <= 0) return a[0]; }
    return 'rifle';
  };
  const spawn = (type, tx, y, b, op) => spawns.push({ type, x: tx * TS + TS / 2, y, b, op });
  const flatFill = (a, len) => { for (let t = 0; t < len; t++) gh[a + t] = h; };

  const K = outpostCount(n), OW = 18 + Math.floor(d * 4);
  const oStart = [];
  for (let i = 0; i < K; i++) oStart.push(START + Math.floor(C * (i + 1) / (K + 1)) - Math.floor(OW / 2));
  const end = START + C;
  let x = START, oi = 0;

  while (x < end) {
    if (oi < K && x >= oStart[oi]) {
      const i = oi++;
      flatFill(x, OW);
      const cx = x + Math.floor(OW / 2);
      const op = { x: x * TS, w: OW * TS, flagX: cx * TS + TS / 2, flagY: h * TS, total: 0, left: 0, done: false };
      const cnt = 2 + Math.floor(d * 4.2) + (i % 2);
      const used = [cx];
      let onPlat = 0;
      if (n >= 2) {
        const pl = n >= 9 ? 2 : 1;
        for (let p = 0; p < pl; p++) {
          const ptx = x + 2 + p * Math.floor(OW / 2) + R(0, 2);
          addPlat(ptx, h - 3, 4);
          let t = pick(false); if (t === 'patrol') t = 'rifle';
          spawn(t, ptx + 2, (h - 3) * TS, null, i); onPlat++;
        }
      }
      let guard = 0;
      for (let k = 0; k < Math.max(1, cnt - onPlat) && guard < 80; guard++) {
        const tile = x + 2 + R(0, OW - 5);
        if (used.some(u => Math.abs(u - tile) < 2)) continue;
        used.push(tile);
        const t = pick(false);
        spawn(t, tile, h * TS, t === 'patrol' ? [(x + 1) * TS, (x + OW - 2) * TS] : null, i);
        k++;
      }
      op.total = spawns.filter(s => s.op === i).length; op.left = op.total;
      outposts.push(op);
      x += OW;
      continue;
    }
    const room = (oi < K ? oStart[oi] : end) - x;
    if (room < 7) { flatFill(x, room); x += room; continue; }
    const r = rng();
    const pPit = 0.16 + 0.16 * d, pStone = pPit + 0.08 + 0.08 * d, pRise = pStone + 0.2;
    if (r < pPit && room >= 11) {
      const w = Math.min(4, 2 + R(0, 1) + (d > 0.5 && rng() < 0.6 ? 1 : 0));
      for (let t = 0; t < w; t++) gh[x + t] = 99;
      x += w; flatFill(x, 4); x += 4;
    } else if (r < pStone && room >= 15) {
      const w = [6, 7, 9][R(0, d > 0.4 ? 2 : 1)];
      for (let t = 0; t < w; t++) gh[x + t] = 99;
      let o = 1, first = true;
      while (o + 3 <= w) {
        addPlat(x + o, h - 2, 3);
        if (!first && rng() < 0.15 + 0.5 * d) spawn('rifle', x + o + 1, (h - 2) * TS, null, -1);
        first = false; o += 5;
      }
      x += w; flatFill(x, 4); x += 4;
    } else if (r < pRise && room >= 10) {
      const dh = (rng() < 0.5 ? -1 : 1) * R(1, 2);
      h = clamp(h + dh, 10, 14);
      const len = Math.min(R(5, 8), room - 1);
      flatFill(x, len);
      if (len >= 6 && rng() < 0.3 + 0.4 * d) {
        const t = pick(true);
        spawn(t, x + R(2, len - 3), h * TS, t === 'patrol' ? [(x + 1) * TS, (x + len - 2) * TS] : null, -1);
      }
      x += len;
    } else {
      const len = Math.min(R(6, 10), room - 1);
      flatFill(x, len);
      if (n >= 2 && rng() < 0.28 + 0.12 * d) addPlat(x + R(1, Math.max(1, len - 5)), h - (rng() < 0.5 ? 3 : 2), R(3, 5));
      const ne = rng() < 0.3 + 0.4 * d ? (rng() < 0.25 * d ? 2 : 1) : 0;
      for (let e = 0; e < ne; e++) {
        const t = pick(true);
        spawn(t, x + R(2, len - 3), h * TS, t === 'patrol' ? [(x + 1) * TS, (x + len - 2) * TS] : null, -1);
      }
      x += len;
    }
  }
  // Arena del jefe: suelo plano y dos plataformas
  for (let t = 0; t < ARENA; t++) gh[end + t] = 13;
  addPlat(end + 7, 10, 4); addPlat(end + 19, 10, 4);
  // Cajas de arma: una cada ~28 casillas del recorrido (siempre sobre suelo firme) y otra justo antes del jefe
  const solidSpot = t => gh[t - 1] < 99 && gh[t] < 99 && gh[t + 1] < 99;
  const putCrate = t => crates.push({ x: t * TS + TS / 2, y: gh[t] * TS });
  for (let pos = START + 20; pos < end - 14; pos += 28) {
    let t = pos + R(-3, 3);
    while (!solidSpot(t) && t < end - 10) t++;
    if (solidSpot(t)) putCrate(t);
  }
  let ct = end - 5; while (!solidSpot(ct)) ct--;
  putCrate(ct);
  // Decorado de fondo (capa media)
  const deco = [], span = W * TS * 0.5 + VW + 400;
  for (let px = 0; px < span; px += R(80, 190)) deco.push({ x: px, s: 0.7 + rng() * 0.8, v: R(0, 3) });
  const stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: rng() * VW, y: rng() * 260, r: 0.6 + rng() * 1.4, p: rng() * 6 });
  const fxp = [];
  for (let i = 0; i < 60; i++) fxp.push({ x: rng() * VW, y: rng() * VH, vx: -20 - rng() * 30, vy: 20 + rng() * 40, s: 1 + rng() * 2.5, par: 0.3 + rng() * 0.7 });
  return {
    n, d, th, W, gh, plats, crates, spawns, outposts, deco, stars, fxp,
    arenaTile: end, arenaX: end * TS, worldW: W * TS, boss: th.boss, totalSoldiers: spawns.length
  };
}
/* ===== Lógica: física, jugador, soldados, armas, cajas, jefe ===== */
let L = null, G = null;
const rnd = (a, b) => a + Math.random() * (b - a);
const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function solidAt(tx, ty) {
  if (tx < 0 || tx >= L.W) return true;
  if (G && G.arena.locked && tx < L.arenaTile) return true;
  return ty >= L.gh[tx];
}
function moveBody(b, dt) {
  b.hitX = false;
  b.x += b.vx * dt;
  const y0 = Math.floor(b.y / TS), y1 = Math.floor((b.y + b.h - 0.01) / TS);
  if (b.vx > 0) {
    const tx = Math.floor((b.x + b.w) / TS);
    for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { b.x = tx * TS - b.w - 0.001; b.hitX = true; break; }
  } else if (b.vx < 0) {
    const tx = Math.floor(b.x / TS);
    for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { b.x = (tx + 1) * TS + 0.001; b.hitX = true; break; }
  }
  const pb = b.y + b.h;
  b.y += b.vy * dt;
  b.onGround = false;
  const x0 = Math.floor((b.x + 0.01) / TS), x1 = Math.floor((b.x + b.w - 0.01) / TS);
  if (b.vy >= 0) {
    const ty = Math.floor((b.y + b.h) / TS);
    for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { b.y = ty * TS - b.h; b.vy = 0; b.onGround = true; break; }
    if (!b.onGround && !(b.dropT > 0)) {
      for (const p of L.plats) {
        if (b.x + b.w > p.px && b.x < p.px + p.pw && pb <= p.py + 1 && b.y + b.h >= p.py) { b.y = p.py - b.h; b.vy = 0; b.onGround = true; break; }
      }
    }
  } else {
    const ty = Math.floor(b.y / TS);
    for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { b.y = (ty + 1) * TS; b.vy = 0; break; }
  }
}

/* ---------- Efectos ---------- */
function burst(x, y, n, cols, spd, life, g, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = rnd(0.2, 1) * spd;
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.3, g: g == null ? 600 : g, life: rnd(0.5, 1) * life, max: life, c: cols[(Math.random() * cols.length) | 0], s: size || 3 });
  }
}
const dust = (x, y, n) => burst(x, y, n, ['#d8d0b8', '#a89f88'], 90, 0.4, 120, 3);
function floatText(x, y, txt, c) { G.texts.push({ x, y, t: 0, txt, c: c || '#fff' }); }
function toast(txt) { G.toast = { txt, t: 0 }; }

/* ---------- Partida ---------- */
function newPlayer() {
  return { x: 3 * TS, y: 13 * TS - PH, w: PW, h: PH, vx: 0, vy: 0, face: 1, onGround: false, coyote: 0, jbuf: 0, abuf: 0, hp: 5, maxhp: 5, inv: 0, wpn: 'shuriken', ammo: 0, cd: 0, slash: 0, throwT: 0, kb: 0, kbT: 0, dead: false, deadT: 0, dropT: 0, safe: { x: 3 * TS, y: 13 * TS - PH }, pb: 0, splash: false, muzzle: 0 };
}
function newGame(n) {
  L = genLevel(n);
  G = { n, t: 0, time: 0, cam: { x: 0, shake: 0 }, P: newPlayer(), enemies: [], bullets: [], crates: [], pickups: [], parts: [], texts: [], killed: 0, flags: 0, state: 'play', stateT: 0, done: false, arena: { locked: false, t: 0 }, boss: null, fade: 1, toast: null, banner: null, slashId: 0, wFlash: 0, flash: 0 };
  for (const s of L.spawns) G.enemies.push(mkEnemy(s));
  for (const c of L.crates) G.crates.push({ x: c.x - 14, y: c.y - 28, w: 28, h: 28, open: false, t: Math.random() * 6 });
  toast('Nivel ' + n + ' · ' + L.th.name);
  jumpPressed = false; attackPressed = false;
}

/* ---------- Soldados ---------- */
const ETYPES = {
  rifle: { hp: 1, fire: 1, bs: 1, cnt: 1, spread: 0, spd: 0 },
  patrol: { hp: 1, fire: 1.15, bs: 1, cnt: 1, spread: 0, spd: 52 },
  blunder: { hp: 2, fire: 1.5, bs: 0.85, cnt: 3, spread: 0.2, spd: 0 },
  cannon: { hp: 3, fire: 2.0, bs: 0.72, cnt: 1, spread: 0, spd: 0, big: true }
};
function mkEnemy(s) {
  const T = ETYPES[s.type], d = L.d;
  const hp = T.hp + (s.type === 'cannon' ? Math.floor(d * 1.5) : Math.floor(d * 2.2));
  const fi = lerp(2.8, 1.35, d) * T.fire;
  return { type: s.type, x: s.x - PW / 2, y: s.y - PH, w: PW, h: PH, vx: 0, vy: 0, face: -1, hp, maxhp: hp, fi, fireT: rnd(0.6, 1.8) * fi * 0.6 + 0.4, aim: 0, anim: Math.random() * 6, b: s.b, dir: Math.random() < 0.5 ? -1 : 1, op: s.op, hit: 0, alive: true, onGround: true, sid: 0, extra: false, elev: Math.abs((L.gh[Math.floor(s.x / TS)] || 13) * TS - s.y) > 1 && s.y > 0 };
}
function opDown(i) {
  const op = L.outposts[i];
  if (!op || op.done) return;
  op.left--;
  if (op.left <= 0) {
    op.done = true; G.flags++;
    toast('¡Puesto liberado! ' + G.flags + '/' + L.outposts.length);
    sfx('flag');
    burst(op.flagX, op.flagY - 90, 26, ['#efe9da', '#e23a4e', '#e9b949'], 260, 1.1, 300, 4);
  }
}
function updEnemy(e, dt) {
  const P = G.P, T = ETYPES[e.type];
  e.anim += dt; if (e.hit > 0) e.hit -= dt;
  const cx = e.x + e.w / 2;
  if (Math.abs(cx - (G.cam.x + VWV / 2)) > VWV * 0.62) return;
  const dx = (P.x + P.w / 2) - cx, ady = Math.abs((P.y + P.h / 2) - (e.y + e.h / 2));
  const see = Math.abs(dx) < (e.type === 'blunder' ? 380 : 480) && ady < 190 && !P.dead && G.state === 'play';
  e.vx = 0;
  if (T.spd && e.aim <= 0) {
    e.vx = e.dir * T.spd * (1 + L.d * 0.5);
    const ax = cx + e.dir * 16, tx = Math.floor(ax / TS), foot = Math.round((e.y + e.h) / TS);
    if (e.b && (ax < e.b[0] || ax > e.b[1])) e.dir = -e.dir;
    else if (tx < 0 || tx >= L.W || L.gh[tx] !== foot) e.dir = -e.dir;
    else if (e.hitX) e.dir = -e.dir;
  }
  e.vy = Math.min(e.vy + GRAV * dt, 900);
  moveBody(e, dt);
  if (e.y > VH + 80) { e.alive = false; if (!e.extra) G.killed++; if (e.op >= 0) opDown(e.op); return; }
  if (see) {
    e.fireT -= dt;
    if (e.fireT <= 0 && e.aim <= 0) { e.aim = 0.45; e.fireT = e.fi * rnd(0.85, 1.2); }
  }
  if (e.aim > 0) {
    e.face = dx > 0 ? 1 : -1; e.vx = 0; e.aim -= dt;
    if (e.aim <= 0) enemyFire(e);
  } else if (T.spd && e.vx !== 0) e.face = e.dir;
  else if (see) e.face = dx > 0 ? 1 : -1;
}
function enemyFire(e) {
  const T = ETYPES[e.type], d = L.d, P = G.P;
  const sp = lerp(185, 320, d) * T.bs;
  const mx = e.x + e.w / 2 + e.face * (T.big ? 30 : 24), my = e.y + (T.big ? 14 : 16);
  let ang = e.face > 0 ? 0 : Math.PI;
  if (e.elev || (e.type === 'rifle' && L.n >= 10)) {
    const lim = e.elev ? 0.7 : 0.28;
    const a = clamp(Math.atan2((P.y + P.h / 2) - my, Math.abs(P.x - e.x) + 1), -lim, lim);
    ang = e.face > 0 ? a : Math.PI - a;
  }
  for (let i = 0; i < T.cnt; i++) {
    const a = ang + (i - (T.cnt - 1) / 2) * T.spread;
    G.bullets.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: T.big ? 7 : 4, dmg: 1, own: 'e', kind: T.big ? 'cball' : 'ball', life: 3, rot: 0 });
  }
  burst(mx, my, 7, ['#d8d8d8', '#9a9a9a', '#ffcf70'], 90, 0.5, -20, 3);
  sfx('shot');
}
function hitEnemy(e, dmg) {
  if (!e.alive) return;
  e.hp -= dmg; e.hit = 0.12; sfx('hit');
  burst(e.x + e.w / 2, e.y + 14, 5, ['#e23a4e', '#fff'], 160, 0.35, 500, 2);
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.alive = false; if (!e.extra) G.killed++;
  sfx('kill');
  const th = L.th, cx = e.x + e.w / 2, cy = e.y + 18;
  burst(cx, cy, 16, [th.army, th.trim, '#2a2a33', '#d8d8d8'], 280, 0.9, 700, 4);
  if (Math.random() < 0.13) G.pickups.push({ x: cx - 8, y: e.y + 18, w: 16, h: 14, vx: 0, vy: -200, t: 0 });
  if (e.op >= 0) opDown(e.op);
}

/* ---------- Jugador ---------- */
function updPlayer(dt) {
  const P = G.P;
  if (P.dead) { P.deadT += dt; P.vy = Math.min(P.vy + GRAV * dt, 900); P.y += P.vy * dt; return; }
  const ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  if (P.kbT > 0) { P.kbT -= dt; P.vx = P.kb * 170; }
  else {
    P.vx += (ax * RUN - P.vx) * Math.min(1, dt * 22);
    if (!ax && Math.abs(P.vx) < 8) P.vx = 0;
    if (ax) P.face = ax;
  }
  if (P.inv > 0) P.inv -= dt;
  if (P.onGround) P.coyote = 0.09; else P.coyote -= dt;
  if (jumpPressed) { P.jbuf = 0.11; jumpPressed = false; } else P.jbuf -= dt;
  if (inp.down && P.onGround) P.dropT = 0.2;
  if (P.jbuf > 0 && P.coyote > 0 && !(P.dropT > 0)) {
    P.vy = -JUMPV; P.coyote = 0; P.jbuf = 0; P.onGround = false; sfx('jump'); dust(P.x + P.w / 2, P.y + P.h, 4);
  }
  if (!inp.jump && P.vy < -260) P.vy = -260;
  P.vy = Math.min(P.vy + GRAV * dt, 900);
  P.pb = P.y + P.h;
  const was = P.onGround;
  moveBody(P, dt);
  if (P.dropT > 0) P.dropT -= dt;
  if (!was && P.onGround) dust(P.x + P.w / 2, P.y + P.h, 5);
  if (P.onGround && P.kbT <= 0) {
    const tx = Math.floor((P.x + P.w / 2) / TS);
    if (tx >= 1 && tx < L.W - 1 && L.gh[tx - 1] < 99 && L.gh[tx] < 99 && L.gh[tx + 1] < 99) { P.safe.x = P.x; P.safe.y = P.y; }
  }
  if (P.y > VH - 34 && !P.splash) {
    P.splash = true;
    const pc = L.th.pit === 'lava' ? ['#ff9a3a', '#ffd27a'] : L.th.pit === 'water' ? ['#9fd4ff', '#fff'] : ['#8a8aa0', '#444'];
    burst(P.x + P.w / 2, VH - 40, 14, pc, 200, 0.8, 500, 3);
  }
  if (P.y > VH + 30) fallDamage();
  // armas
  if (attackPressed) { P.abuf = 0.12; attackPressed = false; } else P.abuf -= dt;
  P.cd -= dt;
  if (P.throwT > 0) P.throwT -= dt;
  if (P.muzzle > 0) P.muzzle -= dt;
  if (P.slash > 0) { P.slash -= dt; slashHits(); if (P.slash <= 0 && P.ammo <= 0) revertWeapon('La katana se ha gastado'); }
  if ((inp.attack || P.abuf > 0) && P.cd <= 0 && P.slash <= 0) doAttack();
  // arena
}
function revertWeapon(msg) { const P = G.P; P.wpn = 'shuriken'; P.ammo = 0; toast(msg || 'Sin munición: vuelves a los shurikens'); }
function doAttack() {
  const P = G.P, cx = P.x + P.w / 2;
  if (P.wpn === 'shuriken') {
    if (G.bullets.filter(b => b.own === 'p' && b.kind === 'shuriken').length >= 3) return;
    G.bullets.push({ x: cx + P.face * 14, y: P.y + 15, vx: P.face * 560, vy: 0, r: 7, dmg: 1, own: 'p', kind: 'shuriken', life: 0.75, rot: 0 });
    P.cd = 0.26; P.throwT = 0.14; sfx('throw');
  } else if (P.wpn === 'pistol') {
    G.bullets.push({ x: cx + P.face * 26, y: P.y + 15, vx: P.face * 840, vy: 0, r: 3, dmg: 2, own: 'p', kind: 'pistol', life: 0.85, rot: 0 });
    P.cd = 0.22; P.muzzle = 0.08; P.ammo--; sfx('pistol');
    burst(cx + P.face * 30, P.y + 15, 5, ['#ffcf70', '#fff'], 120, 0.2, 0, 2);
    if (P.ammo <= 0) revertWeapon('Sin balas: vuelves a los shurikens');
  } else {
    P.slash = 0.2; G.slashId++; P.cd = 0.3; P.ammo--; sfx('slash');
  }
}
function slashRect() { const P = G.P; return { x: P.face > 0 ? P.x + P.w - 4 : P.x - 44, y: P.y - 4, w: 48, h: P.h + 8 }; }
function slashHits() {
  const r = slashRect();
  for (const e of G.enemies) if (e.alive && e.sid !== G.slashId && ov(r, e)) { e.sid = G.slashId; hitEnemy(e, 3); }
  const b = G.boss;
  if (b && b.alive && b.sid !== G.slashId && ov(r, b)) { b.sid = G.slashId; hitBoss(3); }
  for (const bl of G.bullets) {
    if (bl.own === 'e' && ov(r, { x: bl.x - bl.r, y: bl.y - bl.r, w: bl.r * 2, h: bl.r * 2 })) { bl.life = 0; burst(bl.x, bl.y, 6, ['#fff', '#cfd8e3'], 150, 0.3, 0, 2); }
  }
  for (const c of G.crates) if (!c.open && ov(r, c)) openCrate(c);
}
function hurtP(dmg, fromX) {
  const P = G.P;
  if (P.inv > 0 || P.dead || G.state === 'clear') return;
  P.hp -= dmg; P.inv = 1.5; P.vy = -250; P.kb = (P.x + P.w / 2 < fromX) ? -1 : 1; P.kbT = 0.16;
  sfx('hurt'); G.cam.shake = 0.25;
  burst(P.x + P.w / 2, P.y + 14, 10, ['#e23a4e', '#fff'], 220, 0.5, 500, 3);
  if (P.hp <= 0) { P.hp = 0; die(); }
}
function fallDamage() {
  const P = G.P;
  P.splash = false; P.hp -= 1; sfx('hurt'); G.cam.shake = 0.3;
  if (P.hp <= 0) { P.hp = 0; P.y = VH - 60; die(); return; }
  P.x = P.safe.x; P.y = P.safe.y; P.vx = 0; P.vy = 0; P.inv = 2; P.kbT = 0;
  toast('Caíste al vacío (−1 vida)');
}
function die() {
  const P = G.P;
  P.dead = true; P.vy = -420; P.deadT = 0; G.state = 'dead'; G.stateT = 0; sfx('lose');
  burst(P.x + P.w / 2, P.y + 16, 24, ['#e23a4e', '#14161f', '#efe9da'], 260, 1, 500, 4);
}
function openCrate(c) {
  c.open = true; sfx('crate');
  burst(c.x + 14, c.y + 14, 14, ['#8a5a2f', '#b57a3f', '#e9b949'], 220, 0.7, 600, 3);
  const P = G.P, k = Math.random() < 0.5 ? 'katana' : 'pistol';
  P.wpn = k; P.ammo = k === 'katana' ? 18 : 14; P.slash = 0; G.wFlash = 1.4;
  floatText(c.x + 14, c.y - 6, k === 'katana' ? '¡KATANA!' : '¡PISTOLA!', '#e9b949');
  sfx('pickup');
}
function playerContacts() {
  const P = G.P;
  if (P.dead) return;
  for (const e of G.enemies) {
    if (!e.alive || !ov(P, e)) continue;
    if (P.vy > 80 && P.pb <= e.y + 14) { hitEnemy(e, 2); P.vy = -400; P.jbuf = 0; }
    else hurtP(1, e.x + e.w / 2);
  }
  const b = G.boss;
  if (b && b.alive && ov(P, b)) {
    if (P.vy > 80 && P.pb <= b.y + 16 && b.stomp <= 0 && !b.inv) { hitBoss(3); b.stomp = 0.6; P.vy = -450; }
    else if (!b.inv) hurtP(1, b.x + b.w / 2);
  }
  for (const p of G.pickups) {
    if (ov(P, p) && P.hp < P.maxhp) { p.t = -1; P.hp++; floatText(p.x, p.y - 6, '+1 vida', '#4fae85'); sfx('pickup'); }
  }
  for (const c of G.crates) if (!c.open && ov(P, c)) openCrate(c);
  G.pickups = G.pickups.filter(p => p.t >= 0 && p.y < VH + 60);
}

/* ---------- Proyectiles ---------- */
function updBullets(dt) {
  const P = G.P;
  for (const b of G.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; b.rot += dt * 18;
    if (b.life <= 0) continue;
    if (b.x < G.cam.x - 60 || b.x > G.cam.x + VWV + 60 || b.y > VH + 40 || b.y < -80) { b.life = 0; continue; }
    if (solidAt(Math.floor(b.x / TS), Math.floor(b.y / TS))) { b.life = 0; burst(b.x, b.y, 4, ['#fff', '#aaa'], 90, 0.25, 0, 2); continue; }
    const r = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
    if (b.own === 'e') {
      if (!P.dead && P.inv <= 0 && ov(r, P)) { hurtP(b.dmg, b.x); b.life = 0; }
    } else {
      for (const e of G.enemies) if (e.alive && ov(r, e)) { hitEnemy(e, b.dmg); b.life = 0; break; }
      if (b.life > 0 && G.boss && G.boss.alive && ov(r, G.boss)) { hitBoss(b.dmg); b.life = 0; }
      if (b.life > 0) for (const c of G.crates) if (!c.open && ov(r, c)) { openCrate(c); b.life = 0; break; }
    }
  }
  G.bullets = G.bullets.filter(b => b.life > 0);
}

/* ---------- Jefe ---------- */
function mkBoss() {
  const n = L.n, hp = Math.round(20 + 2.1 * (n - 1));
  return { type: 'boss', x: L.arenaX + ARENA_PX - 7 * TS, y: -150, w: 38, h: 58, vx: 0, vy: 0, face: -1, hp, maxhp: hp, alive: true, st: 'drop', t: 0, onGround: false, hit: 0, anim: 0, inv: true, stomp: 0, vol: 0, moveT: 1, sp: 62 + n * 3.5, callCd: 6, sid: 0, tele: 0, dir: -1 };
}
function bossAttack(b) {
  const n = L.n, pool = [['shoot', 3]];
  if (n >= 6) pool.push(['charge', 2]);
  if (n >= 11) pool.push(['jump', 2]);
  if (n >= 15 && b.callCd <= 0) pool.push(['call', 3]);
  let t = pool.reduce((s, a) => s + a[1], 0) * Math.random(), pk = 'shoot';
  for (const a of pool) { t -= a[1]; if (t <= 0) { pk = a[0]; break; } }
  b.t = 0;
  if (pk === 'shoot') b.st = 'aim';
  else if (pk === 'charge') b.st = 'cwind';
  else if (pk === 'jump') { b.st = 'air'; b.vy = -740; b.vx = ((G.P.x > b.x) ? 1 : -1) * (120 + n * 6); b.onGround = false; sfx('jump'); }
  else { b.st = 'call'; b.callCd = 14; }
}
function bossVolley(b) {
  const n = L.n, d = L.d, P = G.P, S = 1 + Math.floor((n - 1) / 5);
  const mx = b.x + b.w / 2 + b.face * 34, my = b.y + 22;
  const base = clamp(Math.atan2((P.y + P.h / 2) - my, Math.abs(P.x - b.x) + 1), -0.3, 0.3);
  const ang = b.face > 0 ? base : Math.PI - base, sp = lerp(230, 350, d);
  for (let i = 0; i < S; i++) {
    const a = ang + (i - (S - 1) / 2) * 0.2;
    G.bullets.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, dmg: 1, own: 'e', kind: 'cball', life: 3, rot: 0 });
  }
  sfx('shot'); G.cam.shake = Math.max(G.cam.shake, 0.08);
  burst(mx, my, 10, ['#d8d8d8', '#9a9a9a', '#ffcf70'], 130, 0.6, -20, 4);
}
function bossCall() {
  if (G.enemies.filter(e => e.alive).length >= 3) return;
  [L.arenaX + 80, L.arenaX + ARENA_PX - 100].forEach(x => {
    const e = mkEnemy({ type: 'rifle', x: 0, y: 0, b: null, op: -1 });
    e.x = x; e.y = -40; e.extra = true; G.enemies.push(e);
  });
  toast('¡Refuerzos!'); sfx('flag');
}
function updBoss(b, dt) {
  const P = G.P, n = L.n, d = L.d;
  b.anim += dt; b.t += dt; b.tele = 0;
  if (b.hit > 0) b.hit -= dt;
  if (b.stomp > 0) b.stomp -= dt;
  b.callCd -= dt;
  const cx = b.x + b.w / 2, dx = (P.x + P.w / 2) - cx, sgn = dx >= 0 ? 1 : -1;
  b.vy = Math.min(b.vy + GRAV * dt, 900);
  let vx = 0;
  switch (b.st) {
    case 'drop':
      b.vx = 0; moveBody(b, dt);
      if (b.onGround) { b.st = 'intro'; b.t = 0; G.cam.shake = 0.5; sfx('boom'); burst(cx, b.y + b.h, 16, ['#d8d0b8', '#9a9484'], 200, 0.7, 200, 4); }
      return;
    case 'intro':
      b.face = sgn;
      if (b.t > 0.9) { b.st = 'move'; b.t = 0; b.moveT = rnd(0.9, 1.6); b.inv = false; }
      break;
    case 'move': {
      b.face = sgn;
      const dist = Math.abs(dx), want = dist < 230 ? -1 : dist > 380 ? 1 : 0;
      vx = sgn * want * b.sp;
      if (b.hitX && want < 0) b.t = b.moveT + 0.01;
      if (b.t > b.moveT) bossAttack(b);
      break;
    }
    case 'aim': b.face = sgn; b.tele = 1; if (b.t > 0.55) { b.st = 'fire'; b.t = 0; b.vol = 0; } break;
    case 'fire':
      b.face = sgn;
      if (b.t >= b.vol * 0.34) {
        bossVolley(b); b.vol++;
        if (b.vol >= 1 + Math.floor((n - 1) / 7)) { b.st = 'rest'; b.t = 0; }
      }
      break;
    case 'cwind': b.face = sgn; b.tele = 1; if (b.t > 0.55) { b.st = 'dash'; b.t = 0; b.dir = sgn; sfx('slash'); } break;
    case 'dash':
      vx = b.dir * (290 + n * 6); b.face = b.dir;
      if (b.t > 0.75 || b.hitX) { b.st = 'rest'; b.t = -0.4; G.cam.shake = 0.2; }
      break;
    case 'air':
      vx = b.vx;
      if (b.t > 0.25 && b.onGround) { b.st = 'rest'; b.t = 0; G.cam.shake = 0.35; sfx('boom'); burst(cx, b.y + b.h, 12, ['#d8d0b8', '#9a9484'], 180, 0.6, 200, 4); }
      break;
    case 'call': b.face = sgn; b.tele = 1; if (b.t > 0.7) { bossCall(); b.st = 'rest'; b.t = 0; } break;
    case 'rest':
      b.face = sgn;
      if (b.t > lerp(1.7, 0.9, d)) { b.st = 'move'; b.t = 0; b.moveT = rnd(0.8, 1.5); }
      break;
  }
  b.vx = vx;
  moveBody(b, dt);
}
function hitBoss(dmg) {
  const b = G.boss;
  if (!b || !b.alive || b.inv) return;
  b.hp -= dmg; b.hit = 0.1; sfx('hit');
  burst(b.x + b.w / 2, b.y + 20, 6, ['#e23a4e', '#fff', '#e9b949'], 200, 0.4, 500, 3);
  if (b.hp <= 0) bossDie(b);
}
function bossDie(b) {
  b.alive = false; b.hp = 0; G.state = 'clear'; G.stateT = 0;
  G.bullets = G.bullets.filter(x => x.own === 'p');
  for (const e of G.enemies) if (e.alive) { e.alive = false; burst(e.x + 11, e.y + 17, 10, ['#d8d8d8', L.th.army], 160, 0.7, 300, 3); }
  burst(b.x + b.w / 2, b.y + 28, 70, ['#ffcf70', '#e23a4e', '#fff', '#d8d8d8', '#e9b949'], 520, 1.6, 500, 5);
  G.flash = 1; G.cam.shake = 0.8; sfx('boom'); sfx('win');
}
function updArena(dt) {
  const P = G.P;
  if (!G.arena.locked && G.state === 'play' && !P.dead && P.x > L.arenaX + 3 * TS) {
    G.arena.locked = true; G.arena.t = 0;
    G.bullets = G.bullets.filter(b => b.own === 'p');
    G.banner = { t: 0, name: L.boss }; sfx('boom'); G.cam.shake = 0.35;
  }
  if (G.banner) { G.banner.t += dt; if (G.banner.t > 2.4) G.banner = null; }
  if (G.arena.locked && !G.boss) { G.arena.t += dt; if (G.arena.t > 1.7) G.boss = mkBoss(); }
}

/* ---------- Resto de actualizaciones ---------- */
function updMisc(dt) {
  for (const p of G.parts) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  G.parts = G.parts.filter(p => p.life > 0);
  if (G.parts.length > 500) G.parts.splice(0, G.parts.length - 500);
  for (const t of G.texts) { t.t += dt; t.y -= 24 * dt; }
  G.texts = G.texts.filter(t => t.t < 1.3);
  for (const p of G.pickups) { p.vy = Math.min(p.vy + GRAV * dt, 600); p.vx = 0; moveBody(p, dt); }
  if (G.toast) { G.toast.t += dt; if (G.toast.t > 2.8) G.toast = null; }
  if (G.wFlash > 0) G.wFlash -= dt;
  if (G.flash > 0) G.flash -= dt * 1.2;
  G.crates = G.crates.filter(c => !c.open);
  for (const c of G.crates) c.t += dt;
}
function updCam(dt) {
  const c = G.cam, P = G.P, maxX = L.worldW - VWV;
  const target = clamp(P.x + P.w / 2 - VWV / 2 + P.face * 70, G.arena.locked ? L.arenaX : 0, maxX);
  c.x += (target - c.x) * Math.min(1, dt * 7);
  c.x = clamp(c.x, 0, maxX);
  if (c.shake > 0) c.shake = Math.max(0, c.shake - dt);
}
function step(dt0) {
  let dt = dt0;
  if (G.state === 'clear') {
    G.stateT += dt0;
    if (G.stateT < 1.6) dt = dt0 * 0.35;
    if (G.stateT > 3.2 && !G.done) { G.done = true; finishLevel(); return; }
  }
  if (G.state === 'dead') {
    G.stateT += dt0;
    if (G.stateT > 1.8 && !G.done) { G.done = true; showOver(); return; }
  }
  G.t += dt;
  if (G.fade > 0) G.fade = Math.max(0, G.fade - dt0 * 1.5);
  if (G.state === 'play') G.time += dt;
  updPlayer(dt);
  updArena(dt);
  for (const e of G.enemies) if (e.alive) updEnemy(e, dt);
  G.enemies = G.enemies.filter(e => e.alive);
  if (G.boss && G.boss.alive) updBoss(G.boss, dt);
  updBullets(dt);
  playerContacts();
  updMisc(dt);
  updCam(dt);
}
/* ===== Dibujado ===== */
const cv = $('cv');
const ctx = cv.getContext('2d');
let scale = 1;
const FB = "'Chakra Petch','Segoe UI',system-ui,sans-serif", FD = "'Dela Gothic One','Arial Black',Impact,sans-serif";
const TAU = Math.PI * 2;
const LEAF = { 2: '#9ccf6a', 5: '#ffb3c1', 14: '#b58cff' };
function hsh(a) { a = (a ^ 61) ^ (a >>> 16); a = (a + (a << 3)) | 0; a = a ^ (a >>> 4); a = Math.imul(a, 0x27d4eb2d); a = a ^ (a >>> 15); return (a >>> 0) / 4294967296; }
function text(s, x, y, size, col, align, font) {
  ctx.font = '700 ' + size + 'px ' + (font || FB);
  ctx.textAlign = align || 'left'; ctx.fillStyle = col; ctx.fillText(s, x, y);
}

function resize() {
  const iw = window.innerWidth || 960, ih = window.innerHeight || 544;
  const compact = ih <= 520 && iw > ih;          // móvil en horizontal: todo el área disponible
  const avW = compact ? iw : Math.min(iw - 32, 1180);
  const avH = compact ? ih : Math.max(240, ih - 120);
  const ar = clamp(avW / avH, 1.6, ARENA_PX / VHV);
  const w = Math.floor(Math.min(avW, avH * ar)), h = Math.floor(w / ar);
  const st = $('stage');
  st.style.width = w + 'px'; st.style.height = h + 'px';
  VWV = VHV * ar;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  scale = cv.width / VWV;
}

/* ---------- Fondo ---------- */
function ridge(par, base, amp, col, f1, f2, ph) {
  const c = ctx, cam = G.cam.x;
  c.fillStyle = col; c.beginPath(); c.moveTo(0, VH);
  for (let x = 0; x <= VWV + 12; x += 12) {
    const wx = x + cam * par;
    c.lineTo(x, base - (Math.sin(wx * f1 + ph) * 0.6 + Math.sin(wx * f2 + ph * 2) * 0.4 + 1) * amp);
  }
  c.lineTo(VWV + 12, VH); c.closePath(); c.fill();
}
function drawDeco(k, x, b, s, v) {
  const c = ctx, th = L.th;
  c.fillStyle = th.mid;
  switch (k) {
    case 'houses': {
      const w = 70 * s, h = 46 * s;
      c.fillRect(x, b - h, w, h);
      c.beginPath(); c.moveTo(x - 10 * s, b - h); c.lineTo(x + w / 2, b - h - 26 * s); c.lineTo(x + w + 10 * s, b - h); c.closePath(); c.fill();
      if (v & 1) { c.fillStyle = '#ffcf70'; c.globalAlpha = 0.85; c.fillRect(x + 12 * s, b - h + 14 * s, 9 * s, 11 * s); c.fillRect(x + w - 24 * s, b - h + 14 * s, 9 * s, 11 * s); c.globalAlpha = 1; }
      break;
    }
    case 'bamboo': {
      const h = 230 * s, w = 7 * s;
      c.fillRect(x, b - h, w, h);
      c.fillStyle = 'rgba(255,255,255,.12)';
      for (let y = b - h + 30; y < b; y += 46 * s) c.fillRect(x - 1, y, w + 2, 3);
      c.fillStyle = th.mid;
      c.beginPath(); c.moveTo(x + w, b - h + 20); c.lineTo(x + w + 34 * s, b - h + 34 * s); c.lineTo(x + w, b - h + 38 * s); c.fill();
      c.beginPath(); c.moveTo(x, b - h + 60 * s); c.lineTo(x - 30 * s, b - h + 74 * s); c.lineTo(x, b - h + 78 * s); c.fill();
      break;
    }
    case 'pine': {
      const w = 46 * s, h = 150 * s;
      c.fillRect(x + w / 2 - 4, b - 24 * s, 8, 24 * s);
      for (let i = 0; i < 4; i++) {
        const yy = b - 24 * s - i * h / 4.5, ww = w * (1 - i * 0.2);
        c.beginPath(); c.moveTo(x + w / 2 - ww / 2, yy); c.lineTo(x + w / 2, yy - h / 3); c.lineTo(x + w / 2 + ww / 2, yy); c.closePath(); c.fill();
      }
      break;
    }
    case 'dead': {
      c.strokeStyle = th.mid; c.lineCap = 'round';
      c.lineWidth = 9 * s; c.beginPath(); c.moveTo(x, b); c.lineTo(x + 4 * s, b - 120 * s); c.stroke();
      c.lineWidth = 5 * s; c.beginPath(); c.moveTo(x + 3 * s, b - 70 * s); c.lineTo(x - 34 * s, b - 104 * s); c.moveTo(x + 4 * s, b - 96 * s); c.lineTo(x + 36 * s, b - 130 * s); c.moveTo(x + 4 * s, b - 118 * s); c.lineTo(x - 14 * s, b - 150 * s); c.stroke();
      break;
    }
    case 'cactus': {
      const h = 90 * s;
      c.fillRect(x, b - h, 12 * s, h); c.fillRect(x - 16 * s, b - h * 0.6, 16 * s, 8 * s); c.fillRect(x - 16 * s, b - h * 0.6 - 24 * s, 8 * s, 30 * s);
      c.fillRect(x + 12 * s, b - h * 0.45, 16 * s, 8 * s); c.fillRect(x + 20 * s, b - h * 0.45 - 28 * s, 8 * s, 34 * s);
      break;
    }
    case 'crystal': {
      c.globalAlpha = 0.9;
      for (let i = 0; i < 3; i++) {
        const cw = (14 + i * 6) * s, ch = (70 + ((i * 37 + v * 23) % 60)) * s, cx = x + i * 16 * s;
        c.beginPath(); c.moveTo(cx, b); c.lineTo(cx + cw * 0.2, b - ch * 0.8); c.lineTo(cx + cw * 0.5, b - ch); c.lineTo(cx + cw * 0.85, b - ch * 0.7); c.lineTo(cx + cw, b); c.closePath(); c.fill();
      }
      c.fillStyle = 'rgba(190,225,255,.25)'; c.fillRect(x + 6 * s, b - 60 * s, 3 * s, 40 * s);
      c.globalAlpha = 1;
      break;
    }
    case 'tower': {
      const w = 56 * s, h = (120 + ((v * 29) % 70)) * s;
      c.fillRect(x, b - h, w, h); c.fillRect(x - 8 * s, b - h, w + 16 * s, 8 * s);
      for (let i = 0; i < 4; i++) c.fillRect(x - 8 * s + i * (w + 8 * s) / 3.2, b - h - 8 * s, 8 * s, 8 * s);
      if (v & 1) { c.fillStyle = '#ffcf70'; c.globalAlpha = 0.8; c.fillRect(x + w / 2 - 4 * s, b - h + 24 * s, 8 * s, 12 * s); c.fillRect(x + w / 2 - 4 * s, b - h + 56 * s, 8 * s, 12 * s); c.globalAlpha = 1; }
      break;
    }
    case 'mast': {
      const h = 180 * s;
      c.fillRect(x, b - h, 5 * s, h); c.fillRect(x - 26 * s, b - h + 30 * s, 58 * s, 4 * s);
      c.beginPath(); c.moveTo(x + 6 * s, b - h + 36 * s); c.lineTo(x + 40 * s, b - h + 110 * s); c.lineTo(x + 6 * s, b - h + 110 * s); c.closePath(); c.fill();
      c.fillRect(x - 30 * s, b - 14 * s, 70 * s, 14 * s);
      break;
    }
    case 'spire': {
      const w = 70 * s, h = (110 + ((v * 41) % 90)) * s;
      c.beginPath(); c.moveTo(x, b); c.lineTo(x + w * 0.3, b - h * 0.7); c.lineTo(x + w * 0.45, b - h); c.lineTo(x + w * 0.62, b - h * 0.6); c.lineTo(x + w, b); c.closePath(); c.fill();
      break;
    }
    case 'palm': {
      c.strokeStyle = th.mid; c.lineCap = 'round'; c.lineWidth = 7 * s;
      c.beginPath(); c.moveTo(x, b); c.quadraticCurveTo(x + 14 * s, b - 60 * s, x + 4 * s, b - 120 * s); c.stroke();
      c.lineWidth = 4 * s;
      for (let i = 0; i < 5; i++) { const a = -2.6 + i * 0.55; c.beginPath(); c.moveTo(x + 4 * s, b - 120 * s); c.quadraticCurveTo(x + 4 * s + Math.cos(a) * 30 * s, b - 120 * s + Math.sin(a) * 30 * s - 10 * s, x + 4 * s + Math.cos(a) * 52 * s, b - 120 * s + Math.sin(a) * 40 * s + 16 * s); c.stroke(); }
      break;
    }
  }
}
function drawBackground() {
  const th = L.th, c = ctx, cam = G.cam.x, t = G.t;
  const g = c.createLinearGradient(0, CAMY, 0, VH);
  g.addColorStop(0, th.skyTop); g.addColorStop(1, th.skyBot);
  c.fillStyle = g; c.fillRect(-20, CAMY - 20, VWV + 40, VHV + 40);
  if (th.fx === 'stars' || th.orb === 'moon') {
    c.fillStyle = '#fff';
    for (const s of L.stars) { c.globalAlpha = 0.3 + 0.35 * Math.sin(t * 1.5 + s.p); c.fillRect(((s.x * VWV / VW - cam * 0.02) % VWV + VWV) % VWV, CAMY + s.y * 0.75, s.r, s.r); }
    c.globalAlpha = 1;
  }
  if (th.orb !== 'none') {
    const ox = VWV * 0.74 - cam * 0.015, oy = CAMY + 64;
    const rg = c.createRadialGradient(ox, oy, 6, ox, oy, 120);
    rg.addColorStop(0, th.orbCol + 'cc'); rg.addColorStop(1, th.orbCol + '00');
    c.fillStyle = rg; c.fillRect(ox - 130, oy - 130, 260, 260);
    c.fillStyle = th.orbCol; c.beginPath(); c.arc(ox, oy, th.orb === 'sun' ? 34 : 28, 0, TAU); c.fill();
  }
  ridge(0.12, 330, 90, th.far, 0.006, 0.013, 1.3);
  ridge(0.24, 390, 60, th.far, 0.009, 0.021, 4.1);
  c.globalAlpha = 0.55; c.fillStyle = th.skyBot; c.fillRect(0, 330, VWV, 120); c.globalAlpha = 1;
  const par = 0.5;
  for (const d of L.deco) {
    const x = d.x - cam * par;
    if (x < -160 || x > VWV + 40) continue;
    drawDeco(th.decor, x, 440, d.s, d.v);
  }
}

/* ---------- Mundo ---------- */
function drawPit(x, tx) {
  const th = L.th, c = ctx, t = G.t, y0 = VH - 54;
  if (th.pit === 'water') {
    const wy = y0 + Math.sin(t * 3 + tx) * 3;
    c.fillStyle = th.pitCol || '#2b6fa8'; c.fillRect(x, wy, TS + 1, VH - wy + 4);
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x, wy, TS + 1, 3);
  } else if (th.pit === 'lava') {
    const wy = y0 + 6 + Math.sin(t * 2.4 + tx * 0.7) * 3;
    const g = c.createLinearGradient(0, wy, 0, VH); g.addColorStop(0, '#ffd27a'); g.addColorStop(0.3, '#ff7a2a'); g.addColorStop(1, '#a8240f');
    c.fillStyle = g; c.fillRect(x, wy, TS + 1, VH - wy + 4);
    if (hsh(tx * 7 + Math.floor(t * 2)) < 0.18) { c.fillStyle = '#ffd27a'; c.beginPath(); c.arc(x + 16, wy - 4 - ((t * 40) % 14), 3, 0, TAU); c.fill(); }
  } else if (th.pit === 'spikes') {
    c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x, VH - 74, TS + 1, 78);
    c.fillStyle = '#cdb98a';
    for (let i = 0; i < 3; i++) { const bx = x + 2 + i * 10; c.beginPath(); c.moveTo(bx, VH + 2); c.lineTo(bx + 5, VH - 42 - (i % 2) * 8); c.lineTo(bx + 10, VH + 2); c.fill(); }
  } else {
    const g = c.createLinearGradient(0, y0 - 50, 0, VH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.92)');
    c.fillStyle = g; c.fillRect(x, y0 - 50, TS + 1, VH - y0 + 54);
  }
}
function drawWorld() {
  const th = L.th, c = ctx, cam = G.cam.x;
  const t0 = Math.floor(cam / TS) - 1, t1 = t0 + Math.ceil(VWV / TS) + 3;
  for (let tx = t0; tx <= t1; tx++) {
    if (tx < 0 || tx >= L.W) continue;
    const g = L.gh[tx], x = tx * TS - cam;
    if (g >= 99) { drawPit(x, tx); continue; }
    const top = g * TS;
    c.fillStyle = th.gFill; c.fillRect(x, top, TS + 1, VH - top + 4);
    c.fillStyle = th.gDark;
    for (let k = 0, y = top; y < VH; k++, y += TS) { c.fillRect(x, y + TS - 2, TS, 2); c.fillRect(x + (((k + tx) & 1) ? 0 : TS - 2), y, 2, TS); }
    c.fillStyle = th.gTop; c.fillRect(x, top, TS + 1, th.ground === 'snow' ? 10 : 7);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x, top, TS + 1, 2);
    const r = hsh(tx * 31 + L.n);
    if (th.ground === 'grass' && r < 0.7) {
      c.fillStyle = th.gTop;
      for (let i = 0; i < 3; i++) { const bx = x + 4 + i * 9 + ((r * 6) | 0); c.beginPath(); c.moveTo(bx, top); c.lineTo(bx + 2, top - 6 - ((i + ((r * 5) | 0)) % 3) * 2); c.lineTo(bx + 4, top); c.fill(); }
    } else if (th.ground === 'snow') {
      c.fillStyle = th.gTop; c.beginPath(); c.arc(x + 16, top + 3, 11 + r * 6, Math.PI, 0); c.fill();
    } else if (r < 0.6) {
      c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x + 6 + r * 14, top + 12, 4, 3);
    }
    if (tx > 0 && (L.gh[tx - 1] >= 99 || L.gh[tx - 1] > g)) { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x, top + 7, 4, VH - top); }
    if (tx < L.W - 1 && (L.gh[tx + 1] >= 99 || L.gh[tx + 1] > g)) { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x + TS - 4, top + 7, 4, VH - top); }
  }
  for (const p of L.plats) {
    const x = p.px - cam;
    if (x > VWV + 10 || x + p.pw < -10) continue;
    const mtx = Math.floor((p.px + p.pw / 2) / TS), gg = L.gh[mtx];
    if (gg < 99 && gg * TS > p.py + 14) {
      c.fillStyle = th.plat; c.fillRect(x + 6, p.py + 12, 6, gg * TS - p.py - 12); c.fillRect(x + p.pw - 12, p.py + 12, 6, gg * TS - p.py - 12);
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x + 6, p.py + 12, 6, gg * TS - p.py - 12); c.fillRect(x + p.pw - 12, p.py + 12, 6, gg * TS - p.py - 12);
    }
    c.fillStyle = th.plat; c.fillRect(x, p.py, p.pw, 12);
    c.fillStyle = th.platTop; c.fillRect(x, p.py, p.pw, 4);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x, p.py + 8, p.pw, 4);
    c.fillStyle = 'rgba(0,0,0,.3)';
    for (let i = 8; i < p.pw - 4; i += 24) c.fillRect(x + i, p.py + 5, 3, 3);
  }
}
function drawOutposts() {
  const c = ctx, cam = G.cam.x;
  for (const op of L.outposts) {
    const x = op.flagX - cam;
    if (x < -80 || x > VWV + 80) continue;
    const y = op.flagY, w = Math.sin(G.t * 4 + x * 0.05) * 3;
    c.fillStyle = '#3a2a1f'; c.fillRect(x - 3, y - 112, 6, 112);
    c.fillStyle = '#8a7a5a'; c.fillRect(x - 28, y - 14, 20, 14); c.fillRect(x + 8, y - 14, 20, 14); c.fillRect(x - 18, y - 26, 20, 12);
    c.fillStyle = op.done ? '#efe9da' : '#a3202c';
    c.beginPath(); c.moveTo(x + 3, y - 108); c.lineTo(x + 46, y - 104 + w); c.lineTo(x + 46, y - 80 + w); c.lineTo(x + 3, y - 82); c.closePath(); c.fill();
    c.fillStyle = op.done ? '#e23a4e' : '#e9b949'; c.beginPath(); c.arc(x + 25, y - 93 + w / 2, 7, 0, TAU); c.fill();
    c.fillStyle = '#e9b949'; c.beginPath(); c.arc(x, y - 115, 4, 0, TAU); c.fill();
  }
}
function drawGate() {
  const c = ctx, x = L.arenaX - G.cam.x;
  if (x < -140 || x > VWV + 60) return;
  const y = 13 * TS;
  if (G.arena.locked) {
    c.fillStyle = '#5a1d28'; c.fillRect(x - 14, 0, 14, VH);
    c.fillStyle = '#8a2a38'; for (let yy = 0; yy < VH; yy += 28) c.fillRect(x - 14, yy, 14, 4);
  }
  c.fillStyle = '#c0283a'; c.fillRect(x - 6, y - 150, 10, 150); c.fillRect(x + 86, y - 150, 10, 150);
  c.fillRect(x - 24, y - 160, 138, 12); c.fillRect(x - 8, y - 134, 106, 8);
  c.fillStyle = '#7a1722'; c.fillRect(x - 24, y - 150, 138, 3);
}
function drawCrates() {
  const c = ctx, cam = G.cam.x;
  for (const k of G.crates) {
    const x = k.x - cam;
    if (x < -40 || x > VWV + 40) continue;
    const y = k.y + Math.sin(k.t * 3) * 1.5;
    c.fillStyle = 'rgba(233,185,73,.18)'; c.beginPath(); c.arc(x + 14, y + 14, 22 + Math.sin(k.t * 4) * 2, 0, TAU); c.fill();
    c.fillStyle = '#6a431f'; c.fillRect(x, y, 28, 28);
    c.fillStyle = '#b57a3f'; c.fillRect(x + 2, y + 2, 24, 24);
    c.fillStyle = '#8a5a2f'; c.fillRect(x, y + 12, 28, 4); c.fillRect(x + 12, y, 4, 28);
    c.fillStyle = '#e9b949'; c.fillRect(x + 8, y + 8, 12, 12);
    text('?', x + 14, y + 19, 12, '#3a220e', 'center');
  }
}
function drawPickups() {
  const c = ctx, cam = G.cam.x;
  for (const p of G.pickups) {
    const x = p.x - cam, y = p.y + Math.sin(G.t * 5) * 1.5;
    c.fillStyle = '#f3efe3'; c.beginPath(); c.moveTo(x + 8, y); c.lineTo(x + 16, y + 14); c.lineTo(x, y + 14); c.closePath(); c.fill();
    c.fillStyle = '#1f2a1f'; c.fillRect(x + 3, y + 8, 10, 6);
  }
}

/* ---------- Personajes ---------- */
function drawNinja() {
  const P = G.P, c = ctx;
  if (P.inv > 0 && !P.dead && Math.floor(G.t * 22) % 2 === 0) return;
  const x = P.x - G.cam.x + P.w / 2, y = P.y;
  const run = P.onGround && Math.abs(P.vx) > 20, ph = G.t * 17;
  c.save(); c.translate(x, y + (P.dead ? 16 : 0));
  if (P.dead) c.rotate(Math.min(1.4, P.deadT * 4) * P.face);
  c.scale(P.face, 1);
  const SC = '#e23a4e', DK = '#14161f', BD = '#262b47';
  c.fillStyle = SC;
  for (let i = 0; i < 4; i++) c.fillRect(-9 - i * 5, 7 + Math.sin(G.t * 14 + i * 0.9) * 2.5 + i * 0.6, 7, 4 - i * 0.6);
  c.fillStyle = '#1a1d2e';
  if (!P.onGround) { c.fillRect(-8, 24, 7, 8); c.fillRect(1, 22, 8, 9); }
  else { const a = run ? Math.sin(ph) * 5 : 0; c.fillRect(-8 + a, 24, 7, 10); c.fillRect(1 - a, 24, 7, 10); }
  c.fillStyle = BD; c.fillRect(-9, 12, 18, 13);
  c.fillStyle = '#3a4170'; c.fillRect(-9, 12, 18, 3);
  c.fillStyle = SC; c.fillRect(-9, 22, 18, 3);
  c.fillStyle = DK; c.fillRect(-8, 0, 16, 13);
  c.fillStyle = '#e8c39e'; c.fillRect(-1, 5, 9, 4);
  c.fillStyle = '#fff'; c.fillRect(3, 6, 3, 2); c.fillStyle = DK; c.fillRect(4, 6, 1, 2);
  c.fillStyle = SC; c.fillRect(-8, 3, 16, 3);
  c.fillRect(-13, 3 + Math.sin(G.t * 12) * 1.5, 6, 2); c.fillRect(-12, 6 + Math.sin(G.t * 12 + 1) * 1.5, 5, 2);
  const atk = P.throwT > 0 || P.muzzle > 0 || P.slash > 0;
  c.fillStyle = BD;
  if (atk) { c.fillRect(6, 14, 12, 5); c.fillStyle = '#e8c39e'; c.fillRect(17, 14, 3, 5); }
  else { c.fillRect(3, 15, 6, 9); c.fillStyle = '#e8c39e'; c.fillRect(4, 23, 4, 3); }
  if (P.wpn === 'pistol') {
    c.fillStyle = '#3a3d46'; c.fillRect(atk ? 18 : 6, atk ? 13 : 21, 10, 4);
    c.fillStyle = '#5a3d22'; c.fillRect(atk ? 18 : 6, atk ? 17 : 25, 4, 5);
    if (P.muzzle > 0) { c.fillStyle = '#ffd27a'; c.fillRect(28, 12, 7, 6); }
  } else if (P.wpn === 'katana') {
    if (P.slash > 0) { c.fillStyle = '#dfe7f0'; c.fillRect(19, 15, 26, 3); c.fillStyle = '#e9b949'; c.fillRect(18, 13, 3, 7); }
    else { c.fillStyle = '#c9d3dc'; c.fillRect(-6, 0, 3, 26); c.fillStyle = '#8a2a35'; c.fillRect(-7, -3, 5, 6); }
  }
  c.restore();
  if (P.slash > 0) {
    const prog = 1 - P.slash / 0.2;
    c.save(); c.translate(x + P.face * 10, y + 18); if (P.face < 0) c.rotate(Math.PI);
    c.strokeStyle = 'rgba(255,255,255,' + (0.95 - prog * 0.6) + ')'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, 36, -1.2, -1.2 + 2.4 * Math.min(1, prog * 1.7)); c.stroke();
    c.restore();
  }
}
function drawSoldier(e, boss) {
  const c = ctx, th = L.th;
  const x = e.x - G.cam.x + e.w / 2, y = e.y;
  const flash = e.hit > 0;
  const col = flash ? '#fff' : th.army, trim = flash ? '#fff' : th.trim;
  const moving = boss ? Math.abs(e.vx) > 5 : e.vx !== 0;
  const wk = moving ? Math.sin(e.anim * 10) * 3 : 0;
  c.save();
  if (boss) { c.translate(x, y + e.h); c.scale(e.face * 1.7, 1.7); c.translate(0, -34); }
  else { c.translate(x, y); c.scale(e.face, 1); }
  if (boss) { c.fillStyle = flash ? '#fff' : '#6a1822'; c.fillRect(-14, 12, 7, 21); }
  c.fillStyle = flash ? '#fff' : '#2a2a33'; c.fillRect(-8 + wk, 24, 7, 10); c.fillRect(1 - wk, 24, 7, 10);
  c.fillStyle = col; c.fillRect(-9, 12, 18, 13);
  c.fillStyle = trim; c.fillRect(-9, 21, 18, 2); c.fillRect(-9, 12, 5, 3); c.fillRect(4, 12, 5, 3);
  c.fillStyle = flash ? '#fff' : '#e8c39e'; c.fillRect(-6, 4, 12, 9);
  c.fillStyle = '#14161f'; c.fillRect(2, 8, 2, 2);
  c.fillStyle = flash ? '#fff' : (boss ? '#2b2b36' : '#4a4a58');
  c.beginPath(); c.moveTo(-14, 7); c.lineTo(0, -5); c.lineTo(14, 7); c.closePath(); c.fill();
  c.fillStyle = trim; c.fillRect(-14, 6, 28, 2);
  if (boss) {
    c.fillStyle = flash ? '#fff' : '#e9b949';
    c.beginPath(); c.moveTo(-6, -1); c.lineTo(-13, -11); c.lineTo(-3, -4); c.fill();
    c.beginPath(); c.moveTo(6, -1); c.lineTo(13, -11); c.lineTo(3, -4); c.fill();
  }
  c.fillStyle = col; c.fillRect(2, 14, 11, 5);
  const gun = boss ? 'cannon' : (e.type === 'patrol' ? 'rifle' : e.type);
  const aim = boss ? e.tele : e.aim > 0;
  if (gun === 'rifle') { c.fillStyle = '#6b4a2a'; c.fillRect(4, 15, 8, 4); c.fillStyle = '#2e2e36'; c.fillRect(10, 15, 16, 3); }
  else if (gun === 'blunder') {
    c.fillStyle = '#6b4a2a'; c.fillRect(4, 15, 9, 5); c.fillStyle = '#3a3a44'; c.fillRect(12, 15, 10, 4);
    c.beginPath(); c.moveTo(21, 13); c.lineTo(29, 10); c.lineTo(29, 23); c.lineTo(21, 20); c.fill();
  } else {
    c.fillStyle = '#2b2b33'; c.fillRect(2, 11, 26, 9); c.fillStyle = '#55555f'; c.fillRect(8, 11, 3, 9); c.fillRect(19, 11, 3, 9);
    c.fillStyle = '#17171d'; c.fillRect(27, 10, 4, 11);
  }
  if (aim) {
    const f = 0.5 + 0.5 * Math.sin(G.t * 40);
    c.fillStyle = 'rgba(255,170,60,' + (0.6 + 0.4 * f) + ')';
    c.beginPath(); c.arc(gun === 'cannon' ? 32 : gun === 'blunder' ? 30 : 27, gun === 'cannon' ? 15 : 16, 4 + f * 2, 0, TAU); c.fill();
  }
  if (boss && e.tele) { c.fillStyle = 'rgba(226,58,78,.3)'; c.fillRect(-15, -12, 30, 48); }
  c.restore();
  if (!boss && e.maxhp > 1 && e.hp < e.maxhp) {
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x - 12, y - 12, 24, 4);
    c.fillStyle = '#e23a4e'; c.fillRect(x - 12, y - 12, 24 * e.hp / e.maxhp, 4);
  }
}
function drawBullets() {
  const c = ctx, cam = G.cam.x;
  for (const b of G.bullets) {
    const x = b.x - cam, y = b.y;
    if (b.kind === 'shuriken') {
      c.save(); c.translate(x, y); c.rotate(b.rot); c.fillStyle = '#dfe7f0'; c.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 3 : 8; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fill(); c.fillStyle = '#14161f'; c.beginPath(); c.arc(0, 0, 2, 0, TAU); c.fill(); c.restore();
    } else if (b.kind === 'pistol') {
      c.fillStyle = 'rgba(255,207,112,.5)'; c.fillRect(x - Math.sign(b.vx) * 14 - (b.vx < 0 ? 0 : 0), y - 1, 14, 2);
      c.fillStyle = '#ffe9a8'; c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill();
    } else {
      if (b.kind === 'cball') { c.fillStyle = 'rgba(255,140,60,.25)'; c.beginPath(); c.arc(x, y, b.r + 5, 0, TAU); c.fill(); }
      c.fillStyle = '#17171f'; c.beginPath(); c.arc(x, y, b.r, 0, TAU); c.fill();
      c.strokeStyle = '#ff9a4a'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(x - b.r * 0.5, y - b.r * 0.5, 2, 2);
    }
  }
}
function drawParts() {
  const c = ctx, cam = G.cam.x;
  for (const p of G.parts) {
    c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.c;
    c.fillRect(p.x - cam - p.s / 2, p.y - p.s / 2, p.s, p.s);
  }
  c.globalAlpha = 1;
  for (const t of G.texts) { c.globalAlpha = clamp(1.3 - t.t, 0, 1); text(t.txt, t.x - cam, t.y, 16, t.c, 'center'); }
  c.globalAlpha = 1;
}
function drawFx() {
  const th = L.th, c = ctx, t = G.t, cam = G.cam.x;
  if (th.fx === 'fog') {
    c.fillStyle = 'rgba(220,235,235,.08)';
    for (let i = 0; i < 4; i++) { const x = ((i * 300 - cam * 0.2 + t * 14) % (VWV + 400) + VWV + 400) % (VWV + 400) - 200; c.fillRect(x, 330 + i * 24, 420, 70); }
    return;
  }
  if (th.fx === 'none' || th.fx === 'stars') return;
  c.fillStyle = th.fx === 'embers' ? '#ffa24a' : th.fx === 'snow' ? '#ffffff' : th.fx === 'leaves' ? (LEAF[L.n] || '#9ccf6a') : '#e8c898';
  c.globalAlpha = 0.75;
  for (const p of L.fxp) {
    const px = (((p.x + t * p.vx * (th.fx === 'snow' ? 0.4 : 1) - cam * p.par) % VWV) + VWV) % VWV;
    const py = CAMY + (((p.y * 0.87 + t * (th.fx === 'embers' ? -Math.abs(p.vy) : p.vy)) % VHV) + VHV) % VHV;
    c.fillRect(px, py, p.s, p.s);
  }
  c.globalAlpha = 1;
}

/* ---------- HUD ---------- */
function heart(x, y, s, full) {
  const c = ctx;
  c.fillStyle = full ? '#e23a4e' : '#3a2a36'; c.beginPath();
  c.moveTo(x + s / 2, y + s * 0.3);
  c.bezierCurveTo(x + s / 2, y, x, y, x, y + s * 0.32);
  c.bezierCurveTo(x, y + s * 0.6, x + s * 0.4, y + s * 0.78, x + s / 2, y + s * 0.95);
  c.bezierCurveTo(x + s * 0.6, y + s * 0.78, x + s, y + s * 0.6, x + s, y + s * 0.32);
  c.bezierCurveTo(x + s, y, x + s / 2, y, x + s / 2, y + s * 0.3);
  c.fill();
}
function drawHUD() {
  const c = ctx, P = G.P;
  const hg = c.createLinearGradient(0, 0, 0, 84); hg.addColorStop(0, 'rgba(0,0,0,.55)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = hg; c.fillRect(0, 0, VWV, 84);
  for (let i = 0; i < P.maxhp; i++) heart(14 + i * 27, 10, 23, i < P.hp);
  const wname = P.wpn === 'shuriken' ? 'SHURIKEN ∞' : P.wpn === 'katana' ? 'KATANA ×' + P.ammo : 'PISTOLA ×' + P.ammo;
  const flashW = G.wFlash > 0 && Math.floor(G.wFlash * 8) % 2 === 0;
  c.fillStyle = flashW ? 'rgba(233,185,73,.8)' : 'rgba(0,0,0,.5)'; c.fillRect(14, 42, 156, 26);
  text(wname, 24, 61, 14, flashW ? '#14161f' : '#efe9da');
  text('NIVEL ' + L.n + ' · ' + L.th.name.toUpperCase(), VWV / 2, 24, 15, '#efe9da', 'center');
  text('Puestos ' + G.flags + '/' + L.outposts.length + '  ·  Soldados ' + Math.min(G.killed, L.totalSoldiers) + '/' + L.totalSoldiers, VWV / 2, 44, 13, '#cfd3e4', 'center');
  const bx = VWV / 2 - 160, bw = 320, by = 56;
  c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(bx, by, bw, 3);
  for (const op of L.outposts) { c.fillStyle = op.done ? '#4fae85' : '#a3202c'; c.fillRect(bx + bw * clamp((op.x + op.w / 2) / L.arenaX, 0, 1) - 3, by - 3, 6, 9); }
  c.fillStyle = '#e9b949'; c.fillRect(bx + bw - 3, by - 5, 8, 13);
  c.fillStyle = '#efe9da'; c.beginPath(); c.arc(bx + bw * clamp(P.x / L.arenaX, 0, 1), by + 1.5, 5, 0, TAU); c.fill();
  const tm = G.time, medal = tm <= 90;
  text(fmt(tm), VWV - 112, 28, 22, medal ? '#efe9da' : '#e9b949', 'right');
  text(medal ? '★ en tiempo' : 'sin medalla', VWV - 112, 46, 11, '#9aa3bd', 'right');
  const b = G.boss;
  if (b && b.alive && b.st !== 'drop') {
    const w = 420, x = VWV / 2 - w / 2, y = VHV - 38;
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x - 4, y - 24, w + 8, 42);
    text(L.boss.toUpperCase(), VWV / 2, y - 8, 14, '#efe9da', 'center');
    c.fillStyle = '#3a2a36'; c.fillRect(x, y, w, 10);
    c.fillStyle = '#e23a4e'; c.fillRect(x, y, w * clamp(b.hp / b.maxhp, 0, 1), 10);
  }
  if (G.banner) {
    const t = G.banner.t, a = Math.min(1, t * 3) * Math.min(1, (2.4 - t) * 2);
    c.globalAlpha = clamp(a, 0, 1);
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, VHV / 2 - 76, VWV, 130);
    text(L.n === 20 ? 'ÚLTIMO JEFE' : 'JEFE DEL NIVEL', VWV / 2, VHV / 2 - 32, 16, '#e9b949', 'center');
    text(L.boss, VWV / 2, VHV / 2 + 20, 44, '#efe9da', 'center', FD);
    c.globalAlpha = 1;
  }
  if (G.toast && !G.banner) {
    const a = clamp(Math.min(G.toast.t * 4, (2.8 - G.toast.t) * 3), 0, 1);
    c.globalAlpha = a; c.font = '700 15px ' + FB;
    const w = c.measureText(G.toast.txt).width + 28;
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(VWV / 2 - w / 2, 80, w, 28);
    text(G.toast.txt, VWV / 2, 99, 15, '#efe9da', 'center');
    c.globalAlpha = 1;
  }
  if (G.state === 'clear') {
    const a = clamp((G.stateT - 0.5) * 1.5, 0, 1);
    c.globalAlpha = a; text('¡NIVEL COMPLETADO!', VWV / 2, VHV / 2, 48, '#efe9da', 'center', FD); c.globalAlpha = 1;
  }
  if (G.flash > 0) { c.fillStyle = 'rgba(255,255,255,' + clamp(G.flash, 0, 1) * 0.8 + ')'; c.fillRect(0, 0, VWV, VHV); }
  if (G.fade > 0) { c.fillStyle = 'rgba(0,0,0,' + clamp(G.fade, 0, 1) + ')'; c.fillRect(0, 0, VWV, VHV); }
}

function render() {
  if (!G) return;
  const c = ctx;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  let sx = 0, sy = 0;
  if (G.cam.shake > 0) { const m = Math.min(1, G.cam.shake) * 10; sx = (Math.random() - 0.5) * m; sy = (Math.random() - 0.5) * m; }
  c.save(); c.translate(sx, sy - CAMY);
  drawBackground(); drawWorld(); drawOutposts(); drawGate(); drawCrates(); drawPickups();
  for (const e of G.enemies) {
    const ex = e.x - G.cam.x;
    if (e.alive && ex > -60 && ex < VWV + 60) drawSoldier(e, false);
  }
  if (G.boss && G.boss.alive) drawSoldier(G.boss, true);
  drawNinja(); drawBullets(); drawParts(); drawFx();
  c.restore();
  drawHUD();
}
/* ===== Flujo: pantallas, bucle principal y arranque ===== */
let introN = 1, last = 0, acc = 0;
const FOCUS = { home: 'btnContinue', levels: 'lvBack', intro: 'inGo', result: 'rHome', over: 'oRetry' };
function blurActive() { try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* ignorar */ } }
function focusView(v) { try { if (FOCUS[v]) $(FOCUS[v]).focus({ preventScroll: true }); } catch (e) { /* ignorar */ } }

function setPause(on) {
  if (view !== 'play' || !G) return;
  paused = on; $('pause').hidden = !on;
  releaseAll();
  if (on) { try { $('pResume').focus({ preventScroll: true }); } catch (e) { /* ignorar */ } }
  else blurActive();
}
function onEnterKey() {
  if (view === 'home') goContinue();
  else if (view === 'intro') startLevel(introN);
  else if (view === 'result') toHome();
  else if (view === 'over') startLevel(G ? G.n : 1);
  else if (view === 'play' && paused) setPause(false);
}

function buildHome() {
  $('btnContinue').textContent = save.cleared >= 20 ? 'Rejugar nivel 20' : save.cleared === 0 ? 'Jugar nivel 1' : 'Continuar · nivel ' + unlockedMax();
  $('homeProgress').textContent = 'Niveles completados: ' + save.cleared + ' de 20';
  $('btnSound').textContent = 'Sonido: ' + (muted ? 'no' : 'sí');
}
function toHome() { paused = false; releaseAll(); show('home'); buildHome(); focusView('home'); }
function goContinue() { openIntro(Math.min(20, unlockedMax())); }
function openIntro(n) {
  introN = n;
  const th = THEMES[n - 1];
  $('inKick').textContent = 'Nivel ' + n + ' de 20';
  $('inName').textContent = th.name;
  $('inStory').textContent = th.story;
  $('inOutposts').textContent = String(outpostCount(n));
  $('inBoss').textContent = th.boss;
  $('inGo').textContent = 'Comenzar nivel ' + n;
  show('intro'); focusView('intro');
}
function buildLevels() {
  const g = $('levelGrid');
  g.innerHTML = '';
  const nxt = unlockedMax();
  for (let n = 1; n <= 20; n++) {
    const th = THEMES[n - 1], unlocked = n <= nxt, done = n <= save.cleared, best = save.best[n];
    const b = document.createElement('button');
    b.className = 'lv' + (done ? ' done' : '') + (!unlocked ? ' locked' : '') + (unlocked && !done ? ' next' : '');
    b.disabled = !unlocked;
    const a = document.createElement('span'); a.className = 'num'; a.textContent = String(n);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = th.name;
    const st = document.createElement('span'); st.className = 'st';
    st.textContent = done ? 'Completado' + (best ? ' · ' + fmt(best) + (best <= 90 ? ' ★' : '') : '') : unlocked ? 'Disponible' : 'Bloqueado';
    b.appendChild(a); b.appendChild(nm); b.appendChild(st);
    b.addEventListener('click', () => openIntro(n));
    g.appendChild(b);
  }
}
function startLevel(n) {
  initAudio(); newGame(n);
  paused = false; $('pause').hidden = true; releaseAll(); blurActive();
  show('play'); resize();
  last = performance.now(); acc = 0;
}
function finishLevel() {
  const n = G.n, t = Math.round(G.time), isFinal = n === 20;
  if (n > save.cleared) save.cleared = n;
  if (!save.best[n] || t < save.best[n]) save.best[n] = t;
  persist();
  $('rKick').textContent = isFinal ? 'Fin de la historia' : 'Puesto liberado';
  $('rTitle').textContent = 'Nivel ' + n + ' completado';
  $('rStory').textContent = isFinal
    ? 'El General Tetsu cae y las puertas de la torre se abren. Sakura corre hacia ti entre las llamas de la fortaleza. La aldea será reconstruida y esta vez nadie volverá a quemarla. Gracias por jugar.'
    : 'Has derrotado a ' + L.boss + ' y el camino al siguiente puesto queda libre. Sakura sigue esperando.';
  $('rTime').textContent = fmt(t);
  $('rKills').textContent = Math.min(G.killed, L.totalSoldiers) + '/' + L.totalSoldiers;
  $('rFlags').textContent = G.flags + '/' + L.outposts.length;
  $('rStar').textContent = t <= 90 ? '★ Sí' : 'No';
  show('result'); focusView('result');
}
function showOver() {
  $('oTitle').textContent = 'Caíste en el nivel ' + G.n;
  $('oStory').textContent = (G.boss ? L.boss + ' te ha detenido' : 'Los soldados del General Tetsu te han detenido') + ' esta vez. Respira, estudia el ritmo de sus disparos y vuelve a intentarlo.';
  show('over'); focusView('over');
}

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (ts - last) / 1000 || 0);
  last = ts;
  if (view === 'play' && G && !paused) {
    acc += dt;
    let k = 0;
    while (acc >= STEP && k < 6 && view === 'play') { step(STEP); acc -= STEP; k++; }
    if (k >= 6) acc = 0;
    if (view === 'play') render();
  }
}

function wire() {
  $('btnContinue').addEventListener('click', () => { initAudio(); goContinue(); });
  $('btnLevels').addEventListener('click', () => { initAudio(); buildLevels(); show('levels'); focusView('levels'); });
  $('btnSound').addEventListener('click', () => { muted = !muted; if (!muted) initAudio(); buildHome(); });
  const fsBtn = $('btnFull');
  if (document.fullscreenEnabled) {
    fsBtn.hidden = false;
    fsBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen();
          try { await screen.orientation.lock('landscape'); } catch (e) { /* no disponible */ }
        }
      } catch (e) { /* ignorar */ }
    });
  }
  $('lvBack').addEventListener('click', toHome);
  let armed = false;
  $('btnReset').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!armed) {
      armed = true; b.textContent = '¿Seguro? Pulsa otra vez';
      setTimeout(() => { armed = false; b.textContent = 'Borrar progreso'; }, 3500);
    } else {
      armed = false; b.textContent = 'Borrar progreso';
      save = { cleared: 0, best: {} }; persist(); buildLevels();
    }
  });
  $('inGo').addEventListener('click', () => startLevel(introN));
  $('inBack').addEventListener('click', () => { buildLevels(); show('levels'); focusView('levels'); });
  $('pauseBtn').addEventListener('click', () => setPause(true));
  $('pResume').addEventListener('click', () => setPause(false));
  $('pRestart').addEventListener('click', () => startLevel(G.n));
  $('pMenu').addEventListener('click', toHome);
  $('rHome').addEventListener('click', toHome);
  $('oRetry').addEventListener('click', () => startLevel(G.n));
  $('oHome').addEventListener('click', toHome);
  window.addEventListener('resize', () => { if (view === 'play') resize(); });
}

wire();
bindTouch();
buildHome();
show('home');
requestAnimationFrame(frame);
