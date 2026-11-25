// The critters: a jellyfish, a ghost, a tiger cub and a ladybird that live in
// the empty space around the reading column. Decoration only. Every canvas is
// aria-hidden and sits where no text can be: the side margins on wide screens,
// or the gap above the footer rule (the "ledge") when the text fills the
// screen. The page reads the same without this script.
//
// One canvas pixel is one sprite pixel; the browser scales each canvas up by a
// whole number of device pixels, so the art stays sharp at any zoom or DPR.
// Sprites live in ./sprites.ts. The colophon explains the why.
import { CAST, VARIANTS, GLYPHS, type Palette } from './sprites';

type Kind = keyof typeof CAST;
type Img = HTMLCanvasElement & { k: string };

interface Critter {
  kind: Kind;
  x: number; // top-left, CSS px in world space (viewport in margins mode, ledge-local on the ledge)
  y: number;
  vx: number; // px/s
  vy: number;
  w: number; // CSS px
  h: number;
  st: string; // state
  t: number; // seconds in this state
  dur: number; // how long this state lasts, where it has a length
  f: string; // frame
  pose: string; // a frame shown instead of f until poseTo
  poseTo: number;
  dir: number; // facing: 1 right (or up, for the ladybird), -1 left (or down)
  a: number; // alpha
  side: number; // 0 left margin, 1 right
  rare: boolean;
  wait: number; // seconds until it enters
  asleep: boolean; // settled for the night
  next: number; // next timed event: pulse, wander, flick, pause
  tx: number; // target
  ty: number;
  by: number; // bob offset, CSS px
  ph: number; // a random phase, so two of a kind don't move in step
  blinkAt: number;
  blinkTo: number;
  glowTo: number;
  near: number; // last time the pointer came within 200 px
  cool: number; // no pounce before this
  fast: boolean; // entering: moves at entrance speed, unclamped
  hunt: number; // what this pounce is at: 0 the pointer, 1 the ladybird, 2 a tapped spot
  path: number[]; // flight: x0 y0 cx cy x1 y1
  u: number; // flight progress 0..1
  resume: string; // state to return to after crossing the column
}

interface Canvas {
  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  x: number; // world rect
  y: number;
  w: number;
  h: number;
  sig: string; // what was drawn last; unchanged means no redraw
}

interface Fx {
  g: keyof typeof GLYPHS.frames;
  x: number;
  y: number;
  vy: number;
  age: number;
  life: number;
}

const NAMES: Record<Kind, string> = { jellyfish: '01 JELLYFISH', ghost: '02 GHOST', tiger: '03 TIGER CUB', ladybird: '04 LADYBIRD' };
const IDLE_WORD: Record<Kind, string> = { jellyfish: 'DRIFTING', ghost: 'FLOATING', tiger: 'SITTING', ladybird: 'CRAWLING' };
const WORDS: Record<string, string> = {
  held: 'HELD', shy: 'SHY', creep: 'CURIOUS', boo: 'BOO', booT: 'BOO', walk: 'WALKING', stalk: 'STALKING',
  wiggle: 'STALKING', chase: 'STALKING', leap: 'POUNCING', happy: 'PURRING', fall: 'FALLING', nap: 'NAPPING',
  startled: 'STARTLED', freeze: 'FROZEN', fly: 'FLYING', found: 'FOUND', follow: 'FOLLOWING FOCUS', rest: 'RESTING',
};
const TOKENS: Record<string, string> = { fg: '--fg', muted: '--fg-muted', accent: '--accent', bg: '--bg', sunk: '--bg-sunk' };
// A press on any of these is the page's, never a critter's
const IGNORE = 'a,button,input,select,textarea,label,summary,[tabindex],[contenteditable]';
const BLINKS = /^(drift|hem|walk|sit)/;
const BEDTIME = 60;

const root = document.documentElement;
const media = (q: string) => matchMedia(q);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const pad = (n: number) => String(n).padStart(2, '0');
const read = (store: () => Storage, k: string) => {
  try {
    return store().getItem(k);
  } catch {
    return null;
  }
};
const write = (store: () => Storage, k: string, v: string) => {
  try {
    store().setItem(k, v);
  } catch {
    /* storage blocked: the critters just forget */
  }
};

let on = true;
let live = false;
let reduced = false;
let printing = false;
let dark = false;
let mode: 'margins' | 'ledge' | 'none' = 'none';
let vw = 0;
let vh = 0;
let q = 3; // CSS px per sprite px
let floorY = 0; // where feet rest
let sides: { a: number; b: number; wall: number }[] = []; // usable x range and the page edge, per margin
let ledge = { x: 0, y: 0, w: 0, h: 0 }; // document px
let ledgeSeen = false;
let ledgeVisible = false;
let canvases: Canvas[] = [];
let cast: Critter[] = [];
let drawOrder: Critter[] = [];
let fx: Fx[] = [];
let T = 0; // world clock, seconds; stands still while the loop is stopped
let lastMs = 0;
let raf = 0;
let lastStim = 0;
let lastScroll = 0;
let lastBoo = -1e9;
let boos = 0;
let lastHunt = 0;
let nextVisit = 0;
let visitor: Kind = 'ghost';
let slow: number[] = [];
let tok: Record<string, string> = {};
let atlas = new Map<string, Img>();
let ac: AbortController | null = null;
let ro: ResizeObserver | null = null;
let io: IntersectionObserver | null = null;
let tag: HTMLElement | null = null;
let tagFor: Critter | null = null;
let tagText = '';
let tagSize = [0, 0];
let tagTimer = 0;
let foundTimer = 0;
let tagHold = 0;
let hoverC: Critter | null = null;
let held: Critter | null = null;
let down: { c: Critter | null; x: number; y: number; t: number; type: string; dx: number; dy: number } | null = null;
let followEl: Element | null = null;
let pending = false;
let session: {
  v: number; // record version; any other is ignored
  sideA: number;
  rare: boolean[]; // tiger, jellyfish A, jellyfish B
  bugs: number;
  world?: { t: number; mode: string; list: number[][] };
};

const ptr = { x: -1e4, y: -1e4, on: false, vx: 0, vy: 0, t: 0, ax: -1e4, ay: -1e4, at: 0, cx: -1e4, cy: -1e4, samples: [] as number[][] };

// ---------------------------------------------------------------- start, stop

export function boot() {
  // `npm run dev` only: inspect the world from the console as `critters`
  if (import.meta.env.DEV) Object.assign(window, { critters: { get cast() { return cast; }, get mode() { return mode; }, get T() { return T; } } });
  if (!document.createElement('canvas').getContext('2d')) return;
  const toggle = document.querySelector<HTMLButtonElement>('.critters-toggle');
  // Forced colours (a contrast theme) replaces the site's colours, and the
  // critters step aside with them, switch included
  const forced = media('(forced-colors: active)');
  const show = () => {
    if (!toggle) return;
    toggle.hidden = forced.matches;
    toggle.setAttribute('aria-pressed', String(on));
  };
  // Bring the critters in line with the stored choice and the colour mode
  const sync = () => {
    show();
    if (on && !forced.matches) start(true);
    else stop(), (root.dataset.critters = 'off');
  };
  on = read(() => localStorage, 'critters') !== 'off';
  show();
  toggle?.addEventListener('click', () => {
    on = !on;
    write(() => localStorage, 'critters', on ? 'on' : 'off');
    sync();
  });
  forced.addEventListener('change', sync);
  // A page restored by Back may predate a choice made on a later page
  addEventListener('pageshow', (e) => {
    const want = read(() => localStorage, 'critters') !== 'off';
    if (e.persisted && want !== on) (on = want), sync();
  });
  if (!on || forced.matches) {
    root.dataset.critters = 'off';
    return;
  }
  // After the page has loaded and gone quiet, so nothing here competes with it
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(() => start(), { timeout: 2000 }) : setTimeout(start, 1200));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}

function start(fresh = false) {
  if (!on || live || media('(forced-colors: active)').matches) return;
  live = true;
  ac = new AbortController();
  const passive = { passive: true, signal: ac.signal };
  const doc = (type: string, fn: (e: never) => void, opts: AddEventListenerOptions = passive) =>
    document.addEventListener(type, fn as EventListener, opts);
  const win = (type: string, fn: (e: never) => void) => addEventListener(type, fn as EventListener, passive);
  const watch = (query: string, fn: () => void) => media(query).addEventListener('change', fn, { signal: ac.signal });

  reduced = media('(prefers-reduced-motion: reduce)').matches;
  session = load();
  readTheme();
  measure();
  layout();
  spawn(fresh ? null : session.world);

  doc('pointermove', onMove);
  doc('pointerdown', onDown, { signal: ac.signal });
  doc('pointerup', onUp);
  doc('pointercancel', onUp);
  doc('focusin', onFocus);
  doc('focusout', () => (followEl = null));
  doc('keydown', (e: KeyboardEvent) => e.key === 'Escape' && ((tagHold = 0), showTag(null)));
  doc('visibilitychange', () => (document.hidden ? halt() : wake()));
  root.addEventListener('pointerleave', () => ((ptr.on = false), hover(null)), passive);
  win('resize', later);
  win('pagehide', save);
  win('pageshow', (e: PageTransitionEvent) => e.persisted && wake());
  win('beforeprint', () => ((printing = true), halt()));
  win('afterprint', () => ((printing = false), wake()));
  watch('(prefers-color-scheme: dark)', () => (readTheme(), draw()));
  watch('(prefers-reduced-motion: reduce)', () => {
    reduced = media('(prefers-reduced-motion: reduce)').matches;
    if (reduced) still();
    wake();
  });
  const dprWatch = () =>
    media(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => (later(), dprWatch()), { once: true, signal: ac?.signal });
  dprWatch();
  ro = new ResizeObserver(later);
  for (const sel of ['.site-header', '#main', '.site-footer']) {
    const el = document.querySelector(sel);
    if (el) ro.observe(el);
  }
  document.fonts?.ready.then(later);

  if (reduced) still();
  else draw();
  root.dataset.critters = reduced ? 'still' : 'on';
  wake();
}

function stop() {
  if (!live) return;
  live = false;
  ac?.abort();
  ro?.disconnect();
  io?.disconnect();
  halt();
  for (const cv of canvases) cv.el.remove();
  canvases = [];
  tag?.remove();
  tag = tagFor = hoverC = held = null;
  clearTimeout(tagTimer);
  clearTimeout(foundTimer);
  tagHold = 0;
  cast = [];
  fx = [];
  root.style.cursor = '';
  root.classList.remove('critters-grabbing');
  root.dataset.critters = 'off';
}

function load(): typeof session {
  let s = null;
  try {
    s = JSON.parse(read(() => sessionStorage, 'critters:world') || 'null');
  } catch {
    /* a bad record is no record */
  }
  // A record from another version of this script, or a damaged one, is no record
  const ok = s && s.v === 1 && (s.sideA === 0 || s.sideA === 1) && Array.isArray(s.rare) && s.rare.length === 3 && Number.isFinite(s.bugs);
  if (!ok) return { v: 1, sideA: Math.random() < 0.5 ? 0 : 1, rare: [Math.random() < 1 / 40, Math.random() < 1 / 50, Math.random() < 1 / 50], bugs: 0 };
  const w = s.world;
  const entry = (e: unknown) => Array.isArray(e) && e.length === 5 && e.every(Number.isFinite) && (e[3] === 0 || e[3] === 1);
  if (w && !(Date.now() - w.t < 30 * 60e3 && Array.isArray(w.list) && w.list.every(entry))) delete s.world;
  return s;
}

// Written on pagehide (never unload, so the back/forward cache still works).
// Positions are fractions of each critter's own zone, so the next page puts
// a napping tiger back in the same corner.
function save() {
  if (!live || mode === 'none') return;
  const span = mode === 'margins' ? vh : ledge.h;
  session.world = {
    t: Date.now(),
    mode,
    list: cast.map((c) => {
      const z = sides[c.side];
      return [+((c.x - z.a) / Math.max(1, z.b - z.a)).toFixed(3), +(c.y / span).toFixed(3), +c.asleep, c.side, c.dir];
    }),
  };
  write(() => sessionStorage, 'critters:world', JSON.stringify(session));
}

// ------------------------------------------------------------------ measuring

function measure() {
  const header = document.querySelector('.site-header');
  const main = document.getElementById('main');
  const footer = document.querySelector('.site-footer');
  vw = root.clientWidth;
  vh = innerHeight;
  mode = 'none';
  if (!header || !main || !footer) return;
  // The header shares the .page box with main and the footer, so its content
  // box is exactly the column, rail included.
  const r = header.getBoundingClientRect();
  const cs = getComputedStyle(header);
  const cl = Math.floor(r.left + parseFloat(cs.paddingLeft)) - 4;
  const cr = Math.ceil(r.right - parseFloat(cs.paddingRight)) + 4;
  const room = Math.min(cl, vw - cr);
  const dpr = devicePixelRatio || 1;
  const scale = (s: number) => (q = Math.max(1, Math.round(s * dpr)) / dpr);
  if (room >= 120) {
    mode = 'margins';
    scale(room >= 160 ? 3 : 2);
    sides = [
      { a: 6, b: cl - 16, wall: r.left },
      { a: cr + 16, b: vw - 6, wall: r.right },
    ];
    floorY = vh - 4;
    return;
  }
  // Narrow: the gap between the end of main and the footer rule is empty on
  // every page. The critters stand on the rule.
  const fr = footer.getBoundingClientRect();
  const fs = getComputedStyle(footer);
  const gap = Math.min(fr.top - main.getBoundingClientRect().bottom, 120);
  if (gap < 56) return;
  mode = 'ledge';
  scale(2);
  const x = fr.left + parseFloat(fs.paddingLeft);
  const w = Math.floor((fr.right - parseFloat(fs.paddingRight) - x) / q) * q;
  const h = Math.floor(gap / q) * q;
  ledge = { x: Math.round((x + scrollX) * dpr) / dpr, y: Math.round((fr.top + scrollY - h) * dpr) / dpr, w, h };
  sides = [{ a: 0, b: w, wall: 0 }];
  sides[1] = sides[0];
  floorY = h;
}

// Make (or reuse) the canvases for the current mode
function layout() {
  const want: number[][] = []; // world x, y, w, h, then style left, top
  if (mode === 'margins') {
    const dpr = devicePixelRatio || 1;
    const lw = Math.floor((sides[0].b + 16) / q) * q;
    const rw = Math.floor((vw - sides[1].a + 16) / q) * q;
    const rx = Math.round((vw - rw) * dpr) / dpr;
    const h = Math.floor(vh / q) * q;
    want.push([0, 0, lw, h, 0, 0], [rx, 0, rw, h, rx, 0]);
  } else if (mode === 'ledge') {
    want.push([0, 0, ledge.w, ledge.h, ledge.x, ledge.y]);
  }
  while (canvases.length > want.length) canvases.pop()!.el.remove();
  want.forEach(([x, y, w, h, left, top], i) => {
    let cv = canvases[i];
    if (!cv) {
      const el = document.createElement('canvas');
      el.setAttribute('aria-hidden', 'true');
      document.body.append(el);
      cv = canvases[i] = { el, ctx: el.getContext('2d')!, x, y, w, h, sig: '' };
    }
    Object.assign(cv, { x, y, w, h, sig: '' });
    cv.el.className = mode === 'ledge' ? 'critters critters-ledge no-print' : 'critters no-print';
    cv.el.width = Math.max(1, Math.round(w / q));
    cv.el.height = Math.max(1, Math.round(h / q));
    cv.el.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
    cv.ctx.imageSmoothingEnabled = false;
  });
  io?.disconnect();
  io = null;
  if (mode === 'ledge') {
    io = new IntersectionObserver(([e]) => {
      ledgeVisible = e.isIntersecting;
      if (ledgeVisible && !ledgeSeen) {
        ledgeSeen = true;
        nextVisit = T + 6;
        if (cast.some((c) => c.fast)) for (const c of cast) c.wait = 0;
      }
      if (ledgeVisible) wake();
      else halt();
    });
    io.observe(canvases[0].el);
  }
}

// Re-measure on the next frame, once, however many observers fire
function later() {
  if (pending || !live) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (!live) return;
    const was = mode;
    measure();
    layout();
    if (mode !== was) spawn(null, true);
    else for (const c of cast) fit(c);
    if (reduced) still();
    else draw();
    wake();
  });
}

// --------------------------------------------------------------------- colour

function readTheme() {
  const cs = getComputedStyle(root);
  for (const k in TOKENS) tok[k] = cs.getPropertyValue(TOKENS[k]).trim();
  const x = document.createElement('canvas').getContext('2d')!;
  x.fillStyle = tok.bg;
  x.fillRect(0, 0, 1, 1);
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
  dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  atlas = new Map();
  for (const cv of canvases) cv.sig = '';
}

const colour = (v: string) => (v.includes('|') ? (dark ? v.split('|')[1] : v.split('|')[0]).split(':')[1] : tok[v] || v);

// --------------------------------------------------------------------- sprites

// The character at (x, y) of a frame after a transform:
// 0 as drawn, 1 mirrored, 2 upside down, 3 turned right, 4 turned left.
// A blink closes eyes: each 'e' takes the pixel above it.
function pixel(grid: string[], tf: number, blink: boolean, x: number, y: number) {
  const gw = grid[0].length;
  const gh = grid.length;
  const turned = tf > 2;
  if (x < 0 || y < 0 || x >= (turned ? gh : gw) || y >= (turned ? gw : gh)) return '.';
  const sx = tf === 1 ? gw - 1 - x : tf === 3 ? y : tf === 4 ? gw - 1 - y : x;
  const sy = tf === 2 ? gh - 1 - y : tf === 3 ? gh - 1 - x : tf === 4 ? x : y;
  const ch = grid[sy][sx];
  return blink && ch === 'e' && sy ? grid[sy - 1][sx] : ch;
}

// Sprites are drawn once per theme into small canvases with a one-pixel
// border, which the dark-theme glow uses.
function image(grid: string[], palette: Palette, tf: number, blink: boolean, glow: string, key: string) {
  let im = atlas.get(key);
  if (im) return im;
  const turned = tf > 2;
  const w = turned ? grid.length : grid[0].length;
  const h = turned ? grid[0].length : grid.length;
  im = Object.assign(document.createElement('canvas'), { width: w + 2, height: h + 2, k: key });
  const ctx = im.getContext('2d')!;
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      const ch = pixel(grid, tf, blink, x, y);
      if (glow) {
        const edge = pixel(grid, tf, blink, x - 1, y) + pixel(grid, tf, blink, x + 1, y) + pixel(grid, tf, blink, x, y - 1) + pixel(grid, tf, blink, x, y + 1);
        if (ch !== '.' || edge === '....') continue;
        ctx.fillStyle = glow;
      } else if (ch === '.') continue;
      else ctx.fillStyle = colour(palette[ch]);
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  atlas.set(key, im);
  return im;
}

const frameOf = (c: Critter) => (T < c.poseTo ? c.pose : c.f);
const blinking = (c: Critter) =>
  (c.kind === 'tiger' && (c.st === 'held' || c.st === 'fall') && frameOf(c) === 'walk1') || (T < c.blinkTo && BLINKS.test(frameOf(c)));
const variant = (c: Critter) => (c.rare && c.kind in VARIANTS ? VARIANTS[c.kind as keyof typeof VARIANTS] : null);

function sprite(c: Critter, glow = false) {
  const f = frameOf(c);
  const b = blinking(c);
  const v = variant(c);
  const g = glow ? v?.glow || (CAST[c.kind] as { glow?: string }).glow || '' : '';
  if (glow && !g) return null;
  return image(CAST[c.kind].frames[f as never], v ? { ...CAST[c.kind].palette, ...v.palette } : CAST[c.kind].palette, c.tf, b, g, `${c.kind}|${f}|${c.tf}|${+b}|${+c.rare}|${+glow}`);
}

const glyph = (g: keyof typeof GLYPHS.frames) => image(GLYPHS.frames[g], GLYPHS.palette, 0, false, '', 'g' + g);

// ---------------------------------------------------------------------- cast

function make(kind: Kind, side: number, rare = false): Critter {
  const frames = CAST[kind].frames as Record<string, string[]>;
  const first = Object.keys(frames)[0];
  return {
    kind, side, rare, x: 0, y: 0, vx: 0, vy: 0, w: frames[first][0].length * q, h: frames[first].length * q,
    st: '', t: 0, dur: 0, f: first, pose: first, poseTo: 0, dir: 1, a: 1, wait: 0, asleep: false, next: T + rnd(1, 3),
    tx: 0, ty: 0, by: 0, ph: rnd(0, 6.3), blinkAt: T + rnd(2, 6), blinkTo: 0, glowTo: 0, near: T, cool: 0, fast: false, hunt: 0,
    path: [], u: 0, resume: '',
  };
}

const find = (k: Kind) => cast.find((c) => c.kind === k);
const go = (c: Critter, st: string, dur = 0) => ((c.st = st), (c.t = 0), (c.dur = dur));
const show = (c: Critter, pose: string, s: number) => ((c.pose = pose), (c.poseTo = T + s));
const puff = (g: Fx['g'], x: number, y: number, vy: number, life: number) => fx.push({ g, x, y, vy, age: 0, life });
const visible = (c: Critter) => c.wait <= 0 && c.st !== 'hide' && c.a > 0.05;

// Populate the world: from the record of the last page if it fits this
// mode, otherwise with an entrance (first page) or at rest (resize, toggle).
function spawn(world: typeof session.world | null, rest = false) {
  const B = 1 - session.sideA;
  const [rt, rj1, rj2] = session.rare;
  cast = [];
  fx = [];
  down = held = hoverC = tagFor = null;
  clearTimeout(tagTimer);
  clearTimeout(foundTimer);
  tagHold = 0;
  if (tag) tag.hidden = true;
  root.style.cursor = '';
  root.classList.remove('critters-grabbing');
  if (mode === 'margins') {
    cast.push(make('jellyfish', session.sideA, rj1));
    if (Math.min(sides[0].b, vw - sides[1].a) + 16 >= 240) cast.push(make('jellyfish', B, rj2));
    cast.push(make('ghost', session.sideA), make('tiger', B, rt), make('ladybird', B));
  } else if (mode === 'ledge') {
    cast.push(make('tiger', 0, rt), make('ladybird', 0), make('ghost', 0), make('jellyfish', 0, rj1));
  }
  drawOrder = (['ladybird', 'tiger', 'jellyfish', 'ghost'] as Kind[]).flatMap((k) => cast.filter((c) => c.kind === k));
  const fits = world && world.mode === mode && world.list.length === cast.length;
  cast.forEach((c, i) => {
    home(c);
    if (fits) {
      const [fx_, fy, asleep, side, dir] = world!.list[i];
      c.side = side;
      const z = sides[side];
      c.x = z.a + fx_ * (z.b - z.a);
      c.y = fy * (mode === 'margins' ? vh : ledge.h);
      c.dir = dir;
      orient(c);
      fit(c);
      if (asleep) bed(c, true);
    } else if (!rest && !world) enter(c);
  });
  lastStim = T;
}

// Point the sprite the way the critter faces (the steps do this while it's awake)
const orient = (c: Critter) =>
  (c.tf = c.kind === 'ladybird' ? (mode === 'ledge' ? (c.dir > 0 ? 3 : 4) : c.dir > 0 ? 0 : 2) : c.kind === 'jellyfish' || c.dir > 0 ? 0 : 1);

// Where each critter rests; also the still life under reduced motion
function home(c: Critter) {
  const z = sides[c.side];
  const mid = (z.a + z.b - c.w) / 2;
  const ledged = mode === 'ledge';
  c.vx = c.vy = 0;
  c.a = 1;
  c.asleep = false;
  c.wait = 0;
  c.fast = false;
  c.tf = 0;
  c.dir = 1;
  if (c.kind === 'jellyfish') {
    go(c, ledged ? 'hide' : 'swim');
    c.f = 'drift';
    c.x = z.a + (z.b - z.a - c.w) * 0.4;
    c.y = ledged ? ledge.h + 2 : vh * (c.side === session.sideA ? 0.55 : 0.3);
    if (ledged) c.asleep = true;
  } else if (c.kind === 'ghost') {
    go(c, ledged ? 'hide' : 'float');
    c.f = 'hem0';
    c.a = 0.92;
    c.side = mode === 'margins' ? 1 - session.sideA : 0;
    const zg = sides[c.side];
    c.x = c.side ? zg.a + 8 : zg.b - c.w - 8;
    c.dir = c.side ? -1 : 1; // facing the column
    c.y = ledged ? ledge.h + 2 : vh * 0.25;
    if (ledged) c.asleep = true;
  } else if (c.kind === 'tiger') {
    go(c, 'sit', rnd(3, 8));
    c.f = 'sit';
    c.x = ledged ? (ledge.w - c.w) * 0.3 : mid;
    c.y = floorY - c.h;
    c.near = T;
    c.next = T + rnd(2, 5);
  } else {
    go(c, 'rest', rnd(1, 3));
    c.f = 'rest';
    if (ledged) {
      c.x = (ledge.w - c.w) * 0.62;
      c.y = floorY - c.h;
      c.tf = 3;
    } else {
      c.x = z.wall - c.w / 2;
      c.y = floorY - 140 - c.h;
    }
  }
  orient(c);
}

function enter(c: Critter) {
  if (mode === 'margins') {
    if (c.kind === 'ladybird') {
      c.y = -c.h;
      go(c, 'crawl');
      c.dir = -1;
      c.tf = 2;
      c.fast = true;
    } else if (c.kind === 'tiger') {
      c.wait = 0.6;
      c.x = c.side ? vw : -c.w;
      c.tx = (sides[c.side].a + sides[c.side].b - c.w) / 2;
      go(c, 'walk');
      c.fast = true;
    } else if (c.kind === 'jellyfish') {
      c.wait = c.side === session.sideA ? 1.2 : 1.5;
      c.y = vh;
      c.fast = true;
    } else {
      c.wait = 1.8;
      c.a = 0;
      c.side = session.sideA;
      c.x = c.side ? sides[1].a + 20 : sides[0].b - c.w - 20;
      c.y = vh * 0.3;
    }
  } else if (mode === 'ledge' && (c.kind === 'tiger' || c.kind === 'ladybird')) {
    // Held back until the ledge first scrolls into view
    c.wait = ledgeSeen ? 0 : 1e9;
    c.fast = true;
    if (c.kind === 'tiger') {
      c.x = -c.w;
      c.tx = (ledge.w - c.w) * 0.3;
      go(c, 'walk');
    } else {
      c.x = ledge.w;
      c.tx = (ledge.w - c.w) * 0.62;
      c.dir = -1;
      c.tf = 4;
      go(c, 'crawl');
    }
  }
}

// Keep a critter inside its zone after a resize
function fit(c: Critter) {
  const frames = CAST[c.kind].frames as Record<string, string[]>;
  const f = frames[c.f] || Object.values(frames)[0];
  c.w = f[0].length * q;
  c.h = f.length * q;
  const z = sides[c.side];
  if (c.kind === 'ghost' && mode === 'margins') c.y = clamp(c.y, 0, vh - c.h);
  else if (c.kind === 'ladybird') {
    if (mode === 'margins') {
      c.x = z.wall - c.w / 2;
      c.y = clamp(c.y, 48, floorY - 12 - c.h);
    } else {
      c.x = clamp(c.x, 0, z.b - c.w);
      c.y = floorY - c.h;
    }
    return;
  } else if (c.kind === 'tiger') c.y = floorY - c.h;
  else if (mode === 'margins') c.y = clamp(c.y, 0, vh - c.h);
  if (!c.fast) c.x = clamp(c.x, z.a, z.b - c.w);
}

// ----------------------------------------------------------------------- loop

function wake() {
  const ok = live && on && !reduced && !printing && !document.hidden && mode !== 'none' && (mode === 'margins' || ledgeVisible);
  if (raf || !ok || allAsleep()) return;
  lastMs = performance.now();
  lastScroll = scrollY;
  root.dataset.critters = 'on';
  raf = requestAnimationFrame(frame);
}

function halt() {
  cancelAnimationFrame(raf);
  raf = 0;
}

const allAsleep = () => !held && !fx.length && cast.every((c) => c.asleep);

function frame(ms: number) {
  raf = 0;
  const dt = clamp((ms - lastMs) / 1000, 0, 0.05);
  lastMs = ms;
  const t0 = performance.now();
  T += dt;
  update(dt);
  draw();
  // Frame-budget guard: a device that can't keep up gets a quiet page instead
  if (performance.now() - t0 > 4) {
    slow = slow.filter((t) => T - t < 10).concat(T);
    if (slow.length >= 3) lightsOut();
  }
  if (allAsleep()) {
    root.dataset.critters = 'asleep';
    draw();
  } else wake();
}

function lightsOut() {
  lastStim = T - BEDTIME - 1;
  for (const c of cast) {
    if (c.st === 'rise' || c.st === 'hold' || c.st === 'sink') go(c, 'hide');
    if (c.kind === 'tiger') c.y = floorY - c.h;
    bed(c, true);
  }
  fx = [];
}

function update(dt: number) {
  const scroll = scrollY;
  const drift = clamp(scroll - lastScroll, -40, 40);
  lastScroll = scroll;
  const night = T - lastStim > BEDTIME;
  for (const c of cast) {
    if (c.wait > 0) {
      c.wait -= dt;
      continue;
    }
    c.t += dt;
    if (T > c.blinkAt) {
      c.blinkTo = T + 0.12;
      c.blinkAt = T + rnd(3, 6);
    }
    if (c.asleep) continue;
    // Jellyfish read as deeper than the text: they move a quarter of the scroll
    if (mode === 'margins' && c.kind === 'jellyfish' && c.st !== 'held') c.y -= 0.25 * drift;
    STEP[c.kind](c, dt, night);
  }
  social(night);
  fx = fx.filter((f) => ((f.age += dt), (f.y += f.vy * dt), f.age < f.life));
}

// Settle a critter for the night (or snap it there)
function bed(c: Critter, now = false) {
  if (c.st === 'hide') {
    c.asleep = true;
    return;
  }
  if (c.kind === 'tiger') {
    go(c, 'nap');
    c.f = 'sleep1';
  } else if (c.kind === 'ladybird') {
    go(c, 'rest');
    c.f = 'rest';
  } else if (now) c.f = 'sleep';
  else return go(c, 'bed');
  if (c.kind === 'ghost') c.a = 0.75;
  c.by = 0;
  c.asleep = true;
}

function rouse(c: Critter) {
  c.asleep = false;
  c.near = T;
  lastStim = T;
  if (c.kind === 'tiger') startle(c);
  else if (c.kind === 'jellyfish') (go(c, 'swim'), show(c, 'startle', 0.2));
  else if (c.kind === 'ghost') (go(c, 'float'), show(c, 'shy', 0.2), (c.a = 0.92), (c.next = T + 2));
  else go(c, 'crawl');
}

function startle(c: Critter, s = 0.3) {
  go(c, 'startled', s);
  c.f = 'startled';
  c.vy = -160;
  c.asleep = false;
}

// -------------------------------------------------------------------- physics

const move = (c: Critter, dt: number) => ((c.x += c.vx * dt), (c.y += c.vy * dt));
const decay = (v: number, half: number, dt: number) => v * 0.5 ** (dt / half);

function spring(c: Critter, k: number, d: number, dt: number) {
  c.vx += (k * (c.tx - c.x) - d * c.vx) * dt;
  c.vy += (k * (c.ty - c.y) - d * c.vy) * dt;
  move(c, dt);
}

function bounce(c: Critter, x0: number, x1: number, y0: number, y1: number, e: number) {
  if (c.x < x0) (c.x = x0), (c.vx = Math.abs(c.vx) * e);
  if (c.x > x1) (c.x = x1), (c.vx = -Math.abs(c.vx) * e);
  if (c.y < y0) (c.y = y0), (c.vy = Math.abs(c.vy) * e);
  if (c.y > y1) (c.y = y1), (c.vy = -Math.abs(c.vy) * e);
}

// Steer toward (tx, ty) at up to `speed`, easing in over the last 40 px.
// Returns true on arrival.
function steer(c: Critter, tx: number, ty: number, speed: number, dt: number) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 1.5) {
    c.vx = c.vy = 0;
    return true;
  }
  const v = speed * Math.min(1, d / 40);
  const acc = Math.max(20, speed * 2) * dt;
  c.vx += clamp((dx / d) * v - c.vx, -acc, acc);
  c.vy += clamp((dy / d) * v - c.vy, -acc, acc);
  move(c, dt);
  return false;
}

// The ghost's way of getting about: a target in the other margin means
// walking through the column, where there is no canvas, so the crossing is
// unseen and takes a fixed 1.2 s however wide the column is.
function glide(c: Critter, tx: number, ty: number, speed: number, dt: number) {
  if (mode !== 'margins') return steer(c, tx, ty, speed, dt);
  const to = tx + c.w / 2 > vw / 2 ? 1 : 0;
  if (to === c.side) return steer(c, clamp(tx, sides[to].a, sides[to].b - c.w), ty, speed, dt);
  const edge = c.side ? canvases[1].x - c.w : canvases[0].w; // just out of sight
  if (steer(c, edge, c.y, Math.max(speed, 30), dt) || (c.side ? c.x < edge : c.x > edge)) {
    c.resume = c.st;
    go(c, 'cross', 1.2);
  }
  return false;
}

// ---------------------------------------------------------------- behaviours

type Step = (c: Critter, dt: number, night: boolean) => void;

const jellyfish: Step = (c, dt, night) => {
  const z = sides[c.side];
  const bottom = mode === 'ledge' ? ledge.h : vh;
  const hovered = hoverC === c && ptr.on;
  switch (c.st) {
    case 'held':
      c.f = 'startle';
      c.tx = clamp(c.tx, z.a, z.b - c.w);
      c.ty = clamp(c.ty, 0, bottom - c.h);
      return spring(c, 90, 13, dt);
    case 'thrown':
      c.f = 'startle';
      c.vx = decay(c.vx, 0.25, dt);
      c.vy = decay(c.vy, 0.25, dt);
      move(c, dt);
      bounce(c, z.a, z.b - c.w, 0, bottom - c.h, 0.4);
      if (Math.hypot(c.vx, c.vy) < 30) go(c, mode === 'ledge' ? 'sink' : 'right'), (c.next = T);
      return;
    case 'right': // two quick pulses to right itself after a throw
      if (T >= c.next && c.t < 0.6) pulse(c, 34, 0.2), (c.next = T + 0.25);
      if (c.t > 0.6) go(c, 'swim');
      break;
    case 'bed': { // drifts to a spot above the floor the tiger naps on
      const spot = bottom - 72 - c.h;
      c.f = 'drift';
      c.vx = c.vy = 0;
      c.y += clamp(spot - c.y, -40 * dt, 40 * dt);
      if (Math.abs(spot - c.y) < 1) bed(c, true);
      return;
    }
    case 'hide':
      return;
    case 'rise': // ledge visitor: up from behind the footer rule
      c.y -= 26 * dt;
      c.f = (c.t * 4) % 2 < 1 ? 'pulse' : 'drift';
      if (c.y <= 8) go(c, 'hold', rnd(4, 6));
      return;
    case 'hold':
      c.f = c.t % 1 < 0.5 ? 'drift' : 'driftB';
      if (c.t > c.dur || night) go(c, 'sink');
      return;
    case 'sink':
      c.f = 'drift';
      c.y += 14 * dt;
      if (c.y >= ledge.h) go(c, 'hide'), (c.asleep = true);
      return;
    default:
      if (night) return bed(c);
      // Pulse and coast: a push up every couple of seconds, a slow sink between
      if (c.fast && c.y < vh * 0.6) c.fast = false;
      if (T >= c.next && (!hovered || T >= c.next + 6)) {
        if (c.y > bottom * 0.15) pulse(c, 34, 0.28);
        c.next = T + rnd(1.8, 2.6) * (c.y > bottom - c.h - 80 ? 0.6 : 1) * (c.fast ? 0.5 : 1);
      }
  }
  c.vy += (5 - c.vy) * (1 - 0.5 ** (dt / 0.6));
  c.vx = 8 * Math.sin(T * 0.571 + c.ph) * (hovered ? 0.3 : 1);
  move(c, dt);
  if (!c.fast) bounce(c, z.a, z.b - c.w, 0, bottom - c.h, 0.4);
  c.f = hovered ? 'happy' : c.t % 1 < 0.5 ? 'drift' : 'driftB';
};

function pulse(c: Critter, push: number, s: number) {
  c.vy = Math.min(c.vy, 0) - push;
  show(c, 'pulse', s);
}

const ghost: Step = (c, dt, night) => {
  const hem = 'hem' + (Math.floor(T / 0.14) % 4);
  const target = c.st === 'shy' ? 0.35 : c.st === 'gone' ? 0 : c.asleep ? 0.75 : 0.92;
  c.a = clamp(c.a + clamp(target - c.a, -3 * dt, (c.t < 1.3 && c.st === 'float' ? 0.8 : 2.5) * dt), 0, 1);
  c.by = /float|creep|stalkG|shy/.test(c.st) ? Math.round((3 * Math.sin(T * 2.42 + c.ph)) / q) * q : 0;
  if (Math.abs(c.vx) > 3) c.dir = Math.sign(c.vx);
  c.tf = c.dir < 0 ? 1 : 0;
  c.f = hem;
  const top = mode === 'ledge' ? 0 : vh * 0.1;
  switch (c.st) {
    case 'held':
      c.f = c.t < 0.6 ? 'boo' : 'happy';
      c.tx = clamp(c.tx, 0, (mode === 'margins' ? vw : ledge.w) - c.w);
      c.ty = clamp(c.ty, 0, (mode === 'margins' ? vh : ledge.h) - c.h);
      spring(c, 50, 9, dt);
      if (mode === 'margins') c.side = c.x + c.w / 2 > vw / 2 ? 1 : 0;
      return;
    case 'thrown':
      c.vx = decay(c.vx, 0.4, dt);
      c.vy = decay(c.vy, 0.4, dt);
      move(c, dt);
      bounce(c, 0, (mode === 'margins' ? vw : ledge.w) - c.w, 0, (mode === 'margins' ? vh : ledge.h) - c.h, 0.5);
      if (mode === 'margins') c.side = c.x + c.w / 2 > vw / 2 ? 1 : 0;
      if (Math.hypot(c.vx, c.vy) < 20) go(c, mode === 'ledge' ? 'sink' : 'float'), (c.next = T);
      return;
    case 'cross':
      if (c.t >= c.dur) {
        c.side = 1 - c.side;
        c.x = c.side ? canvases[1].x - c.w : canvases[0].w;
        go(c, c.resume);
      }
      return;
    case 'boo': // clicked: BOO!, then gone
      c.f = 'boo';
      if (c.t > 0.5) go(c, 'gone', rnd(2, 4));
      return;
    case 'gone':
      if (c.t > c.dur) {
        if (mode === 'ledge') return go(c, 'hide'), void (c.asleep = true);
        c.side = Math.random() < 0.5 ? 0 : 1;
        const z = sides[c.side];
        c.x = rnd(z.a, z.b - c.w);
        c.y = rnd(top, vh * 0.75 - c.h);
        go(c, 'float');
        c.next = T + rnd(3, 6);
      }
      return;
    case 'shy': // rushed: fade and dash away, through the column if that's the way out
      c.f = 'shy';
      glide(c, c.tx, c.ty, 140, dt);
      if (c.t > 0.8) go(c, 'float'), (c.next = T + rnd(2, 4));
      return;
    case 'creep': // a patient pointer: come close, look pleased
      c.f = 'happy';
      if (!patient() || night) return go(c, 'float');
      if (steer(c, ptr.x + (c.x > ptr.x ? 40 : -40 - c.w), clamp(ptr.y - c.h / 2, 0, vh - c.h), 20, dt) && c.dur === 0) {
        c.dur = 1;
        puff('heart', c.x + c.w / 2 - 2.5 * q, c.y - 7 * q, -24 / 0.9, 0.9);
      }
      return;
    case 'stalkG': { // sneaking up on the napping tiger
      const tg = find('tiger');
      if (!tg || tg.st !== 'nap') return go(c, 'float');
      const right = tg.x + tg.w + 6 + c.w <= sides[tg.side].b;
      if (glide(c, right ? tg.x + tg.w + 6 : tg.x - c.w - 6, tg.y + tg.h - c.h - 2, 60, dt) && c.side === tg.side) {
        c.dir = right ? -1 : 1;
        go(c, 'booT');
        puff('boo', c.x + c.w / 2 - 6.5 * q, c.y - 7 * q, 0, 0.6);
        tg.dir = right ? 1 : -1;
        startle(tg, 0.4);
        tg.cool = T + 1.9;
      }
      return;
    }
    case 'booT':
      c.f = c.t < 0.5 ? 'boo' : 'happy';
      if (c.t > 1.3) go(c, mode === 'ledge' ? 'sink' : 'float'), (c.next = T);
      return;
    case 'bed': {
      const z = sides[c.side];
      if (glide(c, c.side ? z.b - c.w : z.a, vh * 0.85 - c.h, 40, dt)) bed(c, true);
      return;
    }
    case 'hide':
      return;
    case 'rise': // ledge visitor: peeks up from behind the footer rule
      c.y = ledge.h - (0.75 * c.h * Math.min(1, c.t / 1.5));
      if (c.t >= 1.5) {
        const tg = find('tiger');
        if (c.dur && tg && tg.st === 'nap') {
          go(c, 'booT');
          puff('boo', c.x + c.w / 2 - 6.5 * q, c.y - 7 * q, 0, 0.6);
          startle(tg, 0.4);
        } else go(c, 'hold', rnd(3, 5));
      }
      return;
    case 'hold':
      if (c.t > c.dur || night) go(c, 'sink', 1.2);
      return;
    case 'sink':
      c.y += (c.dur ? (0.75 * c.h) / c.dur : 80) * dt;
      if (c.y >= ledge.h) go(c, 'hide'), (c.asleep = true);
      return;
    default: {
      if (night) return bed(c);
      const near = Math.hypot(ptr.x - (c.x + c.w / 2), ptr.y - (c.y + c.h / 2));
      if (ptr.on && near < 90 && closing(c) > 300) {
        // Away from the pointer; inward means out through the far margin
        const away = c.x + c.w / 2 > ptr.x ? 1 : -1;
        const out = (away > 0) === (c.side === 1);
        go(c, 'shy');
        const z = sides[out ? c.side : 1 - c.side];
        c.tx = out ? clamp(c.x + away * 112, z.a, z.b - c.w) : rnd(z.a, z.b - c.w);
        c.ty = clamp(c.y + (c.y > ptr.y ? 40 : -40), top, vh * 0.75);
        return;
      }
      if (ptr.on && near < 120 && patient()) return go(c, 'creep');
      if (T >= c.next) {
        const side = mode === 'margins' && Math.random() < 0.3 ? 1 - c.side : c.side;
        const z = sides[side];
        c.tx = rnd(z.a, z.b - c.w);
        c.ty = rnd(top, (mode === 'margins' ? vh * 0.75 : ledge.h) - c.h);
        c.next = T + rnd(6, 10);
      }
      glide(c, c.tx, c.ty, 14, dt);
    }
  }
};

const tiger: Step = (c, dt, night) => {
  const z = sides[c.side];
  const floor = floorY - c.h;
  const lo = z.a;
  const hi = z.b - c.w;
  const step = (period: number) => (Math.floor(c.t / period) % 2 ? 'walk2' : 'walk1');
  const face = (x: number) => (c.dir = x > c.x + c.w / 2 ? 1 : -1);
  const air = (g: number) => {
    c.vy += g * dt;
    move(c, dt);
    if (c.x < lo || c.x > hi) (c.x = clamp(c.x, lo, hi)), (c.vx *= -0.45);
    if (c.y < 0) (c.y = 0), (c.vy = Math.abs(c.vy) * 0.45);
    return c.y >= floor && c.vy > 0 && ((c.y = floor), (c.vy = c.vx = 0), true);
  };
  c.tf = c.dir < 0 ? 1 : 0;
  // The laser dot: a pointer low in the tiger's margin, within reach
  const pcx = ptr.x - c.w / 2;
  const inBand = ptr.on && ptr.x > z.a - 20 && ptr.x < z.b + 20 && ptr.y > floorY - 200 && ptr.y < floorY + 40;
  const idle = c.st === 'sit' || c.st === 'walk';
  if (!c.fast && idle && !night && inBand && T > c.cool && Math.hypot(ptr.x - ptr.cx, ptr.y - ptr.cy) > 20) {
    face(ptr.x);
    c.hunt = 0;
    if (Math.abs(pcx - c.x) <= 160) go(c, 'wiggle', rnd(0.5, 0.9));
    else go(c, 'chase');
  }
  switch (c.st) {
    case 'walk': {
      const speed = c.fast ? 40 : 22;
      c.f = step(0.17);
      face(c.tx);
      c.x += Math.sign(c.tx - c.x) * Math.min(speed * dt, Math.abs(c.tx - c.x));
      if (Math.abs(c.tx - c.x) < 1) {
        c.fast = false;
        if (c.resume === 'nap') return (c.resume = ''), go(c, 'nap'), void (c.f = 'sleep1');
        go(c, 'sit', rnd(3, 8));
      }
      return;
    }
    case 'chase':
      c.f = step(0.09);
      face(ptr.x);
      c.x = clamp(c.x + Math.sign(pcx - c.x) * 70 * dt, lo, hi);
      if (!inBand) go(c, 'sit', rnd(2, 4));
      else if (Math.abs(pcx - c.x) < 100) go(c, 'wiggle', rnd(0.5, 0.9));
      return;
    case 'stalk': { // creeping up on the ladybird
      const bug = find('ladybird');
      if (!bug || !reach(c, bug)) return go(c, 'sit', 1.5);
      const bx = bug.x + bug.w / 2 - c.w / 2;
      face(bug.x + bug.w / 2);
      c.f = step(0.25);
      c.x = clamp(c.x + Math.sign(bx - c.x) * 12 * dt, lo, hi);
      if (Math.abs(bx - c.x) < 60) go(c, 'wiggle', rnd(0.6, 1.2)), (c.tx = bx);
      return;
    }
    case 'wiggle': // crouch and wiggle the rump, then leap
      c.f = Math.floor(c.t / 0.12) % 2 ? 'crouch2' : 'crouch';
      if (!c.hunt) {
        if (!inBand) return go(c, 'sit', rnd(2, 4));
        c.tx = pcx;
        face(ptr.x);
      }
      if (c.t >= c.dur) {
        go(c, 'leap');
        c.vy = -300;
        c.vx = clamp((clamp(c.tx, lo, hi) - c.x) / 0.545, -200, 200);
        const bug = find('ladybird');
        if (c.hunt === 1 && bug) bug.cool = T + 0.425; // it always takes off just in time
      }
      return;
    case 'leap':
      c.f = 'leap';
      if (air(1100)) {
        go(c, 'land', 0.1);
        c.f = 'crouch';
      }
      return;
    case 'land':
      if (c.t < c.dur) return;
      if (c.resume === 'happy') return (c.resume = ''), go(c, 'happy', 0.6);
      if (!c.hunt && inBand && Math.abs(pcx - c.x) < 24) {
        // Caught the dot
        puff('heart', c.x + c.w / 2 - 2.5 * q, c.y - 6 * q, -24 / 0.9, 0.9);
        go(c, 'happy', 0.9);
        ptr.cx = ptr.x;
        ptr.cy = ptr.y;
        c.cool = T + 2.5;
      } else go(c, 'sit', c.hunt ? 1.5 : rnd(2, 5)), (c.cool = T + 1.2);
      c.hunt = 0;
      return;
    case 'happy':
      c.f = 'happy';
      if (c.t > c.dur) go(c, 'sit', rnd(3, 6));
      return;
    case 'startled':
      c.f = 'startled';
      if (air(1100) && c.t >= c.dur) go(c, 'sit', 1.5), (c.near = T);
      return;
    case 'held': // scruffed: limp, eyes shut
      c.f = 'walk1';
      c.tx = clamp(c.tx, lo, hi);
      c.ty = clamp(c.ty, 0, floor);
      spring(c, 150, 18, dt);
      return;
    case 'fall':
      c.f = Math.abs(c.vx) > 200 ? 'leap' : 'walk1';
      if (c.vx) c.dir = Math.sign(c.vx);
      c.vx *= 1 - 0.3 * dt;
      if (air(1400)) {
        // Always lands on its feet
        go(c, 'land', 0.12);
        c.f = 'crouch';
        c.resume = 'happy';
        c.cool = T + 0.8;
      }
      return;
    case 'nap':
      c.f = Math.floor(c.t) % 2 ? 'sleep2' : 'sleep1';
      if (T >= c.next) {
        puff('z', c.x + (c.dir > 0 ? c.w - 5 * q : 0), c.y - q, -8 / 1.5, 1.5);
        c.next = T + 2;
      }
      if (night) bed(c);
      return;
    default: // sit
      if (night) return bed(c);
      c.f = 'sit';
      if (T >= c.next) show(c, 'sitFlick', 0.28), (c.next = T + rnd(2, 5));
      if (c.t > c.dur) {
        if (T - c.near > 25 && mode === 'margins') {
          // Nap in the outer third of the floor
          c.tx = clamp(c.side ? hi - (hi - lo) / 6 : lo + (hi - lo) / 6, lo, hi);
          c.resume = 'nap';
          go(c, 'walk');
        } else if (T - c.near > 25) go(c, 'nap'), (c.f = 'sleep1');
        else {
          let x = rnd(lo, hi);
          if (Math.abs(x - c.x) < 40) x = clamp(c.x + (x > c.x ? 60 : -60), lo, hi);
          c.tx = x;
          go(c, 'walk');
        }
      }
  }
};

// Can the tiger get at the ladybird? It has to be low on the near wall, or close along the ledge.
const reach = (tg: Critter, bug: Critter) =>
  (bug.st === 'crawl' || bug.st === 'rest') &&
  (mode === 'ledge' ? Math.abs(bug.x - tg.x) < 120 : bug.side === tg.side && floorY - (bug.y + bug.h) < 72);

const ladybird: Step = (c, dt, night) => {
  const z = sides[c.side];
  const ledged = mode === 'ledge';
  const lo = ledged ? 0 : 48;
  const hi = ledged ? z.b - c.w : floorY - 12 - c.h;
  const near = ptr.on && Math.hypot(ptr.x - (c.x + c.w / 2), ptr.y - (c.y + c.h / 2)) < 40;
  const turn = () => (c.tf = ledged ? (c.dir > 0 ? 3 : 4) : c.dir > 0 ? 0 : 2);
  // A tiger's leap is about to land: off it goes
  if (c.cool && T >= c.cool) {
    c.cool = 0;
    if (ledged) flyTo(c, clamp(c.x + (c.x > find('tiger')!.x ? 1 : -1) * rnd(60, 100), 0, hi), c.y);
    else flyTo(c, c.x, clamp(c.y - rnd(80, 140), lo, hi));
  }
  switch (c.st) {
    case 'fly': {
      const [x0, y0, cx, cy, x1, y1] = c.path;
      // 150 px/s, but never more than about 1.2 s: a flight across the column is mostly out of sight
      const len = Math.max(20, Math.hypot(x1 - x0, y1 - y0));
      c.u = Math.min(1, c.u + (dt * Math.max(150, len / 1.2)) / len);
      const u = c.u;
      const nx = (1 - u) ** 2 * x0 + 2 * (1 - u) * u * cx + u * u * x1;
      const ny = (1 - u) ** 2 * y0 + 2 * (1 - u) * u * cy + u * u * y1;
      c.dir = ledged ? Math.sign(nx - c.x) || c.dir : ny > c.y ? -1 : 1;
      c.x = nx;
      c.y = ny;
      c.f = Math.floor(c.t / 0.05) % 2 ? 'flyB' : 'flyA';
      turn();
      if (u >= 1) {
        if (!ledged) c.side = c.x + c.w / 2 > vw / 2 ? 1 : 0;
        go(c, followEl ? 'follow' : 'rest', 1);
      }
      return;
    }
    case 'found':
      c.f = 'rest';
      if (c.t > 0.4) {
        if (ledged) {
          const d = rnd(150, 300) * (c.x > ledge.w / 2 ? -1 : 1);
          flyTo(c, clamp(c.x + d, 0, hi), c.y);
        } else if (Math.random() < 0.5) {
          const other = sides[1 - c.side];
          flyTo(c, other.wall - c.w / 2, clamp(c.y + rnd(-150, 150), lo, hi));
        } else {
          const d = rnd(150, 300) * (c.y - lo > hi - c.y ? -1 : 1);
          flyTo(c, c.x, clamp(c.y + d, lo, hi));
        }
      }
      return;
    case 'follow': { // keeps level with keyboard focus, like a bookmark
      if (night) return bed(c);
      if (!followEl || ledged) return go(c, 'crawl');
      const r = followEl.getBoundingClientRect();
      const ty = clamp(r.top + r.height / 2 - c.h / 2, lo, hi);
      if (Math.abs(ty - c.y) > 200) return flyTo(c, z.wall - c.w / 2, ty);
      const d = ty - c.y;
      c.dir = d < 0 ? 1 : -1;
      turn();
      c.f = Math.abs(d) > 1 ? (Math.floor(c.t / 0.15) % 2 ? 'walkB' : 'walkA') : 'rest';
      c.y += Math.sign(d) * Math.min(50 * dt, Math.abs(d));
      return;
    }
    case 'freeze':
      if (night) return bed(c);
      c.f = 'rest';
      if (near) c.t = 0;
      else if (c.t > 0.5) go(c, 'crawl');
      return;
    case 'rest':
      if (night) return bed(c);
      c.f = 'rest';
      if (near) return go(c, 'freeze');
      if (c.t > c.dur) {
        if (Math.random() < 0.5) c.dir = -c.dir;
        go(c, 'crawl');
        c.next = T + rnd(3, 8);
      }
      return;
    default: { // crawl
      if (night && !c.fast) return bed(c);
      if (near && !c.fast) return go(c, 'freeze');
      const speed = c.fast ? 40 : 12;
      c.f = Math.floor(c.t / 0.15) % 2 ? 'walkB' : 'walkA';
      turn();
      if (ledged) {
        if (c.fast) {
          c.x -= speed * dt;
          if (c.x <= c.tx) c.fast = false;
        } else c.x += c.dir * speed * dt;
        if (!c.fast && (c.x <= lo || c.x >= hi)) (c.x = clamp(c.x, lo, hi)), (c.dir = -c.dir);
      } else {
        c.y -= c.dir * speed * dt;
        if (c.fast && c.y >= vh * 0.3) c.fast = false;
        if (!c.fast && (c.y <= lo || c.y >= hi)) (c.y = clamp(c.y, lo, hi)), (c.dir = -c.dir);
      }
      if (!c.fast && T >= c.next) go(c, 'rest', rnd(1, 4));
    }
  }
};

function flyTo(c: Critter, x1: number, y1: number) {
  const mx = (c.x + x1) / 2;
  const my = (c.y + y1) / 2;
  // The arc bows toward open space: outward in a margin, up over the ledge
  const across = mode === 'margins' && Math.abs(x1 - c.x) > 40;
  const cx = mode === 'ledge' || across ? mx : mx + (c.side ? 40 : -40);
  const cy = mode === 'ledge' || across ? my - 40 : my;
  c.path = [c.x, c.y, cx, cy, x1, y1];
  c.u = 0;
  go(c, 'fly');
}

const STEP: Record<Kind, Step> = { jellyfish, ghost, tiger, ladybird };

// What happens between critters, with nobody touching anything
function social(night: boolean) {
  const g = find('ghost');
  const tg = find('tiger');
  const bug = find('ladybird');
  if (night || !tg) return;
  // The ghost sneaks up on the napping tiger and boos it, now and then
  if (mode === 'margins' && g && g.st === 'float' && tg.st === 'nap' && tg.t > 8 && T - lastStim > 5 && T - lastBoo > 90 && boos < 2) {
    go(g, 'stalkG');
    lastBoo = T;
    boos++;
  }
  // The tiger hunts the ladybird, and always misses
  if (bug && !tg.fast && (tg.st === 'sit' || tg.st === 'walk') && T - lastHunt > 8 && reach(tg, bug)) {
    go(tg, 'stalk');
    tg.hunt = 1;
    lastHunt = T;
  }
  // On the ledge the ghost and the jellyfish take turns visiting
  if (mode === 'ledge' && ledgeSeen && T >= nextVisit && g && g.st === 'hide') {
    const jf = find('jellyfish')!;
    const v = visitor === 'ghost' ? g : jf;
    if (v.st !== 'hide') return;
    visitor = visitor === 'ghost' ? 'jellyfish' : 'ghost';
    nextVisit = T + rnd(20, 40) + 10;
    v.asleep = false;
    v.y = ledge.h;
    v.a = v.kind === 'ghost' ? 0.92 : 1;
    // Beside a napping tiger, the ghost comes up to boo it
    const boo = v.kind === 'ghost' && tg.st === 'nap';
    v.x = boo ? clamp(tg.x + tg.w + 6, 0, ledge.w - v.w) : tg.x < ledge.w / 2 ? rnd(0.6, 0.85) * (ledge.w - v.w) : rnd(0.15, 0.4) * (ledge.w - v.w);
    v.dir = v.x > tg.x ? -1 : 1;
    go(v, 'rise', +boo);
  }
}

// ---------------------------------------------------------------------- input

const toWorld = (cx: number, cy: number) => (mode === 'ledge' ? [cx + scrollX - ledge.x, cy + scrollY - ledge.y] : [cx, cy]);

// Is (x, y) on one of the canvases? Critters are only real where they can be seen.
const onCanvas = (x: number, y: number) => canvases.some((cv) => x >= cv.x && x < cv.x + cv.w && y >= cv.y && y < cv.y + cv.h);

// The topmost critter at (x, y). Mice and pens hit the critter's own pixels
// (one pixel of slack); a finger gets the box plus 14 px.
function hit(x: number, y: number, touch: boolean) {
  if (!onCanvas(x, y)) return null;
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const c = drawOrder[i];
    if (!visible(c)) continue;
    const top = c.y + c.by;
    if (touch) {
      if (x > c.x - 14 && x < c.x + c.w + 14 && y > top - 14 && y < top + c.h + 14) return c;
      continue;
    }
    const gx = Math.floor((x - c.x) / q);
    const gy = Math.floor((y - top) / q);
    const grid = CAST[c.kind].frames[frameOf(c) as never] as string[];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (pixel(grid, c.tf, false, gx + dx, gy + dy) !== '.') return c;
  }
  return null;
}

// Moving the pointer in the critters' own space counts as company; reading
// with the pointer parked over the text does not.
function inTheirSpace(cx: number, cy: number) {
  if (mode === 'margins') return cx < canvases[0].w || cx >= canvases[1].x;
  const [x, y] = toWorld(cx, cy);
  return x > -40 && x < ledge.w + 40 && y > -40 && y < ledge.h + 40;
}

function onMove(e: PointerEvent) {
  if (!e.isPrimary || mode === 'none') return;
  const [x, y] = toWorld(e.clientX, e.clientY);
  const mouse = e.pointerType !== 'touch';
  const now = e.timeStamp;
  ptr.samples = ptr.samples.filter((s) => now - s[0] < 100).concat([[now, x, y]]);
  const [t0, x0, y0] = ptr.samples[0];
  const span = Math.max(16, now - t0) / 1000;
  ptr.vx = (x - x0) / span;
  ptr.vy = (y - y0) / span;
  ptr.x = x;
  ptr.y = y;
  ptr.t = now;
  if (Math.hypot(x - ptr.ax, y - ptr.ay) > 20) (ptr.ax = x), (ptr.ay = y), (ptr.at = now);
  if (down && !held && down.c && down.type !== 'touch' && !reduced && down.c.kind !== 'ladybird' && Math.hypot(x - down.x, y - down.y) > 4) grab(down.c);
  if (held) {
    held.tx = x - down!.dx;
    held.ty = y - down!.dy;
    return;
  }
  ptr.on = mouse && inTheirSpace(e.clientX, e.clientY);
  if (!inTheirSpace(e.clientX, e.clientY)) return hover(null);
  lastStim = T;
  for (const c of cast) {
    if (Math.hypot(x - (c.x + c.w / 2), y - (c.y + c.h / 2)) < 200) {
      c.near = T;
      if (c.asleep && c.st !== 'hide') rouse(c);
    }
  }
  if (mouse) hover(hit(x, y, false) || (overTag(e.clientX, e.clientY) ? tagFor : null));
  wake();
}

function overTag(cx: number, cy: number) {
  if (!tag || tag.hidden || tag.style.visibility === 'hidden') return false;
  const r = tag.getBoundingClientRect();
  return cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom;
}

// The pointer has kept within 20 px for 1.5 s
const patient = () => ptr.on && performance.now() - ptr.at > 1500;

// How fast the pointer is closing on a critter, px/s
function closing(c: Critter) {
  if (performance.now() - ptr.t > 120) return 0;
  const dx = c.x + c.w / 2 - ptr.x;
  const dy = c.y + c.h / 2 - ptr.y;
  const d = Math.hypot(dx, dy) || 1;
  return (ptr.vx * dx + ptr.vy * dy) / d;
}

function onDown(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0 || mode === 'none') return;
  if (e.target instanceof Element && e.target.closest(IGNORE)) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;
  const [x, y] = toWorld(e.clientX, e.clientY);
  const touch = e.pointerType === 'touch';
  const c = hit(x, y, touch);
  down = { c, x, y, t: e.timeStamp, type: e.pointerType, dx: c ? x - c.x : 0, dy: c ? y - c.y : 0 };
  // Only a mouse or pen press on a critter you can pick up is kept from the
  // page. Touch is never prevented, so scrolling and selection always work.
  if (c && !touch && !reduced && c.kind !== 'ladybird') {
    e.preventDefault();
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* fine without capture */
    }
  }
}

function grab(c: Critter) {
  held = c;
  c.asleep = false;
  c.tx = c.x;
  c.ty = c.y;
  c.vx = c.vy = 0;
  c.by = 0;
  go(c, 'held');
  hover(null);
  root.classList.add('critters-grabbing');
  lastStim = T;
  wake();
}

function onUp(e: PointerEvent) {
  if (!down || !e.isPrimary) return;
  const d = down;
  down = null;
  root.classList.remove('critters-grabbing');
  const [x, y] = toWorld(e.clientX, e.clientY);
  if (held) {
    const c = held;
    held = null;
    // Fling with the last 100 ms of movement; slow is just a drop
    const fresh = e.type !== 'pointercancel' && e.timeStamp - ptr.t < 100;
    let vx = fresh ? ptr.vx : 0;
    let vy = fresh ? ptr.vy : 0;
    const sp = Math.hypot(vx, vy);
    if (sp > 2000) (vx *= 2000 / sp), (vy *= 2000 / sp);
    if (sp < 300) vx = vy = 0;
    c.vx = vx;
    c.vy = vy;
    go(c, c.kind === 'tiger' ? 'fall' : 'thrown');
    lastStim = T;
    return wake();
  }
  if (e.type === 'pointercancel') return;
  const moved = Math.hypot(x - d.x, y - d.y);
  const ms = e.timeStamp - d.t;
  const touch = d.type === 'touch';
  if (!(touch ? moved < 10 && ms < 500 : moved < 4 && ms < 250)) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;
  if (d.c) return poke(d.c);
  // A tap on the tiger's floor: it pounces there
  const tg = find('tiger');
  if (touch && tg && !reduced && onCanvas(x, y) && y > floorY - 140 && (mode === 'ledge' || (x > sides[tg.side].a - 20 && x < sides[tg.side].b + 20))) {
    if (tg.asleep || tg.st === 'nap') return rouse(tg), wake();
    if (tg.st === 'sit' || tg.st === 'walk') {
      tg.tx = x - tg.w / 2;
      tg.hunt = 2; // aimed at a spot, not the pointer
      tg.dir = x > tg.x ? 1 : -1;
      go(tg, 'wiggle', 0.3);
      lastStim = T;
      wake();
    }
  }
}

// A click or tap on a critter
function poke(c: Critter) {
  lastStim = T;
  c.near = T;
  if (reduced) {
    // A change of picture, never movement
    if (c.kind === 'ladybird') return found(c);
    c.pose = 'happy';
    c.poseTo = Infinity;
    if (c.kind === 'tiger') puff('heart', c.x + c.w / 2 - 2.5 * q, c.y - 6 * q, 0, 1e9);
    draw();
    setTimeout(() => {
      c.poseTo = 0;
      fx = [];
      draw();
    }, 1500);
    return;
  }
  const wasAsleep = c.asleep || c.st === 'nap';
  c.asleep = false;
  if (c.kind === 'jellyfish') {
    if (mode === 'ledge') {
      show(c, 'happy', 1.2);
      go(c, 'sink');
    } else {
      go(c, 'swim');
      c.vy = -90;
      show(c, 'pulse', 0.4);
      setTimeout(() => show(c, 'happy', 1.2), 400);
    }
    c.glowTo = T + 0.4;
    for (let i = 0; i < 3; i++) puff('bubble', c.x + c.w / 2 + (i - 1) * 3 - 1.5 * q, c.y - (2 + i * 2) * q, -20, 1.2 - i * 0.12);
  } else if (c.kind === 'ghost') {
    puff('boo', c.x + c.w / 2 - 6.5 * q, c.y + c.by - 7 * q, 0, 0.6);
    if (mode === 'ledge') go(c, 'sink'), show(c, 'boo', 0.5);
    else go(c, 'boo');
  } else if (c.kind === 'tiger') {
    if (wasAsleep) startle(c);
    else if (c.st !== 'leap' && c.st !== 'fall') {
      go(c, 'happy', 0.9);
      puff('heart', c.x + c.w / 2 - 2.5 * q, c.y - 6 * q, -24 / 0.9, 0.9);
    }
  } else found(c);
  wake();
}

function found(c: Critter) {
  session.bugs++;
  const d = new Date();
  showTag(c, `BUG ${pad(session.bugs)} FOUND\n${pad(d.getHours())}:${pad(d.getMinutes())}`, 2500);
  if (!reduced) go(c, 'found');
}

function onFocus(e: FocusEvent) {
  const el = e.target;
  if (mode !== 'margins' || reduced || !(el instanceof Element) || !el.matches('a,button') || !el.matches(':focus-visible')) return;
  const bug = find('ladybird');
  const tg = find('tiger');
  if (!bug) return;
  followEl = el;
  bug.asleep = false;
  if (bug.st !== 'fly') go(bug, 'follow');
  if (tg && (tg.st === 'sit' || tg.st === 'walk')) tg.dir = bug.side ? 1 : -1;
  lastStim = T;
  wake();
}

// ----------------------------------------------------------------------- tags

function hover(c: Critter | null) {
  if (c === hoverC) return;
  hoverC = c;
  root.style.cursor = c ? (c.kind === 'ladybird' || reduced ? 'pointer' : 'grab') : '';
  clearTimeout(tagTimer);
  tagTimer = window.setTimeout(() => showTag(c), c ? 600 : 1200);
}

const label = (c: Critter) =>
  `${NAMES[c.kind]}\n${c.asleep ? (c.kind === 'tiger' ? 'NAPPING' : 'ASLEEP') : c.kind === 'jellyfish' && frameOf(c) === 'pulse' ? 'PULSING' : WORDS[c.st] || IDLE_WORD[c.kind]}${c.rare ? ' · RARE' : ''}`;

// The tag beside a critter, in the site's label style. Always in open space:
// it is placed inside the critter's canvas or not at all. A "found" tag
// (ms > 0) holds for its time; hover tags wait for it.
function showTag(c: Critter | null, text = '', ms = 0) {
  if (!ms && performance.now() < tagHold) return;
  tagHold = ms ? performance.now() + ms : 0;
  tagFor = c;
  tagText = text;
  if (!tag) {
    tag = document.createElement('span');
    tag.className = 'critter-tag label no-print';
    tag.setAttribute('aria-hidden', 'true');
    document.body.append(tag);
  }
  tag.hidden = !c;
  if (ms) {
    clearTimeout(foundTimer);
    foundTimer = window.setTimeout(() => ((tagHold = 0), showTag(hoverC)), ms);
  }
  placeTag();
}

function placeTag() {
  if (!tag || !tagFor || tag.hidden) return;
  const c = tagFor;
  const text = tagText || label(c);
  if (tag.textContent !== text) {
    tag.textContent = text;
    tagSize = [tag.offsetWidth, tag.offsetHeight];
  }
  const cv = canvases.find((v) => c.x + c.w / 2 >= v.x && c.x + c.w / 2 < v.x + v.w);
  const [tw, th] = tagSize;
  if (!cv || tw > cv.w - 8 || !visible(c)) return void (tag.style.visibility = 'hidden');
  let left = clamp(c.x + c.w / 2 - tw / 2, cv.x + 4, cv.x + cv.w - 4 - tw);
  let top = c.y + c.by - th - 8;
  if (top < cv.y + 2) top = c.y + c.h + 8;
  if (mode === 'ledge' && top < 0) {
    // No room above on the ledge: beside it instead
    top = clamp(c.y, 0, cv.h - th);
    left = c.x + c.w + 6 + tw < cv.w ? c.x + c.w + 6 : c.x - tw - 6;
    if (left < 0) return void (tag.style.visibility = 'hidden');
  }
  if (top + th > cv.y + cv.h) return void (tag.style.visibility = 'hidden');
  tag.classList.toggle('in-ledge', mode === 'ledge');
  tag.style.visibility = '';
  tag.style.left = `${mode === 'ledge' ? left + ledge.x : left}px`;
  tag.style.top = `${mode === 'ledge' ? top + ledge.y : top}px`;
}

// ---------------------------------------------------------------------- draw

function draw() {
  for (const cv of canvases) {
    const items: [Img, number, number, number][] = [];
    let sig = '';
    const add = (im: Img | null, x: number, y: number, a: number) => {
      if (!im || a <= 0.01) return;
      const px = Math.round((x - cv.x) / q) - 1;
      const py = Math.round((y - cv.y) / q) - 1;
      if (px >= cv.el.width || py >= cv.el.height || px + im.width <= 0 || py + im.height <= 0) return;
      items.push([im, px, py, a]);
      sig += `${im.k}${px},${py},${Math.round(a * 20)};`;
    };
    for (const c of drawOrder) {
      if (!visible(c)) continue;
      const y = c.y + c.by;
      const a = c.a * fade(c);
      if (dark) add(sprite(c, true), c.x, y, (T < c.glowTo ? 0.38 : c.kind === 'jellyfish' ? 0.16 : 0.12) * a);
      add(sprite(c), c.x, y, a);
      if (c.asleep && c.kind !== 'ladybird') {
        const zx = c.kind === 'tiger' ? c.x + (c.dir > 0 ? c.w - 5 * q : 0) : c.x + c.w - 2 * q;
        add(glyph('z'), clamp(zx, q, (mode === 'ledge' ? ledge.w : vw) - 6 * q), c.y - (c.kind === 'tiger' ? q : 6 * q), 1);
      }
    }
    for (const f of fx) add(glyph(f.g), f.x, f.y, f.age < f.life / 2 ? 1 : 2 * (1 - f.age / f.life));
    if (sig === cv.sig) continue;
    cv.sig = sig;
    cv.ctx.clearRect(0, 0, cv.el.width, cv.el.height);
    for (const [im, px, py, a] of items) {
      cv.ctx.globalAlpha = a;
      cv.ctx.drawImage(im, px, py);
    }
    cv.ctx.globalAlpha = 1;
  }
  placeTag();
}

// The ghost fades as it nears the column, so it phases through the wall
// rather than being cut off at the canvas edge
function fade(c: Critter) {
  if (c.kind !== 'ghost' || mode !== 'margins') return 1;
  const gap = Math.max(canvases[0].w - (c.x + c.w), c.x - canvases[1].x);
  return clamp(gap / 12, 0, 1);
}

// Reduced motion: one still picture, redrawn only on resize, theme change or a poke
function still() {
  halt();
  fx = [];
  for (const c of cast) {
    home(c);
    if (mode === 'ledge' && (c.kind === 'ghost' || c.kind === 'jellyfish')) c.st = 'hide';
  }
  root.dataset.critters = 'still';
  draw();
}
