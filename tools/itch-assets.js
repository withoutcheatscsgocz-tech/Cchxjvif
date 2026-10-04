#!/usr/bin/env node
/*
 * Regenerates every image on the itch.io page from the real game:
 *
 *   itch/cover.png                630 x 500    cover and browse thumbnail (itch: 315:250,
 *                                              630 x 500 recommended)
 *   itch/banner.png               960 x 280    page banner; it replaces the page title
 *   itch/screens/01-title.png     900 x 1600   phone screenshots: 450 x 800 CSS px at 2x,
 *   itch/screens/02-planning.png               the size of the itch.io embed
 *   itch/screens/03-busted.png
 *   itch/screens/04-vault.png
 *   itch/screens/05-escape-replay.png
 *   itch/gameplay.gif             360 x 672    one heist: drawn, frozen, escaped, replayed
 *
 *   NODE_PATH=$(npm root -g) node tools/itch-assets.js              everything
 *   NODE_PATH=$(npm root -g) node tools/itch-assets.js cover gif    only some of:
 *                                                                   cover banner screens gif
 *   ... --frames DIR   keep the GIF's PNG frames in DIR
 *
 * Every picture is the real game in headless Chromium, played with real touch
 * input along routes from tools/solve.js. The cover and banner are HTML
 * compositions (bundled fonts, the game's colours) around crops of the real
 * canvas. Output is deterministic, so re-running only changes files when the
 * game changed:
 *   - Playwright's fake clock drives requestAnimationFrame, timers and
 *     performance.now(), so frames don't depend on machine speed;
 *   - CSS animations and transitions are paused and seeked to the fake clock;
 *   - Math.random (the busted screen shake) is seeded.
 * Game time only depends on the distance drawn, so the input decides what the
 * world looks like, never the wall clock. Every request that isn't the game's
 * own files is blocked, and the run fails if the page asks for one, logs an
 * error, or a title line spills out of its box.
 *
 * Needs Playwright, ffmpeg (for the GIF) and optionally ImageMagick's
 * `identify` (for the summary).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Sim = require('../js/sim.js');
const LEVELS = require('../js/levels.js');
const { solve } = require('./solve.js');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Playwright not found. Install it with: npm i -D playwright (or run with NODE_PATH=$(npm root -g))');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'itch');
const SAVE_KEY = 'time-moves-when-you-draw/v1';
const T0 = Date.UTC(2026, 0, 1); // the fake clock's epoch
const LEAD = 16; // js/game.js: px of route the thief keeps in front of itself
const MAX_BYTES = 3 * 1024 * 1024; // itch.io's limit for covers, screenshots and GIFs
const COLORS = { paper: '#eceef1', plate: '#ffffff', line: '#d5d9df', ink: '#121317', soft: '#5b616b', red: '#e5202b', gold: '#f6c344' };
const TAGLINE = 'A one-finger heist. The clock only runs while you draw.';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain', '.png': 'image/png' };

/* ---------- server: the repo, plus in-memory pages and images under /__itch/ ---------- */

const virtual = new Map();

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (virtual.has(url)) {
      const v = virtual.get(url);
      res.writeHead(200, { 'Content-Type': v.type });
      res.end(v.body);
      return;
    }
    const file = path.join(ROOT, url.replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const blocked = [];
const pageErrors = [];
async function guardNetwork(context, origin) {
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin + '/')) return route.continue();
    blocked.push(u);
    return route.abort();
  });
}
function watchErrors(page) {
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
}

/* ---------- page aids: injected before the game's scripts ---------- */

function pageAids({ save, key, finger }) {
  try {
    if (save) localStorage.setItem(key, JSON.stringify(save));
  } catch (e) {
    /* storage is optional */
  }

  // Seeded Math.random (mulberry32): the busted screen shake uses it.
  let seed = 0x1badc0de;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // CSS animations and transitions run on the real clock: pause each one when
  // it first shows up and seek it to the fake clock instead.
  const births = new WeakMap();
  const itch = {
    sync() {
      const now = performance.now();
      for (const a of document.getAnimations()) {
        if (!births.has(a)) births.set(a, now);
        a.pause();
        a.currentTime = now - births.get(a);
      }
    },
    start() {
      itch.sync();
      const loop = () => {
        itch.sync();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    // GIF caption under the map. It mirrors the game's own HUD, so the two never disagree.
    caption(y) {
      const el = document.getElementById('__itch-caption');
      if (!el) return;
      const flow = document.getElementById('hud-flow-label').textContent;
      const text = flow === 'time moving' ? 'Drawing · time runs' : flow === 'frozen' ? 'Finger up · time frozen' : '';
      el.hidden = !text;
      el.style.top = `${y}px`;
      el.classList.toggle('live', flow === 'time moving');
      el.lastChild.textContent = text;
    },
  };
  window.__itch = itch;

  if (!finger) return;
  // A fingertip marker like Android's "show taps", so the GIF shows where the finger is.
  const ring = { el: null };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    addEventListener(
      type,
      (e) => {
        if (!ring.el) return;
        ring.el.hidden = type === 'pointerup' || type === 'pointercancel';
        ring.el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      },
      true
    );
  }
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      #__itch-finger { position: fixed; left: -21px; top: -21px; width: 42px; height: 42px; z-index: 20;
        border-radius: 50%; pointer-events: none; background: rgba(18,19,23,0.16);
        box-shadow: inset 0 0 0 2px rgba(18,19,23,0.5), 0 0 0 4px rgba(255,255,255,0.5); }
      #__itch-caption { position: fixed; left: 50%; z-index: 20; transform: translate(-50%, -50%);
        display: inline-flex; align-items: center; gap: 9px; padding: 6px 12px 6px 11px; white-space: nowrap;
        background: #121317; color: #fff; pointer-events: none;
        font: 600 13px/1.2 'IBM Plex Mono', monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      #__itch-caption i { width: 8px; height: 8px; background: #8a9099; display: inline-block; }
      #__itch-caption.live i { background: #e5202b; border-radius: 50%; }`;
    document.head.appendChild(style);
    ring.el = document.createElement('div');
    ring.el.id = '__itch-finger';
    ring.el.hidden = true;
    const cap = document.createElement('div');
    cap.id = '__itch-caption';
    cap.hidden = true;
    cap.append(document.createElement('i'), document.createTextNode(''));
    document.body.append(ring.el, cap);
  });
}

/* ---------- driving the game ---------- */

class Game {
  constructor(context, page, cdp) {
    this.context = context;
    this.page = page;
    this.cdp = cdp;
  }

  /* Advance the fake clock (frames, timers, CSS animations). */
  async run(ms) {
    if (ms > 0) await this.page.clock.runFor(ms);
    await this.page.evaluate(() => window.__itch.sync());
  }

  now() {
    return this.page.evaluate(() => performance.now());
  }

  /* Run at least `atLeast` ms, then on to performance.now() % period === phase,
     so pulsing things (the pen ring) land on a chosen frame. */
  async runToPhase(period, phase, atLeast = 0) {
    const now = await this.now();
    const wait = (((phase - ((now + atLeast) % period)) % period) + period) % period;
    await this.run(Math.round(atLeast + wait));
  }

  state() {
    return this.page.evaluate(() => window.TMWYD.state());
  }

  toScreen(pts) {
    return this.page.evaluate((list) => list.map(([x, y]) => window.TMWYD.toScreen(x, y)), pts.map((p) => [p.x, p.y]));
  }

  touch(type, p) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] : [],
    });
  }

  async startLevel(i) {
    await this.page.tap(`#menu-grid .card:nth-child(${i + 1})`);
    const st = await this.state();
    if (st.mode !== 'play' || st.level !== i) throw new Error(`heist ${i + 1} did not start (${st.mode})`);
    await this.run(20);
  }

  async shot(file, opts = {}) {
    await this.page.evaluate(() => window.__itch.sync());
    return this.page.screenshot({ path: file, caret: 'hide', ...opts });
  }

  close() {
    return this.context.close();
  }
}

async function openGame(browser, origin, { width = 450, height = 800, dsf = 2, save = null, finger = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  });
  await guardNetwork(context, origin);
  await context.addInitScript(pageAids, { save, key: SAVE_KEY, finger });
  const page = await context.newPage();
  watchErrors(page);
  await page.clock.install({ time: T0 });
  await page.goto(`${origin}/index.html`);
  await page.evaluate(() => document.fonts.ready);
  const fontsOk = await page.evaluate(
    () => document.fonts.check('900 40px "Big Shoulders Display"') && document.fonts.check('600 14px "IBM Plex Mono"')
  );
  if (!fontsOk) throw new Error('bundled fonts did not load');
  const loadedAt = await page.evaluate(() => Date.now());
  if (loadedAt >= T0 + 30000) throw new Error('the page took over 30 s to load');
  await page.clock.pauseAt(T0 + 30000); // from here on, time only moves when we say so
  await page.evaluate(() => window.__itch.start());
  const cdp = await context.newCDPSession(page);
  return new Game(context, page, cdp);
}

/* ---------- routes: the solver's route as pen points (same idea as tools/playtest.js) ---------- */

function penPath(L, route) {
  const W = L.w;
  const center = (cell) => Sim.tileCenter(cell % W, Math.floor(cell / W));
  const pts = [center(route[0].cell)];
  const wiggle = (p, len, dir) => {
    // Waiting = scribbling in place: a zig-zag across the direction of travel, of exact length.
    if (len <= 0.01) return;
    const trips = Math.max(1, Math.ceil(len / 4));
    const amp = len / (2 * trips);
    const nx = -Math.sin(dir);
    const ny = Math.cos(dir);
    for (let i = 0; i < trips; i++) {
      pts.push({ x: p.x + nx * amp, y: p.y + ny * amp });
      pts.push({ x: p.x, y: p.y });
    }
  };
  let dir = -Math.PI / 2;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const pa = center(a.cell);
    const pb = center(b.cell);
    const budget = (b.t - a.t) * Sim.SPEED;
    if (a.cell === b.cell) {
      wiggle(pa, budget, dir);
      continue;
    }
    dir = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    pts.push(pb);
    wiggle(pb, budget - Math.hypot(pb.x - pa.x, pb.y - pa.y), dir);
  }
  // Keep pulling past the exit, so the thief closes the lead and steps onto it.
  const last = pts[pts.length - 1];
  for (let d = 4; d <= 40; d += 4) pts.push({ x: last.x + Math.cos(dir) * d, y: last.y + Math.sin(dir) * d, pull: true });
  return pts;
}

/* Split long segments (so a GIF frame can stop anywhere) and tag each point with the distance drawn. */
function densify(pts, step = 2) {
  const out = [{ ...pts[0], s: 0 }];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, s: s + (d * k) / n, pull: b.pull });
    }
    s += d;
  }
  return out;
}

const routes = new Map();
function route(level, gem) {
  const key = `${level}:${gem}`;
  if (!routes.has(key)) {
    const L = Sim.compile(LEVELS[level], level);
    const res = solve(L, gem && L.gems.length > 0);
    if (res.error) throw new Error(`solver, heist ${level + 1}: ${res.error}`);
    routes.set(key, { t: res.t, pts: densify(penPath(L, res.route)) });
  }
  return routes.get(key);
}

/* A save with the first n heists cleared (all stars, best = 80% of par), so later ones are unlocked. */
function progress(n) {
  const stars = {};
  const best = {};
  for (let i = 0; i < n; i++) {
    stars[i] = 7;
    best[i] = Math.round(LEVELS[i].par * 80) / 100;
  }
  return { stars, best, sound: true };
}

/* Draw along pts[from..to) with one finger, `offset` screen px away from the line
   (the game keeps the offset the finger had at touch-down). Returns the index
   reached; stops early once the run is over. */
async function draw(game, pts, { from = 0, to = pts.length, down = true, up = true, offset = { x: 0, y: 0 } } = {}) {
  const scr = (await game.toScreen(pts.slice(from, to))).map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
  if (down) await game.touch('touchStart', scr[0]);
  let i = from;
  for (let k = down ? 1 : 0; k < scr.length; k++) {
    await game.touch('touchMove', scr[k]);
    i = from + k + 1;
    if (pts[i - 1].pull && (await game.state()).mode !== 'play') break;
  }
  if (up) await game.touch('touchEnd');
  return i;
}

/* Index of the first pen point that brings the thief to game time t. */
const indexAtTime = (pts, t) => {
  const i = pts.findIndex((p) => p.s >= t * Sim.SPEED + LEAD);
  return i < 0 ? pts.length : i;
};

/* Play heist `level` along the solver's route up to game time t, lift the finger and let it settle. */
async function playTo(g, level, t, gem = true) {
  const r = route(level, gem);
  await g.startLevel(level);
  await draw(g, r.pts, { to: indexAtTime(r.pts, t) });
  await g.runToPhase(1000, 250, 1500);
  const st = await g.state();
  if (st.mode !== 'play') throw new Error(`heist ${level + 1} at ${t} s: expected to be mid-heist, got ${st.mode}`);
  return st;
}

/* ---------- the screenshots ---------- */

const SCREENS = {
  /* The title screen, caught as the title's beat lands on TIME. */
  async '01-title'(browser, origin, file) {
    const g = await openGame(browser, origin);
    await g.run(120);
    await g.shot(file);
    await g.close();
  },

  /* Crossfire, finger lifted mid-heist: the world frozen, every cone in place. */
  async '02-planning'(browser, origin, file) {
    const level = 6;
    const g = await openGame(browser, origin, { save: progress(level) });
    await playTo(g, level, 9.6);
    await g.shot(file);
    await g.close();
  },

  /* Night Shift, walking straight up into a guard's cone. */
  async '03-busted'(browser, origin, file) {
    const level = 1;
    const L = Sim.compile(LEVELS[level], level);
    const pts = densify([L.start, { x: L.start.x, y: L.start.y - 9 * Sim.TILE }].map((p) => ({ ...p, pull: true })));
    const g = await openGame(browser, origin, { save: progress(level) });
    await g.startLevel(level);
    await draw(g, pts);
    const st = await g.state();
    if (st.mode !== 'caught') throw new Error(`03-busted: expected to be caught, got ${st.mode}`);
    await g.run(1600);
    await g.shot(file);
    await g.close();
  },

  /* The Vault, lifting the second gold bar right behind the sentry. */
  async '04-vault'(browser, origin, file) {
    const level = 7;
    const g = await openGame(browser, origin, { save: progress(level) });
    await playTo(g, level, 10);
    await g.shot(file);
    await g.close();
  },

  /* Eye in the Sky, escaped with all three stars, the real-time replay halfway through. */
  async '05-escape-replay'(browser, origin, file) {
    const level = 3;
    const r = route(level, true);
    const g = await openGame(browser, origin, { save: progress(level) });
    await g.startLevel(level);
    await draw(g, r.pts);
    const st = await g.state();
    if (st.mode !== 'won') throw new Error(`05-escape-replay: expected an escape, got ${st.mode}`);
    // "Clean. Heist." x4 (1.2 s), then the replay starts at -0.4 s.
    await g.run(1200 + 400 + Math.round(st.t * 560));
    await g.shot(file);
    await g.close();
  },
};

/* ---------- crops of the real canvas, for the cover and the banner ---------- */

// The canvas renders at up to 3x (js/game.js caps devicePixelRatio there).
const CROP_DSF = 3;

/* Play to a moment and return a PNG of a world-space rectangle (px; a tile is 24),
   centred on (cx, cy), `h` tall, with the given width / height aspect. */
async function crop(browser, origin, { level, t, cx, cy, h, aspect }) {
  const g = await openGame(browser, origin, { dsf: CROP_DSF, save: progress(level) });
  const st = await playTo(g, level, t);
  const w = h * aspect;
  const [a, b] = await g.toScreen([
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
  ]);
  const png = await g.shot(null, { clip: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } });
  await g.close();
  return { png, st };
}

const CSS_BASE = `
  :root { --paper: ${COLORS.paper}; --plate: ${COLORS.plate}; --line: ${COLORS.line}; --ink: ${COLORS.ink};
          --soft: ${COLORS.soft}; --red: ${COLORS.red}; --gold: ${COLORS.gold}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--paper); color: var(--ink); font-family: 'IBM Plex Mono', monospace; overflow: hidden; position: relative; }
  /* The game's title type: Big Shoulders Display 900, tight, uppercase. At line-height 0.9
     the capitals (0.8 em) sit inside their line box, so an ink slab holds its word. */
  .title { position: absolute; margin: 0; font-family: 'Big Shoulders Display', sans-serif; font-weight: 900;
           text-transform: uppercase; line-height: 0.9; letter-spacing: -0.015em; }
  .title .line { display: block; width: max-content; white-space: nowrap; padding: 0 0.04em; }
  .slab { display: inline-block; background: var(--ink); color: var(--plate); padding: 0 0.04em; }
  .line > .slab:first-child { margin-left: -0.04em; }
  .red { color: var(--red); }
  .shot { position: absolute; overflow: hidden; background: #f5f6f8; border-left: 6px solid var(--ink); }
  .shot img { display: block; width: 100%; height: 100%; }
  .chip { position: absolute; display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px;
          background: var(--ink); color: var(--plate); font: 600 12px/1.2 'IBM Plex Mono', monospace;
          letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .chip i { width: 8px; height: 8px; background: #8a9099; display: inline-block; }
  .chip .t { text-transform: none; letter-spacing: 0.02em; margin-left: 4px; }
`;

const page = (w, h, css, body) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/fonts/fonts.css"><style>${CSS_BASE}
  body { width: ${w}px; height: ${h}px; }${css}</style></head><body>${body}</body></html>`;

const chip = (st) => `<span class="chip"><i></i>Frozen<span class="t">${st.t.toFixed(2)} s</span></span>`;

/* Cover, 630 x 500: the stacked title from the game's title screen, beside a tall crop of the
   real map. The title is 96 px, so it still reads at itch's 315 x 250 grid size. */
const COVER = {
  w: 630,
  h: 500,
  panel: { x: 318, w: 312 },
  crop: { level: 7, t: 4, cx: 200, cy: 344, h: 360 },
  html(st) {
    return page(
      this.w,
      this.h,
      `
  .title { left: 24px; top: 33px; font-size: 96px; }
  .shot { left: ${this.panel.x}px; top: 0; width: ${this.panel.w}px; height: ${this.h}px; }
  .chip { right: 12px; top: 12px; }`,
      `
  <h1 class="title"><span class="line slab">Time</span><span class="line">moves</span><span class="line">when</span><span class="line">you</span><span class="line red">draw.</span></h1>
  <div class="shot"><img src="/__itch/crop.png" alt="">${chip(st)}</div>`
    );
  },
};

/* Banner, 960 x 280: the title on two lines and the tagline, beside a crop of the real map. */
const BANNER = {
  w: 960,
  h: 280,
  panel: { x: 640, w: 320 },
  crop: { level: 7, t: 4, cx: 178, cy: 410, h: 236 },
  html(st) {
    return page(
      this.w,
      this.h,
      `
  .title { left: 30px; top: 30px; font-size: 92px; }
  .tag { position: absolute; left: 33px; top: 218px; margin: 0; font: 400 16px/1.4 'IBM Plex Mono', monospace; white-space: nowrap; }
  .shot { left: ${this.panel.x}px; top: 0; width: ${this.panel.w}px; height: ${this.h}px; }
  .chip { right: 12px; top: 12px; }`,
      `
  <h1 class="title"><span class="line"><span class="slab">Time</span> moves</span><span class="line">when you <span class="red">draw.</span></span></h1>
  <p class="tag">${TAGLINE}</p>
  <div class="shot"><img src="/__itch/crop.png" alt="">${chip(st)}</div>`
    );
  },
};

/* Measure the composition: every title line's real glyph box (canvas text metrics) must sit
   inside its line box, inside the canvas, clear of other lines and of the game panel. */
function checkLayout() {
  const problems = [];
  const W = innerWidth;
  const H = innerHeight;
  const ctx = document.createElement('canvas').getContext('2d');
  const panel = document.querySelector('.shot').getBoundingClientRect();
  const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const inside = (r) => r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H;
  const glyphs = [];
  for (const el of document.querySelectorAll('.title .line')) {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : parseFloat(cs.lineHeight) * size;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = cs.textTransform === 'uppercase' ? el.textContent.toUpperCase() : el.textContent;
    const m = ctx.measureText(text);
    const r = el.getBoundingClientRect();
    const base = r.top + (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const g = { left: r.left, right: r.right, top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent, text };
    if (g.top < r.top - 0.5 || g.bottom > r.bottom + 0.5) problems.push(`"${text}" glyphs overflow their line box`);
    if (!inside(g)) problems.push(`"${text}" is outside the canvas`);
    if (hits(g, panel)) problems.push(`"${text}" runs into the game panel`);
    for (const o of glyphs) if (hits(g, o)) problems.push(`"${text}" overlaps "${o.text}"`);
    glyphs.push(g);
  }
  for (const el of document.querySelectorAll('.tag, .chip')) {
    const r = el.getBoundingClientRect();
    if (!inside(r)) problems.push(`"${el.textContent}" is outside the canvas`);
    if (el.classList.contains('tag') && hits(r, panel)) problems.push(`"${el.textContent}" runs into the game panel`);
    for (const g of glyphs) if (hits(r, g)) problems.push(`"${el.textContent}" overlaps "${g.text}"`);
  }
  for (const el of document.querySelectorAll('.title .line, .tag, .chip')) {
    const cs = getComputedStyle(el);
    const font = `${cs.fontWeight} 20px ${cs.fontFamily}`;
    if (!document.fonts.check(font)) problems.push(`font not loaded: ${font}`);
  }
  return [...new Set(problems)];
}

async function composition(browser, origin, spec, file) {
  const panelInner = { w: spec.panel.w - 6, h: spec.h }; // minus the 6 px ink rule
  const { png, st } = await crop(browser, origin, { ...spec.crop, aspect: panelInner.w / panelInner.h });
  virtual.set('/__itch/crop.png', { type: 'image/png', body: png });
  virtual.set('/__itch/page.html', { type: 'text/html', body: spec.html(st) });
  const context = await browser.newContext({ viewport: { width: spec.w, height: spec.h }, deviceScaleFactor: 1 });
  await guardNetwork(context, origin);
  const pg = await context.newPage();
  watchErrors(pg);
  await pg.goto(`${origin}/__itch/page.html`);
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const problems = await pg.evaluate(checkLayout);
  if (problems.length) throw new Error(`${path.basename(file)}:\n  ${problems.join('\n  ')}`);
  await pg.screenshot({ path: file });
  await context.close();
}

/* ---------- the GIF ---------- */

const GIF = {
  level: 2, // Blind Spots: short, readable, guards turning their heads
  width: 450,
  height: 840, // the 450 x 800 embed plus room for a caption under the map
  fps: 15,
  outWidth: 360,
  speed: 1.5, // drawing speed, x real time
  intro: 0.8, // s of the heist's title card before the finger goes down
  pauseAt: 3.1, // game-s: lift the finger here...
  pause: 1.4, // ...for this long (s): everything freezes
  replay: 2.0, // s of the real-time replay after "Clean. Heist."
  finger: { x: 0, y: 64 }, // touch this far below the line, the way the game teaches
};

async function gameplayGif(browser, origin, file, keepDir) {
  const dir = keepDir ? path.resolve(keepDir) : fs.mkdtempSync(path.join(os.tmpdir(), 'itch-gif-'));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^f\d+\.png$/.test(f)) fs.unlinkSync(path.join(dir, f));

  const r = route(GIF.level, false);
  const g = await openGame(browser, origin, { width: GIF.width, height: GIF.height, dsf: 2, save: progress(GIF.level), finger: true });
  await g.startLevel(GIF.level);
  const mapBottom = (await g.toScreen([{ x: 0, y: Sim.ROWS * Sim.TILE }]))[0].y;
  const captionY = Math.round((mapBottom + GIF.height) / 2);
  const lowest = Math.max(...(await g.toScreen(r.pts)).map((p) => p.y));
  if (lowest + GIF.finger.y + 21 > mapBottom) throw new Error('gameplay.gif: the finger offset would leave the map');

  let frame = 0;
  const capture = async () => {
    // Frame k shows the fake clock at k / fps seconds.
    const due = Math.round(((frame + 1) * 1000) / GIF.fps) - Math.round((frame * 1000) / GIF.fps);
    await g.run(due);
    await g.page.evaluate((y) => window.__itch.caption(y), captionY);
    await g.shot(path.join(dir, `f${String(frame).padStart(4, '0')}.png`));
    frame++;
  };
  const hold = async (seconds) => {
    for (let k = Math.round(seconds * GIF.fps); k > 0; k--) await capture();
  };
  const pxPerFrame = (Sim.SPEED * GIF.speed) / GIF.fps;

  // Draw from pts[i] on, one frame per pxPerFrame of route, until `until` or the end of the run.
  let i = 0;
  let down = false;
  const drawFrames = async (until) => {
    while (i < until) {
      const target = r.pts[i].s + pxPerFrame;
      let j = i + 1;
      while (j < until && r.pts[j].s <= target) j++;
      i = await draw(g, r.pts, { from: i, to: j, down: !down, up: false, offset: GIF.finger });
      down = true;
      const st = await g.state();
      if (st.mode !== 'play') return st;
      await capture();
    }
    return g.state();
  };

  // 1. The heist's title card and hint. Nothing moves.
  await hold(GIF.intro);
  // 2. Draw until the pause point.
  await drawFrames(indexAtTime(r.pts, GIF.pauseAt));
  // 3. Lift the finger: the building freezes mid-step.
  await g.touch('touchEnd');
  down = false;
  i -= 1; // put the finger back down where it left
  await hold(GIF.pause);
  // 4. Finish the route.
  const st = await drawFrames(r.pts.length);
  await g.touch('touchEnd');
  if (st.mode !== 'won') throw new Error(`gameplay.gif: expected an escape, got ${st.mode}`);
  // 5. "Clean. Heist." and a bit of the real-time replay.
  await hold(1.2 + GIF.replay);
  await g.close();

  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-framerate', String(GIF.fps), '-i', path.join(dir, 'f%04d.png'),
    '-vf',
    `scale=${GIF.outWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];` +
      '[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0', file,
  ]);
  if (!keepDir) fs.rmSync(dir, { recursive: true, force: true });
  return frame;
}

/* ---------- main ---------- */

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--frames') ? args[args.indexOf('--frames') + 1] : null;
  const wanted = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--frames');
  const all = ['cover', 'banner', 'screens', 'gif'];
  const bad = wanted.filter((w) => !all.includes(w));
  if (bad.length) {
    console.error(`Unknown target: ${bad.join(', ')}. Use: ${all.join(', ')}`);
    process.exit(2);
  }
  const want = (k) => !wanted.length || wanted.includes(k);

  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const made = [];
  const step = async (file, fn) => {
    const t = Date.now();
    const note = await fn(file);
    made.push(file);
    console.log(`  ${path.relative(ROOT, file)}${note ? ` (${note})` : ''} · ${((Date.now() - t) / 1000).toFixed(1)} s`);
  };
  try {
    if (want('cover')) await step(path.join(OUT, 'cover.png'), (f) => composition(browser, origin, COVER, f));
    if (want('banner')) await step(path.join(OUT, 'banner.png'), (f) => composition(browser, origin, BANNER, f));
    if (want('screens')) {
      for (const [name, fn] of Object.entries(SCREENS)) await step(path.join(OUT, 'screens', `${name}.png`), (f) => fn(browser, origin, f));
    }
    if (want('gif')) {
      await step(path.join(OUT, 'gameplay.gif'), async (f) => {
        const frames = await gameplayGif(browser, origin, f, keep);
        return `${frames} frames at ${GIF.fps} fps, ${(frames / GIF.fps).toFixed(1)} s`;
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  let failed = blocked.length > 0 || pageErrors.length > 0;
  console.log('');
  for (const file of made) {
    let dims = '';
    try {
      dims = execFileSync('identify', ['-format', '%wx%h ', file]).toString().trim().split(' ')[0];
    } catch (e) {
      /* identify is optional */
    }
    const size = fs.statSync(file).size;
    const big = size > MAX_BYTES;
    failed = failed || big;
    console.log(`${path.relative(ROOT, file).padEnd(34)} ${dims.padEnd(10)} ${(size / 1024).toFixed(0).padStart(5)} KB${big ? '  OVER 3 MB' : ''}`);
  }
  if (blocked.length) console.log('Blocked requests:\n  ' + blocked.join('\n  '));
  if (pageErrors.length) console.log('Page errors:\n  ' + pageErrors.join('\n  '));
  if (failed) process.exit(1);
}

module.exports = { serve, openGame, route, draw, playTo, indexAtTime, progress, crop, composition, SCREENS, COVER, BANNER, GIF };
if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
