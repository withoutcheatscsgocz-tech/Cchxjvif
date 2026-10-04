#!/usr/bin/env node
/*
 * End-to-end playtest: plays every heist in headless Chromium by dragging the
 * mouse along the route tools/solve.js finds (gem included), then checks the
 * thief escaped and that the game clock matches the solver's clock.
 *
 * Game time is distance walked / SPEED, so the pen path is built so its
 * length between route tiles equals the solver's time between them. Waiting
 * in place is done the way a player does it: by scribbling (tiny zig-zags).
 *
 *   node tools/playtest.js                 all heists
 *   node tools/playtest.js --shots out/    also save a screenshot per heist
 *
 * Needs Playwright (npm i -D playwright, or a global install).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const Sim = require('../js/sim.js');
const LEVELS = require('../js/levels.js');
const { solve, HALF } = require('./solve.js');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* Turn the solver's (time, tile) route into world-space pen points. */
function penPath(L, route) {
  const W = L.w;
  const center = (cell) => Sim.tileCenter(cell % W, Math.floor(cell / W));
  const pts = [center(route[0].cell)];
  const wiggle = (p, len, dir) => {
    // Zig-zag across the direction of travel: exact length, never more than 2px off.
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
  return { pts, dir };
}

async function playLevel(page, i) {
  const L = Sim.compile(LEVELS[i], i);
  const res = solve(L, L.gems.length > 0);
  if (res.error) throw new Error(`solver: ${res.error}`);
  const { pts, dir } = penPath(L, res.route);

  await page.waitForFunction((n) => window.TMWYD.state().mode === 'play' && window.TMWYD.state().level === n, i);
  await page.waitForTimeout(150); // let the layout settle
  const scr = (p) => page.evaluate(([x, y]) => window.TMWYD.toScreen(x, y), [p.x, p.y]);

  const start = await scr(pts[0]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const s = await scr(p);
    await page.mouse.move(s.x, s.y);
  }
  // Keep pulling past the exit so the thief closes the lead and steps onto it.
  const last = pts[pts.length - 1];
  for (let d = 4; d <= 40; d += 4) {
    const s = await scr({ x: last.x + Math.cos(dir) * d, y: last.y + Math.sin(dir) * d });
    await page.mouse.move(s.x, s.y);
    if ((await page.evaluate(() => window.TMWYD.state().mode)) !== 'play') break;
  }
  await page.mouse.up();
  const st = await page.evaluate(() => window.TMWYD.state());
  return { st, solverT: res.t };
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch(
    fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}
  );
  // A large viewport keeps rounding of mouse coordinates well under a world pixel.
  const page = await browser.newPage({ viewport: { width: 1200, height: 1900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Network failures (fonts offline or behind a proxy) don't break the game; script errors do.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#menu-grid .card');

  let failed = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const name = `${String(i + 1).padStart(2)} ${LEVELS[i].name.padEnd(18)}`;
    try {
      const { st, solverT } = await playLevel(page, i);
      const drift = st.t - solverT;
      const ok = st.mode === 'won' && st.loot.every(Boolean) && st.gems.every(Boolean);
      console.log(`${name} ${ok ? 'escaped' : `FAILED (${st.mode})`}  game ${st.t.toFixed(2)}s  solver ${solverT.toFixed(2)}s  drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}s`);
      if (!ok) {
        failed++;
        if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `fail-${i + 1}.png`) });
        // Skip ahead so the remaining heists still get played.
        await page.keyboard.press('Escape');
        await page.evaluate((n) => {
          const key = 'time-moves-when-you-draw/v1';
          const d = JSON.parse(localStorage.getItem(key) || '{}');
          d.stars = Object.assign(d.stars || {}, { [n]: 1 });
          localStorage.setItem(key, JSON.stringify(d));
        }, i);
        await page.reload();
        if (i + 1 < LEVELS.length) await page.click(`#menu-grid .card:nth-child(${i + 2})`);
        continue;
      }
      await page.waitForSelector('#results:not([hidden])');
      await page.waitForTimeout(400);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `heist-${i + 1}.png`) });
      await page.click('#btn-next');
    } catch (e) {
      failed++;
      console.log(`${name} ERROR ${e.message}`);
      break;
    }
  }

  if (errors.length) {
    console.log('Page errors:\n  ' + errors.join('\n  '));
    failed++;
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
