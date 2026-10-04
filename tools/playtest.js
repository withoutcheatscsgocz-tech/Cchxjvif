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
 *   node tools/playtest.js                 all heists, mouse, desktop window
 *   node tools/playtest.js --touch         phone emulation with real touch events
 *   node tools/playtest.js --root DIR      play another copy of the game, e.g. the
 *                                          assets/web/ folder unzipped from the APK,
 *                                          or dist/web from tools/build-web.js
 *   node tools/playtest.js --iframe 450x800
 *                                          play inside a 450 x 800 iframe on a host page
 *                                          from another origin, the way itch.io embeds it
 *   node tools/playtest.js --shots out/    also save a screenshot per heist
 *
 * Every request that isn't the game's own files is blocked and reported, so a
 * pass also proves the game runs offline (as it must inside the Android app).
 *
 * --iframe stands in for the itch.io page: the host page is served from
 * http://localhost:<port> and the game from http://127.0.0.1:<other port>, so
 * the game is a cross-site frame with third-party (partitioned) storage, as on
 * html-classic.itch.zone under itch.io. Like itch.io, the frame only loads after
 * a click on "Run game", uses itch's iframe attributes, and has itch's
 * fullscreen button floating over its bottom-right corner. Every tap is aimed at
 * page coordinates (frame offset + the game's own coordinates) and fails if the
 * host page is on top there. It also checks that stars saved inside the frame
 * survive a reload of the host page, and that the frame's storage is
 * partitioned the way Chrome does it (see launchBrowser). With --touch the window is tablet-sized:
 * iPads get itch's in-page embed, phones get a fullscreen frame instead (try
 * --iframe 412x915 for that). Works with --root, --touch and --shots.
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

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ROOT = path.resolve(opt('--root') || path.join(__dirname, '..'));
const TOUCH = args.includes('--touch');
const shotsDir = opt('--shots');
const FRAME = (() => {
  if (!args.includes('--iframe')) return null;
  const m = /^(\d+)x(\d+)$/.exec(opt('--iframe') || '');
  if (!m || +m[1] < 200 || +m[2] < 300) {
    console.error('--iframe takes the frame size in CSS pixels, at least 200x300, e.g. --iframe 450x800');
    process.exit(2);
  }
  return { w: +m[1], h: +m[2] };
})();
const SAVE_KEY = 'time-moves-when-you-draw/v1';
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

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

/* ---------- the itch.io stand-in for --iframe ---------- */

const EMBED_TOP = 130; // px from the top of the host page to the frame (itch: nav bar, banner, title)
// The allow list itch.io gives its game iframes.
const ITCH_ALLOW =
  'autoplay; fullscreen *; geolocation; microphone; camera; midi; monetization; xr-spatial-tracking; ' +
  'gamepad; gyroscope; accelerometer; xr; cross-origin-isolated; web-share';

function embedPage(gameUrl) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>itch.io embed stand-in</title>
<style>
  body { margin: 0; background: #121317; }
  header { height: 50px; background: #2a2b30; }
  #inner_column { max-width: 960px; margin: 0 auto; padding-top: ${EMBED_TOP - 50}px; }
  .html_embed_widget { position: relative; width: ${FRAME.w}px; height: ${FRAME.h}px; margin: 0 auto; background: #000; }
  .load_iframe_btn { position: absolute; inset: 0; margin: auto; width: 160px; height: 48px; }
  iframe { display: block; border: 0; }
  /* itch.io's game.css: .html_embed_widget .fullscreen_btn, a 30 x 30 button */
  .fullscreen_btn { position: absolute; bottom: 0; right: 0; margin: 8px; width: 30px; height: 30px; padding: 0; border: 0; opacity: 0.4; background: #fff; }
</style></head><body>
<header></header>
<div id="inner_column"><div class="html_embed_widget" id="embed"><button class="load_iframe_btn" id="run" type="button">Run game</button></div></div>
<script>
  document.getElementById('run').addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.width = ${FRAME.w};
    frame.height = ${FRAME.h};
    frame.setAttribute('allow', ${JSON.stringify(ITCH_ALLOW)});
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('frameborder', '0');
    frame.src = ${JSON.stringify(gameUrl)};
    const full = document.createElement('button');
    full.className = 'fullscreen_btn';
    full.type = 'button';
    full.title = 'Fullscreen';
    document.getElementById('embed').replaceChildren(frame, full);
    setTimeout(() => frame.focus(), 100);
  });
</script>
</body></html>`;
}

function serveEmbed(gameUrl) {
  const html = embedPage(gameUrl);
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] !== '/') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* Chromium, set up like the browsers itch.io players have.
 * --iframe: Playwright switches off third-party storage partitioning, which Chrome has had on
 * since 115, so it is switched back on: Playwright's own --disable-features list is read from a
 * first launch and passed again without it (Chromium keeps the last --disable-features). With
 * --touch the cross-site frame also shares the page's process, as on Android, where Chrome only
 * isolates sites people log in to. (Headless Chromium also drops the click from a synthesized
 * touch tap in an out-of-process frame, though pointer events get through.) With the mouse the
 * browser decides: full Chromium puts the frame in its own process, as desktop Chrome does, while
 * Playwright's headless shell (its default, and what CI runs) keeps it in the page's. The first
 * line of output says which. */
async function launchBrowser() {
  const opts = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  if (!FRAME) return chromium.launch(opts);
  const probe = await chromium.launch(opts);
  const cdp = await probe.newBrowserCDPSession();
  const argv = (await cdp.send('Browser.getBrowserCommandLine')).arguments;
  await probe.close();
  const prefix = '--disable-features=';
  const off = (argv.find((a) => a.startsWith(prefix)) || prefix)
    .slice(prefix.length)
    .split(',')
    .filter((f) => f && f !== 'ThirdPartyStoragePartitioning');
  const extra = TOUCH ? ['--disable-site-isolation-trials'] : [];
  if (TOUCH) off.push('site-per-process', 'IsolateOrigins');
  return chromium.launch({ ...opts, args: [`${prefix}${off.join(',')}`, ...extra] });
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

/* One finger: the mouse, or a single touch point sent through the DevTools protocol. */
async function makeFinger(page) {
  if (!TOUCH) {
    return {
      down: async (x, y) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: (x, y) => page.mouse.move(x, y),
      up: () => page.mouse.up(),
      tap: (sel) => page.click(sel),
    };
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return {
    down: (x, y) => send('touchStart', x, y),
    move: (x, y) => send('touchMove', x, y),
    up: () => send('touchEnd'),
    tap: (sel) => page.tap(sel),
  };
}

/* Where the game's viewport sits on the page: the iframe's content box, or 0,0 without --iframe. */
async function gameOffset(page) {
  if (!FRAME) return { x: 0, y: 0 };
  return page.evaluate(() => {
    const f = document.querySelector('iframe');
    const r = f.getBoundingClientRect();
    return { x: r.left + f.clientLeft, y: r.top + f.clientTop };
  });
}

/* --iframe: tap an element inside the game the way a finger would, at page coordinates, after
 * checking that nothing on the host page (itch's fullscreen button) covers that point. */
async function tapInFrame(page, game, finger, sel) {
  const el = await game.waitForSelector(sel);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); // the heist list scrolls inside the frame
  await game.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const box = await el.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: !!top && (top === e || e.contains(top)) };
  });
  if (!box.hit) throw new Error(`${sel} is covered inside the game`);
  const at = await gameOffset(page);
  const x = at.x + box.x;
  const y = at.y + box.y;
  const host = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return !e ? 'nothing' : e.tagName === 'IFRAME' ? null : `the host page's ${e.className || e.tagName}`;
  }, [x, y]);
  if (host) throw new Error(`${sel} is under ${host}`);
  await finger.down(x, y);
  await finger.up();
}

async function playLevel(page, game, finger, i) {
  const L = Sim.compile(LEVELS[i], i);
  const res = solve(L, L.gems.length > 0);
  if (res.error) throw new Error(`solver: ${res.error}`);
  const { pts, dir } = penPath(L, res.route);

  await game.waitForFunction((n) => window.TMWYD.state().mode === 'play' && window.TMWYD.state().level === n, i);
  await game.waitForTimeout(150); // let the layout settle
  const at = await gameOffset(page);
  const scr = async (p) => {
    const s = await game.evaluate(([x, y]) => window.TMWYD.toScreen(x, y), [p.x, p.y]);
    return { x: s.x + at.x, y: s.y + at.y };
  };

  const start = await scr(pts[0]);
  await finger.down(start.x, start.y);
  for (const p of pts.slice(1)) {
    const s = await scr(p);
    await finger.move(s.x, s.y);
  }
  // Keep pulling past the exit so the thief closes the lead and steps onto it.
  const last = pts[pts.length - 1];
  for (let d = 4; d <= 40; d += 4) {
    const s = await scr({ x: last.x + Math.cos(dir) * d, y: last.y + Math.sin(dir) * d });
    await finger.move(s.x, s.y);
    if ((await game.evaluate(() => window.TMWYD.state().mode)) !== 'play') break;
  }
  await finger.up();
  const st = await game.evaluate(() => window.TMWYD.state());
  return { st, solverT: res.t };
}

/* --iframe: which result-sheet buttons does itch's fullscreen button overlap, and is each one's
 * centre still the game's? */
async function sheetVsFullscreenButton(page, game) {
  const at = await gameOffset(page);
  const fsb = await page.evaluate(() => {
    const r = document.querySelector('.fullscreen_btn').getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  const buttons = await game.evaluate(() =>
    [...document.querySelectorAll('#results:not([hidden]) button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { name: b.textContent.trim() || b.id, l: r.left, t: r.top, r: r.right, b: r.bottom };
    })
  );
  const out = { measured: buttons.length > 0, clear: true, notes: [] };
  for (const b of buttons) {
    const l = b.l + at.x;
    const t = b.t + at.y;
    const r = b.r + at.x;
    const bt = b.b + at.y;
    const w = Math.min(r, fsb.r) - Math.max(l, fsb.l);
    const h = Math.min(bt, fsb.b) - Math.max(t, fsb.t);
    const covered = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x, y) || {}).tagName !== 'IFRAME',
      [(l + r) / 2, (t + bt) / 2]
    );
    if (covered) out.clear = false;
    if (w > 0 && h > 0) out.notes.push(`"${b.name}" ${covered ? 'centre is covered' : `corner, ${Math.round(w)} x ${Math.round(h)} px`}`);
  }
  return out;
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/index.html`;
  // --iframe: the host page lives on another site (localhost vs 127.0.0.1), like itch.io vs itch.zone.
  const host = FRAME ? await serveEmbed(url) : null;
  const hostOrigin = host ? `http://localhost:${host.address().port}` : null;
  const browser = await launchBrowser();
  // Desktop: a large window keeps mouse rounding well under a world pixel.
  // Touch: a typical Android phone (412 x 915 CSS px).
  // --iframe: a window that holds the host page and the whole frame; tablet-sized for touch.
  const frameView = FRAME && {
    width: Math.max(TOUCH ? 768 : 1280, FRAME.w + 40),
    height: Math.max(TOUCH ? 1024 : 0, EMBED_TOP + FRAME.h + 40),
  };
  const context = await browser.newContext(
    FRAME
      ? TOUCH
        ? { viewport: frameView, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { viewport: frameView }
      : TOUCH
        ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }
        : { viewport: { width: 1200, height: 1900 } }
  );
  const blocked = [];
  const routed = new Set();
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin + '/') || (hostOrigin && u.startsWith(hostOrigin + '/'))) {
      routed.add(u.split('?')[0]);
      return route.continue();
    }
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  const finger = await makeFinger(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Network failures (fonts offline or behind a proxy) don't break the game; script errors do.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  // `game` is where the game runs: the page itself, or the iframe's frame with --iframe.
  let game = page;
  const tapHost = finger.tap;
  let launch = null;
  let reloadGame = () => page.reload();
  if (FRAME) {
    launch = async () => {
      await page.goto(`${hostOrigin}/`);
      await tapHost('#run');
      game = await (await page.waitForSelector('iframe')).contentFrame();
      await game.waitForURL(url);
      await game.waitForFunction(() => !!window.TMWYD);
    };
    reloadGame = async () => {
      await game.goto(url);
      await game.waitForFunction(() => !!window.TMWYD);
    };
    finger.tap = (sel) => tapInFrame(page, game, finger, sel);
    await launch();
  } else {
    await page.goto(url);
  }
  await game.evaluate(() => localStorage.clear());
  await reloadGame();
  await game.evaluate(() => document.fonts.ready);
  const fontsOk = await game.evaluate(
    () => document.fonts.check('900 40px "Big Shoulders Display"') && document.fonts.check('600 14px "IBM Plex Mono"')
  );
  const ownProcess =
    FRAME &&
    (await context.newCDPSession(game).then(
      (s) => s.detach().then(() => true),
      () => false
    ));
  const where = FRAME
    ? `${TOUCH ? 'touch' : 'mouse'}, ${frameView.width}x${frameView.height} host page on ${hostOrigin}, ` +
      `game in a ${FRAME.w}x${FRAME.h} iframe on ${origin} (${ownProcess ? 'own' : "the page's"} process)`
    : TOUCH
      ? 'touch, 412x915'
      : 'mouse, 1200x1900';
  console.log(`${where} · serving ${path.relative(process.cwd(), ROOT) || '.'}`);
  await finger.tap('#menu-grid .card');

  let failed = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const name = `${String(i + 1).padStart(2)} ${LEVELS[i].name.padEnd(18)}`;
    try {
      const { st, solverT } = await playLevel(page, game, finger, i);
      const drift = st.t - solverT;
      const ok = st.mode === 'won' && st.loot.every(Boolean) && st.gems.every(Boolean);
      console.log(`${name} ${ok ? 'escaped' : `FAILED (${st.mode})`}  game ${st.t.toFixed(2)}s  solver ${solverT.toFixed(2)}s  drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}s`);
      if (!ok) {
        failed++;
        if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `fail-${i + 1}.png`) });
        // Skip ahead so the remaining heists still get played.
        await page.keyboard.press('Escape');
        await game.evaluate(
          ([n, key]) => {
            const d = JSON.parse(localStorage.getItem(key) || '{}');
            d.stars = Object.assign(d.stars || {}, { [n]: 1 });
            localStorage.setItem(key, JSON.stringify(d));
          },
          [i, SAVE_KEY]
        );
        await reloadGame();
        if (i + 1 < LEVELS.length) await finger.tap(`#menu-grid .card:nth-child(${i + 2})`);
        continue;
      }
      await game.waitForSelector('#results:not([hidden])');
      await game.waitForTimeout(400);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `heist-${i + 1}.png`) });
      if (i + 1 < LEVELS.length) await finger.tap('#btn-next');
    } catch (e) {
      failed++;
      console.log(`${name} ERROR ${e.message}`);
      break;
    }
  }

  // itch.io's fullscreen button floats over the frame's bottom-right corner, on top of the result sheet.
  const sheet = FRAME ? await sheetVsFullscreenButton(page, game) : null;

  // The hooks the Android shell calls: back leaves a heist, and on the menu lets the app close.
  const backFromHeist = await game.evaluate(() => window.TMWYD.back());
  const backFromMenu = await game.evaluate(() => window.TMWYD.back());
  const pauseOk = await game.evaluate(() => typeof window.TMWYD.pause === 'function');
  const checks = [
    ['bundled fonts load', fontsOk],
    ['back leaves a heist', backFromHeist === true],
    ['back on the menu closes the app', backFromMenu === false],
    ['pause hook exists', pauseOk],
    ['no network requests', blocked.length === 0],
  ];
  if (FRAME) {
    const crossOrigin = await game.evaluate(() => {
      try {
        void window.top.location.href; // readable only from the same origin
        return false;
      } catch (e) {
        return window.top !== window; // the host page is another origin, as on itch.io
      }
    });
    // Reload the host page and launch again: stars saved in third-party storage must still be there.
    await launch();
    const kept = await game.evaluate((key) => {
      try {
        const stars = JSON.parse(localStorage.getItem(key) || '{}').stars || {};
        return Object.keys(stars).filter((k) => stars[k] & 1).length;
      } catch (e) {
        return -1;
      }
    }, SAVE_KEY);
    const shown = (await game.textContent('#menu-stars')).trim();
    // Partitioned like Chrome's: the game's own origin, opened directly, sees none of the frame's saves.
    const direct = await context.newPage();
    await direct.goto(url);
    const partitioned = (await direct.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) === null;
    await direct.close();
    checks.push(
      ['frame storage is partitioned under the host site', partitioned],
      ['game runs in a cross-origin iframe', crossOrigin],
      ['offline check covered the frame', routed.has(`${origin}/js/game.js`) && routed.has(`${hostOrigin}/`)],
      [
        `itch's fullscreen button leaves the result buttons tappable${sheet.notes.length ? ` (overlaps ${sheet.notes.join('; ')})` : ''}`,
        sheet.measured && sheet.clear,
      ],
      [`stars survive reloading the host page (${kept}/${LEVELS.length} escaped, menu shows "${shown}")`, kept === LEVELS.length]
    );
  }
  for (const [label, ok] of checks) {
    console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed++;
  }
  if (blocked.length) console.log('Blocked requests:\n  ' + blocked.join('\n  '));
  if (errors.length) {
    console.log('Page errors:\n  ' + errors.join('\n  '));
    failed++;
  }
  await browser.close();
  server.close();
  if (host) host.close();
  process.exit(failed ? 1 : 0);
})();
