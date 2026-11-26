// The critters: a jellyfish, a ghost, a tiger cub and a ladybird. Decoration
// only: every canvas is aria-hidden and painted under the page, so the text is
// always on top. On wide screens two canvases cover the window. The jellyfish,
// the ghost and the ladybird keep to the margins; the tiger climbs the text,
// standing on the tops of lines, headings and rules wherever there is room
// above them, so it never stops behind a word. When the text fills the screen
// they wait in the gap above the footer rule (the "ledge"), and once the
// reader gets there the tiger climbs back up the page. The page reads the
// same without this script.
//
// One canvas pixel is one sprite pixel; the browser scales each canvas up by a
// whole number of device pixels, so the art stays sharp at any zoom or DPR.
// Sprites live in ./sprites.ts. The colophon explains the why.
import { CAST, VARIANTS, GLYPHS, CLIMB, type Palette } from './sprites';

type Kind = keyof typeof CAST;
type Img = HTMLCanvasElement & { k: string };

interface Critter {
  kind: Kind;
  x: number; // top-left, CSS px in world space (the window in margins mode, ledge-local on the ledge)
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
  resume: string; // the tiger's next move: 'jump' or 'climb' once it has walked into place, 'happy' after a fall
  tf: number; // transform, see pixel()
  pl: Plat | null; // the tiger: what it stands on
  to: Plat | null; // the tiger: where it's jumping or climbing to
  cx: number; // the tiger: where a jump lands, or the x of the climb
  away: number; // the tiger: seconds out of view
  up: boolean; // the tiger: working its way up the page (or back down)
  ct: number; // the tiger: how it's turned on this climb
}

// A move from where the tiger stands: where to, the x of the climb, and which
// way the climber is turned (4: wall on its right, 5: on its left; 0 for a jump)
type Way = [Plat, number, number];

// Somewhere the tiger can stand: a run of open space along the top of a line
// of text, a heading or a rule. Document px when d is 1, world px when 0 (on
// the ledge the world is the page, measured from the ledge's corner).
interface Plat {
  l: number;
  r: number;
  y: number;
  d: number;
}

interface Canvas {
  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  x: number; // world rect
  y: number;
  w: number;
  h: number;
  sig: string; // what was drawn last; unchanged means no redraw. '-' forces one, even of nothing
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
let col = { l: 0, r: 0 }; // the column, rail included
let plats: Plat[] = [];
let ink: number[][] = []; // l, t, r, b in document px: text and pictures, never to be stood in front of
let skip: Plat | null = null; // where the tiger is stepping off, so it doesn't land back on it
let ground: Plat | null = null; // the ledge's floor
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
  if (import.meta.env.DEV) Object.assign(window, { critters: { get cast() { return cast; }, get mode() { return mode; }, get T() { return T; }, get plats() { return plats; }, get ink() { return ink; }, get ptr() { return ptr; }, terrain, ways: () => ways(find('tiger')!), plan: (w: Way) => plan(find('tiger')!, w) } });
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
  terrain();
  layout();
  lastScroll = scrollY;
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
  win('scroll', onScroll);
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
  const ok = s && s.v === 2 && (s.sideA === 0 || s.sideA === 1) && Array.isArray(s.rare) && s.rare.length === 3 && Number.isFinite(s.bugs);
  if (!ok) return { v: 2, sideA: Math.random() < 0.5 ? 0 : 1, rare: [Math.random() < 1 / 40, Math.random() < 1 / 50, Math.random() < 1 / 50], bugs: 0 };
  const w = s.world;
  const entry = (e: unknown) => Array.isArray(e) && e.length === 5 && e.every(Number.isFinite) && (e[3] === 0 || e[3] === 1);
  if (w && !(Date.now() - w.t < 30 * 60e3 && Array.isArray(w.list) && w.list.every(entry))) delete s.world;
  return s;
}

// Written on pagehide (never unload, so the back/forward cache still works).
// Positions are fractions of each critter's own zone, and the tiger's is its
// place in the window, so the next page puts a napping tiger back in the same
// spot, on whatever is there.
function save() {
  if (!live || mode === 'none') return;
  const span = mode === 'margins' ? vh : ledge.h;
  session.world = {
    t: Date.now(),
    mode,
    list: cast.map((c) => {
      // The tiger is wherever it stood in the window (the bottom middle of
      // what is drawn; a climber is on its side)
      if (c.kind === 'tiger') {
        const up = c.st === 'climb';
        const [vl, vt] = view();
        return [+((c.x - vl + (up ? c.h : c.w) / 2) / vw).toFixed(3), +((c.y - vt + (up ? c.w : c.h)) / vh).toFixed(3), +(c.asleep || c.st === 'nap'), 0, c.dir];
      }
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
  col = { l: cl, r: cr };
  if (room >= 120) {
    mode = 'margins';
    scale(room >= 200 ? 4 : room >= 150 ? 3.5 : 3);
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
  scale(2.5);
  const x = fr.left + parseFloat(fs.paddingLeft);
  const w = Math.floor((fr.right - parseFloat(fs.paddingRight) - x) / q) * q;
  const h = Math.floor(gap / q) * q;
  ledge = { x: Math.round((x + scrollX) * dpr) / dpr, y: Math.round((fr.top + scrollY - h) * dpr) / dpr, w, h };
  sides = [{ a: 0, b: w, wall: 0 }];
  sides[1] = sides[0];
  floorY = h;
}

// The tiger's terrain, in document px: every line of text, picture and rule
// it must never stand in front of (ink), and the open runs along their tops
// with room above for it to stand (plats), top to bottom, then the floor of
// each margin. On the ledge it has only the ledge's floor.
function terrain() {
  const tw = CAST.tiger.frames.sit[0].length * q;
  const th = CAST.tiger.frames.sit.length * q;
  const sx = scrollX;
  const sy = scrollY;
  const tops: number[][] = []; // l, r, y
  const fonts = new Map<string, number[]>();
  const pen = document.createElement('canvas').getContext('2d')!;
  const range = document.createRange();
  const box = (el: Element) => el.getBoundingClientRect();
  ink = [];
  plats = [];
  ground = null;
  if (mode === 'none') return;
  // Lines of text: from the tops of the tallest letters to the bottoms of the descenders
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n: Node | null; (n = walk.nextNode()); ) {
    const el = n.parentElement;
    if (!el || !n.nodeValue!.trim() || el.closest('script,style,pre,.visually-hidden,.critter-tag')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let m = fonts.get(font);
    if (!m) {
      pen.font = font;
      const a = pen.measureText('Hd');
      fonts.set(font, (m = [a.fontBoundingBoxAscent, a.actualBoundingBoxAscent, pen.measureText('gjpy').actualBoundingBoxDescent]));
    }
    range.selectNodeContents(n);
    for (const b of range.getClientRects()) {
      if (b.width < 2) continue;
      const base = b.top + sy + (m[0] || b.height * 0.8);
      ink.push([b.left + sx, base - m[1], b.right + sx, base + m[2]]);
      tops.push([b.left + sx, b.right + sx, base - m[1] - 1]);
    }
  }
  // Pictures and code blocks are ink, and some can be stood on
  for (const el of document.querySelectorAll('main img,main svg,main video,main pre,main table,main iframe,main hr')) {
    const b = box(el);
    if (!b.width) continue;
    ink.push([b.left + sx, b.top + sy, b.right + sx, b.bottom + sy]);
    if (!el.matches('svg,table,iframe')) tops.push([b.left + sx, b.right + sx, b.top + sy - 1]);
  }
  // Rules drawn as borders (the lines between rows of links, table rules)
  for (const el of document.querySelectorAll('main *')) {
    const cs = getComputedStyle(el);
    const b = box(el);
    if (b.width < tw) continue;
    if (parseFloat(cs.borderTopWidth) && cs.borderTopStyle !== 'none') tops.push([b.left + sx, b.right + sx, b.top + sy - 1]);
    if (parseFloat(cs.borderBottomWidth) && cs.borderBottomStyle !== 'none') tops.push([b.left + sx, b.right + sx, b.bottom + sy - parseFloat(cs.borderBottomWidth) - 1]);
  }
  // The ruler under the header, the rule over the footer, and the short rule
  // over each section number in the rail
  const hd = document.querySelector('.site-header');
  const ft = document.querySelector('.site-footer');
  if (hd) tops.push([col.l, col.r, box(hd).bottom + sy - 2]);
  if (ft && mode === 'margins') tops.push([col.l, col.r, box(ft).top + sy - 1]);
  for (const h of document.querySelectorAll('main h2')) {
    const ps = getComputedStyle(h, '::before');
    if (ps.content === 'none') continue;
    const b = box(h);
    const fs = parseFloat(ps.fontSize);
    // The number itself is ink: in the rail under its rule, or above the heading
    const L = b.left + sx + (ps.position === 'absolute' ? parseFloat(ps.left) : 0);
    const T = b.top + sy + (ps.position === 'absolute' ? parseFloat(ps.top) + parseFloat(ps.borderTopWidth) + parseFloat(ps.paddingTop) : 0);
    ink.push([L, T, L + 3 * fs, T + 1.2 * fs]);
    if (ps.position === 'absolute') tops.push([L, L + parseFloat(ps.width), b.top + sy + parseFloat(ps.top) - 1]);
  }
  ink.sort((a, b) => a[1] - b[1]);
  // Join pieces of one line (a link, a word in italics), then keep the runs with headroom
  tops.sort((a, b) => Math.round(a[2] / 6) - Math.round(b[2] / 6) || a[0] - b[0]);
  const lines: number[][] = [];
  for (const t of tops) {
    const m = lines[lines.length - 1];
    if (m && Math.round(m[2] / 6) === Math.round(t[2] / 6) && t[0] - m[1] < 12) (m[1] = Math.max(m[1], t[1])), (m[2] = Math.min(m[2], t[2]));
    else lines.push([...t]);
  }
  for (const [l, r, y] of lines) {
    if (y - th < 0) continue;
    let free = [[Math.max(l, 2), Math.min(r, vw - 2)]];
    for (const b of ink) {
      if (b[1] >= y) break;
      if (b[3] <= y - th || b[2] < l - 4 || b[0] > r + 4) continue;
      free = free.flatMap(([a, c]) => [[a, Math.min(c, b[0] - 4)], [Math.max(a, b[2] + 4), c]]).filter(([a, c]) => c - a >= tw);
      if (!free.length) break;
    }
    for (const [a, c] of free) if (c - a >= tw) plats.push({ l: a, r: c, y, d: 1 });
  }
  plats.sort((a, b) => a.y - b.y);
  if (mode === 'ledge') {
    // Into the ledge's coordinates, which scroll with the page; the rule above the footer is the floor
    const { x, y } = ledge;
    plats = plats.map((p) => ({ l: p.l - x, r: p.r - x, y: p.y - y, d: 0 }));
    ink = ink.map((b) => [b[0] - x, b[1] - y, b[2] - x, b[3] - y]);
    plats.push((ground = { l: 0, r: ledge.w, y: floorY, d: 0 }));
  }
  // And the bottom of the window in each margin, for a tiger thrown out there
  else for (const z of sides) plats.push({ l: z.a, r: z.b, y: floorY, d: 0 });
}

// Make (or reuse) the canvases for the current mode
function layout() {
  const want: number[][] = []; // world x, y, w, h, then style left, top
  if (mode === 'margins') {
    // Two over the window: one for whatever goes with the window, and one a
    // sprite pixel taller for the tiger on the page, which draw() slides to
    // keep it in step with the text as the page scrolls
    const w = Math.floor(vw / q) * q;
    const h = Math.ceil(vh / q) * q;
    want.push([0, 0, w, h, 0, 0], [0, 0, w, h + q, 0, 0]);
  } else if (mode === 'ledge') {
    // The ledge, and the whole page for the tiger to climb (it scrolls with the page)
    const end = document.querySelector('.site-footer')!.getBoundingClientRect().bottom + scrollY; // (not scrollHeight, which counts this canvas)
    const h = Math.min(Math.floor(end / q), 16000) * q;
    want.push([0, 0, ledge.w, ledge.h, ledge.x, ledge.y], [-ledge.x, -ledge.y, Math.floor(vw / q) * q, h, 0, 0]);
  }
  while (canvases.length > want.length) canvases.pop()!.el.remove();
  want.forEach(([x, y, w, h, left, top], i) => {
    let cv = canvases[i];
    if (!cv) {
      const el = document.createElement('canvas');
      el.setAttribute('aria-hidden', 'true');
      document.body.append(el);
      cv = canvases[i] = { el, ctx: el.getContext('2d')!, x, y, w, h, sig: '-' };
    }
    Object.assign(cv, { x, y, w, h, sig: '-' });
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
      // Once the reader has been down to the ledge, the tiger is out on the page
      if (ledgeVisible) wake();
      else if (!ledgeSeen) halt();
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
    const before = `${vw} ${ledge.x} ${ledge.y} ${ledge.w} ${ledge.h} ${q}`;
    const tg = find('tiger');
    const onGround = !!tg && tg.pl === ground;
    measure();
    // On a phone the toolbar coming and going only changes the window's
    // height, which the ledge's world doesn't depend on
    if (mode === 'ledge' && was === 'ledge' && `${vw} ${ledge.x} ${ledge.y} ${ledge.w} ${ledge.h} ${q}` === before) return draw(), wake();
    const [ox, oy] = before.split(' ').slice(1, 3).map(Number);
    terrain();
    layout();
    // The ledge moved on the page: a tiger out on the page stays where it was on it
    if (tg && !onGround && mode === 'ledge' && was === 'ledge') (tg.x += ox - ledge.x), (tg.y += oy - ledge.y);
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
  for (const cv of canvases) cv.sig = '-';
}

const colour = (v: string) => (v.includes('|') ? (dark ? v.split('|')[1] : v.split('|')[0]).split(':')[1] : tok[v] || v);

// --------------------------------------------------------------------- sprites

// The character at (x, y) of a frame after a transform: 0 as drawn,
// 1 mirrored, 2 upside down, 3 turned right, 4 turned left, 5 mirrored and
// turned right. A tiger drawn facing right climbs a wall on its right at 4,
// and on its left at 5.
// A blink closes eyes: each 'e' takes the pixel above it.
function pixel(grid: string[], tf: number, blink: boolean, x: number, y: number) {
  const gw = grid[0].length;
  const gh = grid.length;
  const turned = tf > 2;
  if (x < 0 || y < 0 || x >= (turned ? gh : gw) || y >= (turned ? gw : gh)) return '.';
  const sx = tf === 1 ? gw - 1 - x : tf === 3 ? y : tf > 3 ? gw - 1 - y : x;
  const sy = tf === 2 ? gh - 1 - y : tf === 3 || tf === 5 ? gh - 1 - x : tf === 4 ? x : y;
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
    path: [], u: 0, resume: '', tf: 0, pl: null, to: null, cx: 0, away: 0, up: true, ct: 4,
  };
}

const find = (k: Kind) => cast.find((c) => c.kind === k);
const go = (c: Critter, st: string, dur = 0) => ((c.st = st), (c.t = 0), (c.dur = dur));
const show = (c: Critter, pose: string, s: number) => ((c.pose = pose), (c.poseTo = T + s));
const puff = (g: Fx['g'], x: number, y: number, vy: number, life: number) => fx.push({ g, x, y, vy, age: 0, life });
const visible = (c: Critter) => c.wait <= 0 && c.st !== 'hide' && c.st !== 'lost' && c.a > 0.05;

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
      c.dir = dir;
      // In the margins the tiger comes back to its place in the window; on a
      // phone it waits on this page's ledge until the reader gets there
      if (c.kind === 'tiger') mode === 'margins' && place(c, fx_ * vw, fy * vh);
      else {
        c.side = side;
        const z = sides[side];
        c.x = z.a + fx_ * (z.b - z.a);
        c.y = fy * (mode === 'margins' ? vh : ledge.h);
        fit(c);
      }
      orient(c);
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
    // On the lowest place in view, at its far end
    go(c, 'sit', rnd(3, 8));
    c.f = 'sit';
    c.near = T;
    c.next = T + rnd(2, 5);
    if (ledged) (c.pl = ground), (c.x = (ledge.w - c.w) * 0.3), (c.y = grid(floorY - c.h));
    else {
      const p = plats.filter((p) => p.d && seen(p)).pop();
      place(c, p ? p.r : 0, p ? feet(p) : vh);
    }
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
      // Drops in from above and lands on the first thing below
      c.wait = 0.6;
      c.y = -c.h - 8;
      c.pl = null;
      go(c, 'fall');
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
  } else if (c.kind === 'tiger') {
    if (mode === 'ledge' && c.fast && c.pl === ground) return void ((c.pl = ground), (c.y = floorY - c.h));
    // Back onto whatever is now under its feet, or down it goes. Any plan
    // was made on the old terrain.
    if (c.resume !== 'happy') c.resume = '';
    skip = null;
    if (/crouch|hop|climb/.test(c.st)) go(c, 'fall'), (c.pl = null);
    if (!c.pl) return;
    let best: Plat | null = null;
    for (const p of plats) if (Math.abs(feet(p) - c.y - c.h) < 40 && c.x + c.w > p.l && c.x < p.r && (!best || Math.abs(feet(p) - c.y - c.h) < Math.abs(feet(best) - c.y - c.h))) best = p;
    if (best) (c.pl = best), (c.y = feet(best) - c.h), (c.x = clamp(c.x, best.l, best.r - c.w));
    // Nothing near: asleep or settled, it moves to the nearest place in view
    else if (c.asleep || /sit|nap/.test(c.st)) place(c, c.x + c.w / 2, c.y + c.h);
    else (c.pl = null), go(c, 'fall'), (c.vx = c.vy = 0);
    return;
  } else if (mode === 'margins') c.y = clamp(c.y, 0, vh - c.h);
  if (!c.fast) c.x = clamp(c.x, z.a, z.b - c.w);
}

// ----------------------------------------------------------------------- loop

function wake() {
  const ok = live && on && !reduced && !printing && !document.hidden && mode !== 'none' && (mode === 'margins' || ledgeSeen);
  if (raf || !ok || allAsleep()) return;
  lastMs = performance.now();
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
  held = null;
  for (const c of cast) {
    if (c.st === 'rise' || c.st === 'hold' || c.st === 'sink') go(c, 'hide');
    if (c.kind === 'tiger' && (!c.pl || /crouch|hop|climb|leap|fall|startled|lost|held/.test(c.st))) home(c);
    bed(c, true);
  }
  fx = [];
}

function update(dt: number) {
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
    STEP[c.kind](c, dt, night);
  }
  social(night);
  fx = fx.filter((f) => ((f.age += dt), (f.y += f.vy * dt), f.age < f.life));
}

// Does the tiger go with the page (on the text, or in the air over the
// column) rather than with the window (held, or on or over a margin's floor)?
const paged = (c: Critter) =>
  c.kind === 'tiger' && (mode === 'ledge' || (mode === 'margins' && c.st !== 'held' && (c.pl ? !!c.pl.d : !sides.some((z) => c.x + c.w / 2 > z.a && c.x + c.w / 2 < z.b))));

// The tiger on the page scrolls with the page. Jellyfish read as deeper than
// the text: they move a quarter of the scroll.
function onScroll() {
  const d = scrollY - lastScroll;
  lastScroll = scrollY;
  if (!d || mode !== 'margins') return;
  for (const c of cast) {
    if (paged(c)) c.y -= d;
    if (c.kind === 'jellyfish' && !c.asleep && !reduced && c.st !== 'held') c.y -= 0.25 * clamp(d, -40, 40);
  }
  if (!raf) draw();
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

// The ghost's way of getting about. Behind the text it goes faint (see
// fade()) and hurries, so it never lingers under a sentence.
function glide(c: Critter, tx: number, ty: number, speed: number, dt: number) {
  const behind = mode === 'margins' && c.x + c.w > col.l && c.x < col.r;
  const done = steer(c, tx, ty, behind ? Math.max(speed, 90) : speed, dt);
  if (mode === 'margins') c.side = c.x + c.w / 2 > vw / 2 ? 1 : 0;
  return done;
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
      // ...but never closer than the edge of its own margin, so it can't settle behind the text
      if (steer(c, clamp(ptr.x + (c.x > ptr.x ? 40 : -40 - c.w), sides[c.side].a, sides[c.side].b - c.w), clamp(ptr.y - c.h / 2, 0, vh - c.h), 20, dt) && c.dur === 0) {
        c.dur = 1;
        puff('heart', c.x + c.w / 2 - 2.5 * q, c.y - 7 * q, -24 / 0.9, 0.9);
      }
      return;
    case 'stalkG': { // sneaking up on the napping tiger
      const tg = find('tiger');
      if (!tg || tg.st !== 'nap') return go(c, 'float');
      const right = tg.x + tg.w + 6 + c.w <= (mode === 'ledge' ? ledge.w : vw);
      if (glide(c, right ? tg.x + tg.w + 6 : tg.x - c.w - 6, tg.y + tg.h - c.h - 2, 60, dt)) {
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
        const side = mode === 'margins' && Math.random() < 0.2 ? 1 - c.side : c.side;
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
  const k = q / 3; // speeds and gravity grow with the art
  const p = c.pl;
  const lo = p ? p.l : 0;
  const hi = p ? p.r - c.w : 0;
  const f = p ? feet(p) : c.y + c.h;
  const [vl, vt, vr, vb] = view();
  const step = (period: number) => (Math.floor(c.t / period) % 2 ? 'walk2' : 'walk1');
  const face = (x: number) => (c.dir = x > c.x + c.w / 2 ? 1 : -1);
  // Nothing underfoot (a re-measure took it away): down it goes
  if (!p && /^(sit|walk|crouch|chase|stalk|wiggle|land|happy|nap)$/.test(c.st)) return (c.vx = c.vy = 0), void go(c, 'fall');
  // Feet on whatever it stands on, on the same pixel grid as the page
  const stand = () => {
    if (!p) return;
    c.y = grid(p.y - c.h) - p.d * scrollY;
    if (!c.fast) c.x = clamp(c.x, lo, hi);
  };
  const air = (g: number) => {
    const y0 = c.y + c.h;
    c.vy += g * k * dt;
    move(c, dt);
    if (c.x < vl || c.x > vr - c.w) (c.x = clamp(c.x, vl, vr - c.w)), (c.vx *= -0.45);
    if (c.vy <= 0) return false;
    // Lands on the first thing it comes down onto
    let on: Plat | null = null;
    for (const pl of plats) {
      const fy = feet(pl);
      if (pl !== skip && fy >= y0 - 1 && fy <= c.y + c.h + 1 && c.x + c.w * 0.75 > pl.l && c.x + c.w * 0.25 < pl.r && (!on || fy < feet(on))) on = pl;
    }
    if (on) {
      c.pl = on;
      skip = null;
      c.vx = c.vy = 0;
      c.y = feet(on) - c.h;
      c.x = clamp(c.x, on.l, on.r - c.w);
      return true;
    }
    if (c.y > vb + 40) (c.pl = null), go(c, 'lost');
    return false;
  };
  // The laser dot: a moving pointer within reach, over open page. A pointer
  // resting on the text belongs to someone reading.
  const pcx = ptr.x - c.w / 2;
  const inBand = !!p && ptr.on && ptr.x > lo - 20 && ptr.x < hi + c.w + 20 && ptr.y > f - 200 * k && ptr.y < f + 40 && !overInk(ptr.x, ptr.y, 7);
  const idle = c.st === 'sit' || c.st === 'walk';
  if (!c.fast && idle && !night && inBand && T > c.cool && Math.hypot(ptr.x - ptr.cx, ptr.y - ptr.cy) > 20) {
    face(ptr.x);
    c.hunt = 0;
    c.resume = '';
    if (Math.abs(pcx - c.x) <= 160 * k) go(c, 'wiggle', rnd(0.5, 0.9));
    else go(c, 'chase');
  }
  // Scrolled out of sight, or fallen off the window: it comes after the reader
  if ((mode === 'margins' || ledgeSeen) && !night) {
    c.away = c.st === 'lost' || ((c.y + c.h < vt || c.y > vb) && /^(sit|walk|nap|happy|chase|stalk)$/.test(c.st)) ? c.away + dt : 0;
    if (c.away > (c.st === 'nap' ? 8 : 1.2)) return drop(c);
  }
  if (c.st !== 'climb') c.tf = c.dir < 0 ? 1 : 0;
  switch (c.st) {
    case 'walk': {
      c.f = step(0.17);
      if (!c.fast) c.tx = clamp(c.tx, lo, hi);
      face(c.tx + c.w / 2);
      // A stroll, or a trot when it's going somewhere
      c.x += Math.sign(c.tx - c.x) * Math.min((c.resume ? 70 : c.fast ? 40 : 22) * k * dt, Math.abs(c.tx - c.x));
      stand();
      if (Math.abs(c.tx - c.x) < 1) {
        c.fast = false;
        if (c.resume === 'climb') {
          // Onto the wall: head up, claws in
          c.dir = c.cx > c.x ? 1 : -1;
          c.x = c.cx;
          c.y = f - c.w;
          c.pl = null;
          c.tf = c.ct;
          c.u = 0;
          return (c.resume = ''), go(c, 'climb');
        }
        if (c.resume === 'jump' || c.resume === 'drop') {
          c.resume = '';
          face(c.cx + c.w / 2);
          return go(c, 'crouch', 0.2);
        }
        go(c, 'sit', rnd(3, 8));
      }
      return;
    }
    case 'crouch': // winding up to jump
      c.f = 'crouch';
      stand();
      if (c.t >= c.dur && c.to) {
        skip = feet(c.to) > f ? p : null; // going down: past the edge of this one
        hop(c, c.cx, c.to);
      }
      return;
    case 'hop':
      c.f = 'leap';
      if (air(1100)) go(c, 'land', 0.12), (c.f = 'crouch');
      return;
    case 'climb': { // up the side of the text, or of the screen: hand over hand
      const B = c.to!;
      // Ten frames a second, rising a few sprite px with each so a paw on
      // the wall stays where it was planted
      const n = Math.floor(c.t * 10);
      c.f = CLIMB.cycle[n % CLIMB.cycle.length];
      if (n > c.u) (c.y -= (n - c.u) * CLIMB.rise * q), (c.u = n);
      if (c.y + c.w <= feet(B)) {
        // Over the top, facing back the way it came
        c.pl = B;
        c.dir = -c.dir;
        c.tf = c.dir < 0 ? 1 : 0;
        c.x = clamp(c.dir < 0 ? B.r - c.w : B.l, B.l, B.r - c.w);
        c.y = feet(B) - c.h;
        go(c, 'land', 0.15);
        c.f = 'crouch';
      }
      return;
    }
    case 'chase':
      c.f = step(0.09);
      face(ptr.x);
      c.x = clamp(c.x + Math.sign(pcx - c.x) * 70 * k * dt, lo, hi);
      stand();
      if (!inBand) go(c, 'sit', rnd(2, 4));
      else if (Math.abs(pcx - c.x) < 100 * k) go(c, 'wiggle', rnd(0.5, 0.9));
      return;
    case 'stalk': { // creeping up on the ladybird
      const bug = find('ladybird');
      if (!bug || !reach(c, bug)) return go(c, 'sit', 1.5);
      const bx = bug.x + bug.w / 2 - c.w / 2;
      face(bug.x + bug.w / 2);
      c.f = step(0.25);
      c.x = clamp(c.x + Math.sign(bx - c.x) * 12 * k * dt, lo, hi);
      stand();
      if (Math.abs(bx - c.x) < 60 * k || Math.abs(clamp(bx, lo, hi) - c.x) < 1) go(c, 'wiggle', rnd(0.6, 1.2)), (c.tx = bx);
      return;
    }
    case 'wiggle': // crouch and wiggle the rump, then leap
      c.f = Math.floor(c.t / 0.12) % 2 ? 'crouch2' : 'crouch';
      stand();
      if (!c.hunt) {
        if (!inBand) return go(c, 'sit', rnd(2, 4));
        c.tx = pcx;
        face(ptr.x);
      }
      if (c.t >= c.dur) {
        // As high as what it's after (the pointer, the ladybird), from just over its own height up to five times it
        const bug = find('ladybird');
        const aim = c.hunt === 0 ? ptr.y : c.hunt === 1 && bug ? bug.y + bug.h / 2 : f;
        const g = 1100 * k;
        go(c, 'leap');
        c.vy = -Math.sqrt(2 * g * clamp(f - c.h / 2 - aim, 1.2 * c.h, 5 * c.h));
        const t = (-2 * c.vy) / g; // up and back down
        c.vx = clamp((clamp(c.tx, lo, hi) - c.x) / t, -300 * k, 300 * k);
        if (c.hunt === 1 && bug) bug.cool = T + 0.4 * t; // it always takes off just in time
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
      stand();
      if (c.t < c.dur) return;
      if (c.resume === 'happy') return (c.resume = ''), go(c, 'happy', 0.6);
      if (!c.hunt && inBand && Math.abs(pcx - c.x) < 24 * k) {
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
      stand();
      if (c.t > c.dur) go(c, 'sit', rnd(3, 6));
      return;
    case 'startled':
      c.f = 'startled';
      if (air(1100) && c.t >= c.dur) go(c, 'sit', 1.5), (c.near = T);
      return;
    case 'held': // scruffed: limp, eyes shut
      c.f = 'walk1';
      c.pl = null;
      c.tx = clamp(c.tx, vl, vr - c.w);
      c.ty = clamp(c.ty, vt, Math.min(vb, floorY) - c.h);
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
    case 'lost': // off the bottom of the window; drop() brings it back
      if (night) home(c), bed(c, true);
      return;
    case 'nap':
      c.f = Math.floor(c.t) % 2 ? 'sleep2' : 'sleep1';
      stand();
      if (T >= c.next) {
        puff('z', c.x + (c.dir > 0 ? c.w - 5 * q : 0), c.y - q, -8 / 1.5, 1.5);
        c.next = T + 2;
      }
      if (night) bed(c);
      return;
    default: // sit
      if (night) return bed(c);
      c.f = 'sit';
      stand();
      if (T >= c.next) show(c, 'sitFlick', 0.28), (c.next = T + rnd(2, 5));
      if (c.t > c.dur) {
        if (T - c.near > 25) return go(c, 'nap'), void (c.f = 'sleep1');
        // Somewhere else on the page, or a stroll along this line
        const w = (mode === 'margins' || ledgeSeen) && Math.random() < (floor(p!) ? 0.35 : 0.6) ? choose(c, ways(c)) : null;
        if (w) return plan(c, w);
        let x = rnd(lo, hi);
        if (Math.abs(x - c.x) < 40) x = clamp(c.x + (x > c.x ? 60 : -60), lo, hi);
        c.tx = x;
        c.resume = ''; // a stroll, not the rest of an old plan
        go(c, 'walk');
      }
  }
};

const feet = (p: Plat) => p.y - p.d * scrollY;
// The window in world px: left, top, right, bottom
const view = () => (mode === 'ledge' ? [scrollX - ledge.x, scrollY - ledge.y, scrollX - ledge.x + vw, scrollY - ledge.y + vh] : [0, 0, vw, vh]);
// The floor of a margin, which stays put in the window
const floor = (p: Plat) => mode === 'margins' && !p.d;
// In view, with room for the tiger above
const seen = (p: Plat) => floor(p) || (feet(p) - view()[1] >= CAST.tiger.frames.sit.length * q && feet(p) - view()[1] <= vh - 2);
// A world y on the page's sprite-pixel grid, which the tiger's canvas shares
const grid = (y: number) => (mode === 'ledge' ? Math.floor((y + ledge.y) / q) * q - ledge.y : Math.floor(y / q) * q);

// Is the world point (x, y) on text or a picture, give or take pad px? A
// pad of 7 also covers the leading between lines, which is still reading.
const overInk = (x: number, y: number, pad = 2) => {
  const ox = mode === 'margins' ? scrollX : 0; // ink is in document px in the margins, world px on the ledge
  const oy = mode === 'margins' ? scrollY : 0;
  return ink.some((b) => x + ox > b[0] - pad && x + ox < b[2] + pad && y + oy > b[1] - pad && y + oy < b[3] + pad);
};

// Where the tiger can go from here: any place in view a jump away (up to
// five heights up, any distance down, across a gap of up to three lengths),
// or a place above that ends flush with this one, up the side of the text
// between them.
function ways(c: Critter): Way[] {
  const A = c.pl!;
  const out: Way[] = [];
  for (const B of plats) {
    if (B === A || !seen(B)) continue;
    const up = feet(A) - feet(B);
    // Up to five heights up (a cat's jump), any distance down; from the floor
    // of a margin, one big leap back onto the page
    if (!floor(A) ? Math.max(B.l - A.r, A.l - B.r) <= 3 * c.w && up <= 5 * c.h : !floor(B) && Math.abs(B.l + B.r - A.l - A.r) < 1000) out.push([B, -1, 0]);
    if (up > c.h && !floor(A) && !floor(B))
      for (const s of [1, -1]) {
        // A climbing tiger is c.h wide; it needs a clear strip beside the text
        let x = s > 0 ? Math.max(A.r, B.r) + 2 : Math.min(A.l, B.l) - 2 - c.h;
        for (let pass = 0; pass < 2; pass++)
          for (const b of ink) if (b[3] > B.y - c.w && b[1] < A.y && b[2] > x && b[0] < x + c.h) x = s > 0 ? b[2] + 2 : b[0] - 2 - c.h;
        const wall = s > 0 ? x : x + c.h;
        const [vl, , vr] = view();
        // (it may hang a little over the edge of the window, as on a phone)
        if (x >= vl - 0.25 * c.h && x + c.h <= vr + 0.25 * c.h && Math.abs((s > 0 ? A.r : A.l) - wall) < 40 && Math.abs((s > 0 ? B.r : B.l) - wall) < 40) out.push([B, x, s > 0 ? 5 : 4]);
      }
    // On a phone the edges of the screen are walls too: up the side of the
    // window from the end of one line to the end of another
    if (up > c.h && mode === 'ledge')
      for (const s of [1, -1]) {
        const [vl, , vr] = view();
        const x = s > 0 ? vr - c.h : vl;
        const end = s > 0 ? x : x + c.h; // where the lines it climbs between should end
        if (Math.abs((s > 0 ? A.r : A.l) - end) < 40 && Math.abs((s > 0 ? B.r : B.l) - end) < 40) out.push([B, x, s > 0 ? 4 : 5]);
      }
  }
  return out;
}

// A climb when there is one, and onward: up the page until it nears the top
// of the window, then back down until it nears the bottom
function choose(c: Critter, ws: Way[]) {
  const f = feet(c.pl!) - view()[1];
  if (f < vh * 0.35) c.up = false;
  if (f > vh * 0.75) c.up = true;
  const wt = ws.map(([B, , turn]) => ((turn ? 3 : 1) * ((feet(B) < feet(c.pl!)) === c.up ? 4 : 1)) / (1 + Math.abs(B.l + B.r - 2 * c.x) / 600));
  let r = Math.random() * wt.reduce((a, b) => a + b, 0);
  return ws.find((_, i) => (r -= wt[i]) < 0) || null;
}

// Walk to where the move starts; the walk step sets off from there
function plan(c: Critter, [B, x, turn]: Way) {
  const A = c.pl!;
  c.to = B;
  if (turn) {
    c.cx = x;
    c.ct = turn;
    c.tx = x > A.l ? A.r - c.w : A.l;
    c.resume = 'climb';
  } else if (feet(B) > feet(A) && Math.max(B.l - A.r, A.l - B.r) < 0) {
    // Down to somewhere underneath: off the end that B reaches past
    const s = B.r - A.r > A.l - B.l ? 1 : -1;
    c.tx = s > 0 ? A.r - c.w : A.l;
    c.cx = clamp(s > 0 ? A.r - c.w / 2 : A.l - c.w / 2, B.l, B.r - c.w);
    c.resume = 'drop';
  } else {
    const t0 = clamp(B.l > A.r ? A.r - c.w : B.r < A.l ? A.l : clamp(c.x, Math.max(A.l, B.l), Math.min(A.r, B.r) - c.w), A.l, A.r - c.w);
    c.tx = t0;
    c.cx = clamp(t0 + (B.l > A.r ? 0.6 : B.r < A.l ? -0.6 : 0) * c.w, B.l, B.r - c.w);
    c.resume = 'jump';
  }
  go(c, 'walk');
}

// A jump from where it is to (x1, the top of B), over a peak a little above the higher end
function hop(c: Critter, x1: number, B: Plat) {
  const g = 1100 * (q / 3);
  const y0 = c.y + c.h;
  const y1 = feet(B);
  const peak = Math.min(y0, y1) - 6 * q - Math.abs(x1 - c.x) * 0.1;
  c.vy = -Math.sqrt(2 * g * (y0 - peak));
  c.vx = (x1 - c.x) / (Math.sqrt((2 * (y0 - peak)) / g) + Math.sqrt((2 * (y1 - peak)) / g));
  c.dir = c.vx < 0 ? -1 : 1;
  c.pl = null;
  go(c, 'hop');
}

// Back into view after the reader scrolls away: dropping in from the top, or
// jumping up from the bottom, onto something near that edge
function drop(c: Critter) {
  const ps = plats.filter((p) => !floor(p) && seen(p)).sort((a, b) => a.y - b.y);
  const [vl, vt, vr, vb] = view();
  c.away = 0;
  c.resume = '';
  c.fast = false;
  if (!ps.length) return (c.pl = null), (c.y = vb + 4), void go(c, 'lost');
  const top = c.y < (vt + vb) / 2;
  const i = Math.floor(Math.random() * Math.min(3, ps.length));
  const p = ps[top ? i : ps.length - 1 - i];
  c.x = rnd(p.l, p.r - c.w);
  c.dir = c.x > (vl + vr) / 2 ? -1 : 1;
  c.pl = null;
  c.asleep = false;
  if (top) (c.y = vt - c.h - 4), (c.vx = c.vy = 0), go(c, 'fall');
  else (c.y = vb + 4), hop(c, c.x, p);
}

// Put the tiger on the place in view nearest the window point (x, y)
function place(c: Critter, x: number, y: number) {
  let best: Plat | null = null;
  let bd = Infinity;
  for (const p of plats) {
    const d = Math.hypot(clamp(x, p.l, p.r) - x, feet(p) - y);
    if (seen(p) && d < bd) (best = p), (bd = d);
  }
  c.pl = best;
  if (!best) return go(c, 'lost'), void (c.y = view()[3] + 4);
  c.x = clamp(x - c.w / 2, best.l, best.r - c.w);
  c.y = grid(best.y - c.h) - best.d * scrollY;
}

// Can the tiger get at the ladybird? Close along the ledge, or low on the wall near where it stands.
const reach = (tg: Critter, bug: Critter) => {
  if (!tg.pl || (bug.st !== 'crawl' && bug.st !== 'rest')) return false;
  const dx = Math.abs(bug.x + bug.w / 2 - tg.x - tg.w / 2);
  const f = feet(tg.pl);
  return mode === 'ledge' ? tg.pl === ground && dx < 120 : dx < 260 && bug.y + bug.h > f - 160 && bug.y < f;
};

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
      c.y += Math.sign(d) * Math.min(Math.max(50, 2 * Math.abs(d)) * dt, Math.abs(d)); // quicker when far behind
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
  if (bug && !tg.fast && !tg.resume && (tg.st === 'sit' || tg.st === 'walk') && T - lastHunt > 8 && reach(tg, bug)) {
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
    const boo = v.kind === 'ghost' && tg.st === 'nap' && tg.pl === ground;
    v.x = boo ? clamp(tg.x + tg.w + 6, 0, ledge.w - v.w) : tg.x < ledge.w / 2 ? rnd(0.6, 0.85) * (ledge.w - v.w) : rnd(0.15, 0.4) * (ledge.w - v.w);
    v.dir = v.x > tg.x ? -1 : 1;
    go(v, 'rise', +boo);
  }
}

// ---------------------------------------------------------------------- input

const toWorld = (cx: number, cy: number) => (mode === 'ledge' ? [cx + scrollX - ledge.x, cy + scrollY - ledge.y] : [cx, cy]);

// Is (x, y) on one of the canvases?
const onCanvas = (x: number, y: number) => canvases.some((cv) => x >= cv.x && x < cv.x + cv.w && y >= cv.y && y < cv.y + cv.h);

// The topmost critter at (x, y). Mice and pens hit the critter's own pixels
// (one pixel of slack); a finger gets the box plus 14 px.
function hit(x: number, y: number, touch: boolean) {
  // Text and pictures are painted over the critters: a press on them is the page's
  if (!onCanvas(x, y) || overInk(x, y)) return null;
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    const c = drawOrder[i];
    // A ghost gone faint behind the column is out of reach there
    if (!visible(c) || fade(c) < 1) continue;
    const top = c.y + c.by;
    if (touch) {
      const w = c.st === 'climb' ? c.h : c.w; // a climber is on its side
      const h = c.st === 'climb' ? c.w : c.h;
      if (x > c.x - 14 && x < c.x + w + 14 && y > top - 14 && y < top + h + 14) return c;
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
function inTheirSpace(cx: number, cy: number, mouse = true) {
  // In the column, open page near a critter counts (for the tiger, as far as it pounces)
  const [x, y] = toWorld(cx, cy);
  const near = (c: Critter) =>
    c.kind === 'tiger' ? Math.abs(x - c.x - c.w / 2) < 260 && y > c.y - 160 && y < c.y + c.h + 40 : x > c.x - 60 && x < c.x + c.w + 60 && y > c.y - 60 && y < c.y + c.h + 60;
  const company = mouse && !overInk(x, y, 7) && cast.some((c) => visible(c) && fade(c) === 1 && (mode === 'margins' || c.kind === 'tiger') && near(c));
  if (mode === 'margins') return cx < col.l || cx >= col.r || company;
  return (x > -40 && x < ledge.w + 40 && y > -40 && y < ledge.h + 40) || company;
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
  // (a finger moving on the page is scrolling; only the ledge itself counts for touch)
  if (!inTheirSpace(e.clientX, e.clientY, mouse)) return hover(null);
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
  skip = null;
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
  // A tap on open page near what the tiger stands on: it pounces there
  const tg = find('tiger');
  const p = tg?.pl;
  if (touch && tg && p && !reduced && onCanvas(x, y) && y > feet(p) - (mode === 'ledge' ? 140 : tg.h + 20) && y < feet(p) + 20 && x > p.l - 20 && x < p.r + 20 && !overInk(x, y, 7)) {
    if (tg.asleep || tg.st === 'nap') return rouse(tg), wake();
    if (tg.st === 'sit' || tg.st === 'walk') {
      tg.tx = x - tg.w / 2;
      tg.resume = '';
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
    // Not mid-move: a jump, a climb or a fall carries on
    else if (c.pl && !/crouch|hop|climb|leap|fall|startled/.test(c.st)) {
      c.resume = '';
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
// inside the ledge, or in the window clear of every line of text and
// picture, or not at all. A "found" tag
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
  const [tw, th] = tagSize;
  const ledged = mode === 'ledge';
  const [vl, vt, vr, vb] = ledged && c.kind !== 'tiger' ? [0, 0, ledge.w, ledge.h] : view();
  const ox = ledged ? 0 : scrollX; // to the ink's coordinates
  const oy = ledged ? 0 : scrollY;
  const w = c.st === 'climb' ? c.h : c.w; // a climber is turned on its side
  const h = c.st === 'climb' ? c.w : c.h;
  const top = c.y + c.by;
  // Above, below, right, left: the first that fits and covers no text
  const spots = visible(c) && tw < vr - vl - 8 ? [[c.x + w / 2 - tw / 2, top - th - 8], [c.x + w / 2 - tw / 2, top + h + 8], [c.x + w + 6, top], [c.x - tw - 6, top]] : [];
  for (let i = 0; i < spots.length; i++) {
    const t = spots[i][1];
    const x = i < 2 ? clamp(spots[i][0], vl + 4, vr - 4 - tw) : spots[i][0];
    const X = x + ox;
    const Y = t + oy;
    if (x < vl + 4 || x + tw > vr - 4 || t < vt + 2 || t + th > vb - 2 || ink.some((b) => b[0] < X + tw + 4 && b[2] > X - 4 && b[1] < Y + th + 4 && b[3] > Y - 4)) continue;
    tag.classList.toggle('in-ledge', ledged);
    tag.style.visibility = '';
    tag.style.left = `${ledged ? x + ledge.x : x}px`;
    tag.style.top = `${ledged ? t + ledge.y : t}px`;
    return;
  }
  tag.style.visibility = 'hidden';
}

// ---------------------------------------------------------------------- draw

function draw() {
  // The page canvas slides up by the scroll's remainder of a sprite pixel,
  // so its grid and the page's stay one: the tiger never shimmers against the
  // text as the page scrolls. Everything else keeps still on the window canvas.
  const page = canvases[1] || null;
  if (page && mode === 'margins') {
    const oy = -(scrollY % q);
    if (page.y !== oy) (page.y = oy), (page.el.style.transform = `translateY(${oy}px)`), (page.sig = '-');
  }
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
      if (!visible(c) || (cv === page) !== paged(c)) continue;
      const y = c.y + c.by;
      const a = c.a * fade(c);
      if (dark) add(sprite(c, true), c.x, y, (T < c.glowTo ? 0.38 : c.kind === 'jellyfish' ? 0.16 : 0.12) * a);
      add(sprite(c), c.x, y, a);
      if (c.asleep && c.kind !== 'ladybird') {
        const zx = c.kind === 'tiger' ? c.x + (c.dir > 0 ? c.w - 5 * q : 0) : c.x + c.w - 2 * q;
        add(glyph('z'), clamp(zx, q, (mode === 'ledge' ? ledge.w : vw) - 6 * q), c.y - (c.kind === 'tiger' ? q : 6 * q), 1);
      }
    }
    if ((cv === page) === (mode === 'ledge')) for (const f of fx) add(glyph(f.g), f.x, f.y, f.age < f.life / 2 ? 1 : 2 * (1 - f.age / f.life));
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

// The ghost goes faint as it drifts in behind the column, unless it's busy booing
function fade(c: Critter) {
  if (c.kind !== 'ghost' || mode !== 'margins' || /boo|held/i.test(c.st)) return 1;
  return clamp(1 + Math.max(col.l - (c.x + c.w), c.x - col.r) / 24, 0.3, 1);
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
