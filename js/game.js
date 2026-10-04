/*
 * Time Moves When You Draw: input, game loop, rendering and screens.
 *
 * Dragging anywhere moves a "pen" that extends the thief's route; the pen
 * keeps the offset your finger had from it at touch-down, so your hand never
 * has to cover the thief. The thief walks the route LEAD pixels behind the
 * pen. Every pixel walked advances game time by 1 / SPEED seconds, and the
 * threats in sim.js are pure functions of that time. No drawing, no time.
 */
(() => {
  'use strict';

  const { TILE, THIEF_R, SPEED, TAU } = Sim;
  const WORLD_W = Sim.COLS * TILE;
  const WORLD_H = Sim.ROWS * TILE;
  const LEAD = 16; // px of drawn route the thief keeps in front of itself
  const PEN_STEP = 3; // px per collision step while the pen chases the finger
  const SUB = 2; // px per simulation substep
  const ALERT_TIME = 0.3; // game-seconds of being watched before you are caught
  const ALERT_DECAY = 1.5; // alert drained per game-second out of sight
  const PICK_R = THIEF_R + 8;

  const C = {
    paper: '#eceef1',
    floor: '#f5f6f8',
    seam: '#e6e8ec',
    plate: '#ffffff',
    wallFace: '#d3d7de',
    wallEdge: '#b8bdc6',
    lock: '#e2e5ea',
    ink: '#121317',
    inkSoft: '#5b616b',
    red: '#e5202b',
    redDark: '#a5121b',
    redLight: '#ff5a61',
    gold: '#f6c344',
    goldDark: '#c98a0b',
    teal: '#19c2b1',
    tealDark: '#0a7b70',
  };
  const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
  const DISPLAY = "'Big Shoulders Display', Impact, sans-serif";

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    hud: $('hud'),
    level: $('hud-level'),
    time: $('hud-time'),
    flow: $('hud-flow'),
    flowLabel: $('hud-flow-label'),
    loot: $('hud-loot-n'),
    gem: $('hud-gem'),
    hint: $('hint'),
    flash: $('flash'),
    busted: $('busted'),
    bustedWhy: $('busted-why'),
    bustedTime: $('busted-time'),
    results: $('results'),
    resultsTitle: $('results-title'),
    resultsStars: $('results-stars'),
    resultsChecks: $('results-checks'),
    next: $('btn-next'),
    menu: $('menu'),
    grid: $('menu-grid'),
    menuStars: $('menu-stars'),
    sound: [$('btn-sound'), $('btn-sound-menu')],
  };

  const levels = LEVELS.map((d, i) => Sim.compile(d, i));

  /* ---------- progress (per-browser convenience only) ---------- */

  const SAVE_KEY = 'time-moves-when-you-draw/v1';
  const save = (() => {
    let d = {};
    try {
      d = JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
    } catch (e) {
      d = {};
    }
    // Keep only well-formed entries, so a stale or hand-edited save can't break the menu.
    const clean = (o, ok) => {
      const out = {};
      if (o && typeof o === 'object') for (const k of Object.keys(o)) if (ok(o[k])) out[k] = o[k];
      return out;
    };
    return {
      stars: clean(d.stars, (v) => Number.isInteger(v) && v >= 0 && v <= 7),
      best: clean(d.best, (v) => Number.isFinite(v) && v > 0),
      sound: d.sound !== false,
    };
  })();
  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) {
      /* private mode or blocked storage: progress just won't stick */
    }
  }
  const STAR_BITS = [1, 2, 4]; // escaped, gem, par
  const starsOf = (i) => STAR_BITS.reduce((n, b) => n + ((save.stars[i] || 0) & b ? 1 : 0), 0);
  const isUnlocked = (i) => i === 0 || ((save.stars[i - 1] || 0) & 1) === 1;

  /* ---------- state ---------- */

  let L = levels[0];
  let mode = 'menu'; // menu | play | caught | won
  let run = null;
  let replay = null;
  let result = null;
  let flowRate = 0;
  let lastGameT = 0;
  let shake = 0;
  let redFlash = 0;
  let bustReadyAt = 0;
  let floorLayer = null;
  let wallLayer = null;
  // s/ox/oy is the current world transform; ts/tox/toy is where it is easing to;
  // ls is the scale the static layers were rendered at.
  const view = { w: 1, h: 1, dpr: 1, s: 1, ox: 0, oy: 0, ts: 1, tox: 0, toy: 0, ls: 1 };

  function newRun() {
    const s = L.start;
    return {
      t: 0,
      x: s.x,
      y: s.y,
      a: -Math.PI / 2,
      plan: [],
      drawing: false,
      pid: null,
      grab: { x: 0, y: 0 },
      target: null,
      loot: L.loot.map(() => false),
      gems: L.gems.map(() => false),
      alert: 0,
      seenBy: null,
      cause: null,
      samples: [{ t: 0, x: s.x, y: s.y, a: -Math.PI / 2, al: 0 }],
      events: [],
      stepAcc: 0,
      stepAlt: false,
      tickAcc: 0,
      tickAlt: false,
      spottedAt: -9,
    };
  }

  /* ---------- layout ---------- */

  const safeProbe = document.createElement('div');
  safeProbe.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(safeProbe);

  function fit(sheetH) {
    const top = ui.hud.hidden ? 8 : ui.hud.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top + 10;
    const bottom = view.h - 10 - (sheetH || safeProbe.offsetHeight);
    const availW = view.w - 12;
    const availH = Math.max(120, bottom - top);
    const s = Math.min(availW / WORLD_W, availH / WORLD_H);
    // Top-aligned: spare height goes below the map, where the thumb drags from.
    return { s, ox: (view.w - WORLD_W * s) / 2, oy: top };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    view.w = Math.max(1, r.width);
    view.h = Math.max(1, r.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    view.ls = fit(0).s;
    buildStatic();
    relayout(true);
  }

  /* Fit the map above whichever sheet is open; ease there unless `snap`. */
  function relayout(snap) {
    const sheet = !ui.results.hidden ? ui.results : !ui.busted.hidden ? ui.busted : null;
    const f = fit(sheet ? sheet.offsetHeight : 0);
    view.ts = f.s;
    view.tox = f.ox;
    view.toy = f.oy;
    if (snap) {
      view.s = f.s;
      view.ox = f.ox;
      view.oy = f.oy;
    }
    ui.hint.style.top = `${Math.round(f.oy + 10)}px`;
  }

  /* ---------- static layers: floor and walls, rebuilt per level and resize ---------- */

  function makeLayer() {
    const k = view.ls * view.dpr;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(WORLD_W * k));
    c.height = Math.max(1, Math.ceil(WORLD_H * k));
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    return [c, g];
  }

  function buildStatic() {
    const [fc, f] = makeLayer();
    const [wc, w] = makeLayer();
    const wall = (c, r) => Sim.isWall(L, c, r);

    f.fillStyle = C.floor;
    f.fillRect(0, 0, WORLD_W, WORLD_H);
    f.strokeStyle = C.seam;
    f.lineWidth = 0.8;
    f.beginPath();
    for (let c = 1; c < L.w; c++) {
      f.moveTo(c * TILE, 0);
      f.lineTo(c * TILE, WORLD_H);
    }
    for (let r = 1; r < L.h; r++) {
      f.moveTo(0, r * TILE);
      f.lineTo(WORLD_W, r * TILE);
    }
    f.stroke();

    // Contact shadows where floor meets a wall above or to the left.
    for (let r = 0; r < L.h; r++) {
      for (let c = 0; c < L.w; c++) {
        if (wall(c, r)) continue;
        const x = c * TILE;
        const y = r * TILE;
        if (wall(c, r - 1)) {
          const g = f.createLinearGradient(0, y, 0, y + 8);
          g.addColorStop(0, 'rgba(18,19,23,0.10)');
          g.addColorStop(1, 'rgba(18,19,23,0)');
          f.fillStyle = g;
          f.fillRect(x, y, TILE, 8);
        }
        if (wall(c - 1, r)) {
          const g = f.createLinearGradient(x, 0, x + 6, 0);
          g.addColorStop(0, 'rgba(18,19,23,0.07)');
          g.addColorStop(1, 'rgba(18,19,23,0)');
          f.fillStyle = g;
          f.fillRect(x, y, 6, TILE);
        }
      }
    }

    // Patrol routes, faint, so you can plan while time is frozen.
    f.save();
    f.strokeStyle = 'rgba(229,32,43,0.3)';
    f.fillStyle = 'rgba(229,32,43,0.3)';
    f.lineWidth = 1.4;
    f.lineCap = 'round';
    f.setLineDash([0.1, 5]);
    for (const g of L.guards) {
      const pts = g.route;
      f.beginPath();
      if (pts.length === 1) {
        f.arc(pts[0].x, pts[0].y, 14, 0, TAU);
      } else {
        f.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) f.lineTo(pts[i].x, pts[i].y);
        if (g.loop) f.closePath();
      }
      f.stroke();
      if (pts.length > 1) {
        for (const p of pts) {
          f.beginPath();
          f.arc(p.x, p.y, 1.8, 0, TAU);
          f.fill();
        }
      }
    }
    f.restore();

    // Walls: white tops, a darker front face where a wall overlooks floor, crisp edges.
    w.fillStyle = C.plate;
    for (let r = 0; r < L.h; r++) {
      for (let c = 0; c < L.w; c++) {
        if (wall(c, r)) w.fillRect(c * TILE - 0.3, r * TILE - 0.3, TILE + 0.6, TILE + 0.6);
      }
    }
    const inside = (c, r) => c >= 0 && r >= 0 && c < L.w && r < L.h;
    const FACE = 6;
    w.fillStyle = C.wallFace;
    for (let r = 0; r < L.h; r++) {
      for (let c = 0; c < L.w; c++) {
        if (wall(c, r) && inside(c, r + 1) && !wall(c, r + 1)) w.fillRect(c * TILE, (r + 1) * TILE - FACE, TILE, FACE);
      }
    }
    w.strokeStyle = C.wallEdge;
    w.lineWidth = 1.1;
    w.beginPath();
    for (let r = 0; r < L.h; r++) {
      for (let c = 0; c < L.w; c++) {
        if (!wall(c, r)) continue;
        const x = c * TILE;
        const y = r * TILE;
        const open = (cc, rr) => inside(cc, rr) && !wall(cc, rr);
        if (open(c, r - 1)) {
          w.moveTo(x, y);
          w.lineTo(x + TILE, y);
        }
        if (open(c, r + 1)) {
          w.moveTo(x, y + TILE - FACE);
          w.lineTo(x + TILE, y + TILE - FACE);
          w.moveTo(x, y + TILE);
          w.lineTo(x + TILE, y + TILE);
        }
        const faceL = open(c - 1, r);
        const faceR = open(c + 1, r);
        if (faceL) {
          w.moveTo(x, y);
          w.lineTo(x, y + TILE);
        }
        if (faceR) {
          w.moveTo(x + TILE, y);
          w.lineTo(x + TILE, y + TILE);
        }
      }
    }
    w.stroke();

    floorLayer = fc;
    wallLayer = wc;
  }

  /* ---------- simulation: pen, walking, threats ---------- */

  function penEnd() {
    return run.plan.length ? run.plan[run.plan.length - 1] : run;
  }

  /* Move the pen towards the finger, sliding along walls, never through them. */
  function penTo(tx, ty) {
    const p = penEnd();
    let x = p.x;
    let y = p.y;
    let d = Math.hypot(tx - x, ty - y);
    for (let i = 0; i < 800 && d > 0.5; i++) {
      const s = Math.min(PEN_STEP, d);
      const r = Sim.collide(L, x + ((tx - x) / d) * s, y + ((ty - y) / d) * s, THIEF_R);
      const nd = Math.hypot(tx - r.x, ty - r.y);
      if (nd > d - 0.02) break; // blocked: only accept progress towards the finger
      x = r.x;
      y = r.y;
      d = nd;
      run.plan.push({ x, y });
    }
  }

  function routeAhead() {
    let len = 0;
    let px = run.x;
    let py = run.y;
    for (const p of run.plan) {
      len += Math.hypot(p.x - px, p.y - py);
      px = p.x;
      py = p.y;
    }
    return len;
  }

  /* Walk the thief up to LEAD px behind the pen. Pushing the finger past a
     wall eats into the lead, so the thief can reach dead ends like exits. */
  function advance() {
    const end = penEnd();
    const push = run.target ? Math.hypot(run.target.x - end.x, run.target.y - end.y) : 0;
    let excess = routeAhead() - Math.max(0, LEAD - push);
    while (excess > 0.01 && mode === 'play') {
      const s = Math.min(SUB, excess);
      walk(s);
      excess -= s;
    }
  }

  function walk(s) {
    let rem = s;
    while (rem > 1e-6 && run.plan.length) {
      const p = run.plan[0];
      const dx = p.x - run.x;
      const dy = p.y - run.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.05) run.a += Sim.wrapAngle(Math.atan2(dy, dx) - run.a) * 0.35;
      if (d <= rem) {
        run.x = p.x;
        run.y = p.y;
        rem -= d;
        run.plan.shift();
      } else {
        run.x += (dx / d) * rem;
        run.y += (dy / d) * rem;
        rem = 0;
      }
    }
    const moved = s - rem;
    if (moved <= 0) return;
    const dt = moved / SPEED;
    run.t += dt;

    run.stepAcc += moved;
    if (run.stepAcc >= 15) {
      run.stepAcc -= 15;
      run.stepAlt = !run.stepAlt;
      Sfx.step(run.stepAlt);
    }
    run.tickAcc += dt;
    if (run.tickAcc >= 0.5) {
      run.tickAcc -= 0.5;
      run.tickAlt = !run.tickAlt;
      Sfx.tick(run.tickAlt);
    }

    L.loot.forEach((p, i) => {
      if (run.loot[i] || Math.hypot(run.x - p.x, run.y - p.y) > PICK_R) return;
      run.loot[i] = true;
      run.events.push({ t: run.t, kind: 'loot', i });
      Sfx.grab();
      buzz(18);
      if (run.loot.every(Boolean)) Sfx.open();
    });
    L.gems.forEach((p, i) => {
      if (run.gems[i] || Math.hypot(run.x - p.x, run.y - p.y) > PICK_R) return;
      run.gems[i] = true;
      run.events.push({ t: run.t, kind: 'gem', i });
      Sfx.gem();
      buzz(18);
    });

    const th = Sim.threat(L, run.x, run.y, run.t);
    if (th.seen) {
      if (run.alert === 0 && run.t - run.spottedAt > 0.6) {
        Sfx.spotted();
        run.spottedAt = run.t;
      }
      run.alert = Math.min(1, run.alert + dt / ALERT_TIME);
      run.seenBy = th.seen;
    } else {
      run.alert = Math.max(0, run.alert - dt * ALERT_DECAY);
      if (run.alert === 0) run.seenBy = null;
    }
    run.samples.push({ t: run.t, x: run.x, y: run.y, a: run.a, al: run.alert });

    if (th.lethal) bust(th.lethal);
    else if (run.alert >= 1) bust({ kind: 'seen', viewer: th.seen });
    else if (run.loot.every(Boolean) && Math.hypot(run.x - L.exit.x, run.y - L.exit.y) < TILE * 0.5) escape();
  }

  function buzz(pattern) {
    if (!save.sound) return;
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* vibration is optional */
    }
  }

  /* ---------- outcomes ---------- */

  const REASONS = {
    guard: 'A guard saw you. A cone turns solid red the moment it has eyes on you.',
    camera: 'A camera caught you mid-sweep. Wait for the cone to swing away.',
    bump: 'You walked straight into a guard.',
    laser: 'You tripped a laser. Dashed beams are off; they brighten just before they switch on.',
  };

  function bust(cause) {
    mode = 'caught';
    run.cause = cause;
    run.drawing = false;
    run.plan.length = 0;
    if (cause.viewer) {
      run.seenBy = cause.viewer;
      run.alert = 1;
    }
    Sfx.busted();
    buzz([70, 50, 140]);
    shake = 1;
    redFlash = 1;
    bustReadyAt = performance.now() + 450;
    const why = cause.kind === 'seen' ? cause.viewer.kind : cause.kind;
    ui.bustedWhy.textContent = REASONS[why] || REASONS.guard;
    ui.bustedTime.textContent = `at ${run.t.toFixed(2)} s`;
    setTimeout(() => {
      if (mode !== 'caught') return;
      ui.busted.hidden = false;
      relayout(false);
    }, 260);
  }

  function escape() {
    mode = 'won';
    run.drawing = false;
    run.plan.length = 0;
    const i = L.index;
    const gem = L.gems.length > 0 && run.gems.every(Boolean);
    const par = run.t <= L.par + 1e-9;
    const mask = 1 | (gem ? 2 : 0) | (par ? 4 : 0);
    const prevBest = save.best[i];
    const newBest = prevBest == null || run.t < prevBest;
    save.stars[i] = (save.stars[i] || 0) | mask;
    if (newBest) save.best[i] = Math.round(run.t * 100) / 100;
    persist();
    result = { t: run.t, gem, par, mask, newBest };
    Sfx.win();
    buzz(40);
    flashWords(['Clean.', 'Heist.', 'Clean.', 'Heist.'], 300, () => {
      replay = { t: -0.4, end: run.t };
      showResults();
    });
  }

  /* ---------- screens ---------- */

  let flashToken = 0;
  function flashWords(words, ms, done, red) {
    const token = ++flashToken;
    ui.flash.classList.toggle('red', !!red);
    let i = 0;
    const step = () => {
      if (token !== flashToken) return;
      ui.flash.textContent = '';
      if (i >= words.length) {
        if (done) done();
        return;
      }
      const w = words[i++];
      const span = document.createElement('span');
      if (typeof w === 'object') {
        const small = document.createElement('small');
        small.textContent = w.small;
        span.append(small, w.text);
      } else {
        span.textContent = w;
      }
      ui.flash.appendChild(span);
      Sfx.word();
      setTimeout(step, ms);
    };
    step();
  }
  function clearFlash() {
    flashToken++;
    ui.flash.textContent = '';
  }

  const pad = (n) => String(n).padStart(2, '0');
  const STAR_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.8l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.6l-6.3 3.6 1.5-7.1L1.8 9.2 9 8.4z"/></svg>';

  function startLevel(i) {
    L = levels[i];
    ui.menu.hidden = true;
    ui.hud.hidden = false;
    ui.level.textContent = `${pad(i + 1)} · ${L.name}`;
    restart(); // closes any open sheet first, so the layout below is measured without it
    resize();
    ui.hint.textContent = L.hint;
    ui.hint.classList.remove('gone');
    const words = L.name.split(' ');
    const seq = words.map((wd, k) => (k === words.length - 1 ? `${wd}.` : wd));
    seq[0] = { small: `Heist ${pad(i + 1)}`, text: seq[0] };
    flashWords(seq, 300);
  }

  function restart() {
    clearFlash();
    ui.busted.hidden = true;
    ui.results.hidden = true;
    replay = null;
    result = null;
    run = newRun();
    lastGameT = 0;
    flowRate = 0;
    shake = 0;
    redFlash = 0;
    mode = 'play';
    relayout(false);
  }

  function nextLevel() {
    if (L.index + 1 < levels.length) startLevel(L.index + 1);
    else goMenu();
  }

  function goMenu() {
    clearFlash();
    mode = 'menu';
    replay = null;
    ui.busted.hidden = true;
    ui.results.hidden = true;
    ui.hud.hidden = true;
    ui.hint.classList.add('gone');
    renderMenu();
    ui.menu.hidden = false;
    ui.menu.scrollTop = 0;
  }

  function showResults() {
    const r = result;
    const last = L.index + 1 >= levels.length;
    ui.resultsTitle.textContent = last ? 'Vault cracked' : 'Escaped';
    ui.resultsStars.innerHTML = STAR_BITS.map((b) => `<span class="star ${r.mask & b ? 'on pop' : ''}">${STAR_SVG}</span>`).join('');
    [...ui.resultsStars.children].forEach((el, k) => (el.style.animationDelay = `${k * 0.12}s`));
    const best = save.best[L.index];
    const rows = [
      ['Escaped', `${r.t.toFixed(2)} s`, true],
      ['Gem', r.gem ? 'Taken' : 'Left behind', r.gem],
      ['Under par', `par ${L.par.toFixed(1)} s`, r.par],
      ['Best', `${best.toFixed(2)} s${r.newBest ? ' · new' : ''}`, r.newBest],
    ];
    ui.resultsChecks.innerHTML = '';
    for (const [label, value, ok] of rows) {
      const li = document.createElement('li');
      const a = document.createElement('span');
      const b = document.createElement('span');
      a.textContent = label;
      b.textContent = value;
      li.className = ok ? 'ok' : 'no';
      li.append(a, b);
      ui.resultsChecks.appendChild(li);
    }
    ui.next.textContent = last ? 'Finish' : 'Next';
    ui.results.hidden = false;
    relayout(false);
  }

  function renderMenu() {
    ui.grid.innerHTML = '';
    let total = 0;
    const firstOpen = levels.findIndex((_, i) => isUnlocked(i) && !((save.stars[i] || 0) & 1));
    levels.forEach((lv, i) => {
      const open = isUnlocked(i);
      const m = save.stars[i] || 0;
      total += starsOf(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (i === firstOpen ? ' next' : '');
      b.disabled = !open;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = pad(i + 1);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = lv.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      const mini = document.createElement('span');
      mini.className = 'mini';
      mini.innerHTML = STAR_BITS.map((bit) => STAR_SVG.replace('<svg ', `<svg class="${m & bit ? 'on' : ''}" `)).join('');
      const info = document.createElement('span');
      info.textContent = !open ? 'Locked' : save.best[i] != null ? `${save.best[i].toFixed(2)} s` : `par ${lv.par.toFixed(1)}`;
      meta.append(mini, info);
      b.append(n, nm, meta);
      b.setAttribute('aria-label', `Heist ${i + 1}, ${lv.name}${open ? `, ${starsOf(i)} of 3 stars` : ', locked'}`);
      b.addEventListener('click', () => {
        Sfx.unlock();
        startLevel(i);
      });
      ui.grid.appendChild(b);
    });
    ui.menuStars.textContent = `${total} / ${levels.length * 3} stars`;
  }

  function syncSound() {
    for (const b of ui.sound) b.setAttribute('aria-pressed', String(save.sound));
    Sfx.setEnabled(save.sound);
  }

  /* ---------- rendering ---------- */

  function liveState() {
    return {
      t: run.t,
      x: run.x,
      y: run.y,
      a: run.a,
      loot: run.loot,
      gems: run.gems,
      alert: run.alert,
      seenBy: run.seenBy,
      trailEnd: run.samples.length,
      caught: mode === 'caught',
      live: true,
    };
  }

  function replayState() {
    const t = Math.max(0, Math.min(replay.t, replay.end));
    const s = run.samples;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    const p = s[lo];
    const q = s[Math.min(lo + 1, s.length - 1)];
    const u = q.t > p.t ? (t - p.t) / (q.t - p.t) : 0;
    const x = p.x + (q.x - p.x) * u;
    const y = p.y + (q.y - p.y) * u;
    const got = (kind, i) => run.events.some((e) => e.kind === kind && e.i === i && e.t <= t);
    return {
      t,
      x,
      y,
      a: p.a + Sim.wrapAngle(q.a - p.a) * u,
      loot: L.loot.map((_, i) => got('loot', i)),
      gems: L.gems.map((_, i) => got('gem', i)),
      alert: p.al,
      seenBy: p.al > 0 ? Sim.threat(L, x, y, t).seen : null,
      trailEnd: lo + 1,
      caught: false,
      live: false,
    };
  }

  function render(now) {
    const k = view.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, view.w, view.h);
    if (mode === 'menu' || !run || !floorLayer) return;

    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 12 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 12 : 0;
    const s = view.s;
    ctx.setTransform(k * s, 0, 0, k * s, (view.ox + sx) * k, (view.oy + sy) * k);
    const st = replay ? replayState() : liveState();
    drawWorld(st, now);

    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawOverlay(st, now);
    return st;
  }

  function drawWorld(st, now) {
    const t = st.t;
    ctx.drawImage(floorLayer, 0, 0, WORLD_W, WORLD_H);
    drawExit(st.loot.every(Boolean), now);
    const vs = Sim.viewers(L, t);
    const hot = st.seenBy;
    const isHot = (v) => hot && hot.kind === v.kind && hot.i === v.i;
    for (const v of vs) drawCone(v, isHot(v), st.caught && isHot(v));
    drawBeams(t);
    drawItems(st, t);
    ctx.drawImage(wallLayer, 0, 0, WORLD_W, WORLD_H);
    drawEmitters(t);
    drawTrail(st);
    if (st.live && mode === 'play') drawRoute(now);
    for (const v of vs) if (v.kind === 'camera') drawCamera(v, t);
    for (const v of vs) if (v.kind === 'guard') drawGuard(v, t);
    drawThief(st, t);
    if (hot && st.alert > 0) {
      const v = vs.find(isHot);
      if (v) drawMark(v, st.alert, st.caught);
    }
  }

  function drawExit(open, now) {
    const { x, y } = L.exit;
    const h = TILE / 2;
    ctx.save();
    if (open) {
      const p = (now % 1100) / 1100;
      ctx.strokeStyle = `rgba(18,19,23,${0.45 * (1 - p)})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - h - p * 7, y - h - p * 7, TILE + p * 14, TILE + p * 14);
      ctx.fillStyle = C.ink;
      ctx.fillRect(x - h + 1, y - h + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = C.plate;
      ctx.font = `600 6.4px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EXIT', x, y + 0.5);
    } else {
      ctx.fillStyle = C.lock;
      ctx.fillRect(x - h + 1, y - h + 1, TILE - 2, TILE - 2);
      ctx.beginPath();
      ctx.rect(x - h + 1, y - h + 1, TILE - 2, TILE - 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(18,19,23,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let d = -TILE; d < TILE; d += 5) {
        ctx.moveTo(x - h + d, y + h);
        ctx.lineTo(x - h + d + TILE, y - h);
      }
      ctx.stroke();
      ctx.strokeStyle = C.inkSoft;
      ctx.fillStyle = C.inkSoft;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y - 1.5, 2.6, Math.PI, 0);
      ctx.stroke();
      ctx.fillRect(x - 4, y - 1.5, 8, 6);
    }
    ctx.restore();
  }

  function drawCone(v, hot, solid) {
    const n = Math.max(10, Math.ceil(v.fov / (2.2 * Sim.DEG)));
    ctx.beginPath();
    ctx.moveTo(v.x, v.y);
    for (let i = 0; i <= n; i++) {
      const a = v.a - v.fov / 2 + (v.fov * i) / n;
      const d = Sim.castRay(L, v.x, v.y, a, v.range);
      ctx.lineTo(v.x + Math.cos(a) * d, v.y + Math.sin(a) * d);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(v.x, v.y, 4, v.x, v.y, v.range);
    if (solid) {
      g.addColorStop(0, 'rgba(229,32,43,0.62)');
      g.addColorStop(1, 'rgba(229,32,43,0.40)');
    } else if (hot) {
      g.addColorStop(0, 'rgba(229,32,43,0.42)');
      g.addColorStop(1, 'rgba(229,32,43,0.20)');
    } else {
      g.addColorStop(0, 'rgba(229,32,43,0.24)');
      g.addColorStop(1, 'rgba(229,32,43,0.05)');
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(229,32,43,0.75)' : 'rgba(229,32,43,0.32)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  function laserLine(l, style, width) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(l.ax, l.ay);
    ctx.lineTo(l.bx, l.by);
    ctx.stroke();
  }

  function drawBeams(t) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const l of L.lasers) {
      const s = Sim.laserState(l, t);
      if (s.on) {
        const flick = 0.85 + 0.15 * Math.sin(t * 70 + l.ax);
        laserLine(l, 'rgba(229,32,43,0.16)', 8);
        laserLine(l, `rgba(229,32,43,${0.92 * flick})`, 2.4);
        laserLine(l, 'rgba(255,226,228,0.95)', 0.8);
      } else {
        const warn = s.left < 0.45;
        ctx.setLineDash(warn ? [3, 2] : [1.5, 4]);
        laserLine(l, warn ? 'rgba(229,32,43,0.8)' : 'rgba(229,32,43,0.28)', warn ? 1.4 : 1);
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  function drawEmitters(t) {
    for (const l of L.lasers) {
      const s = Sim.laserState(l, t);
      const ang = Math.atan2(l.by - l.ay, l.bx - l.ax);
      for (const [x, y, a] of [
        [l.ax, l.ay, ang],
        [l.bx, l.by, ang + Math.PI],
      ]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = C.ink;
        ctx.fillRect(-3, -3.5, 4, 7);
        ctx.fillStyle = s.on ? C.red : '#6b1a1f';
        ctx.fillRect(0, -1.5, 1.6, 3);
        ctx.restore();
      }
      // Timer ring on the first emitter: how long the current state lasts.
      if (l.off > 0) {
        const total = s.on ? l.on : l.off;
        ctx.save();
        ctx.strokeStyle = s.on ? C.red : C.inkSoft;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(l.ax, l.ay, 6.5, -Math.PI / 2, -Math.PI / 2 + TAU * (s.left / total));
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawItems(st, t) {
    L.loot.forEach((p, i) => {
      if (!st.loot[i]) drawGold(p.x, p.y, t + i * 1.3);
    });
    L.gems.forEach((p, i) => {
      if (!st.gems[i]) drawGem(p.x, p.y, t + i * 0.7);
    });
  }

  function sparkle(x, y, t, color) {
    const s = 1.5 + Math.max(0, Math.sin(t * 2.2)) * 2.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.lineTo(Math.cos(a + Math.PI / 4) * s * 0.3, Math.sin(a + Math.PI / 4) * s * 0.3);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGold(x, y, t) {
    const b = Math.sin(t * 3.2) * 1.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(18,19,23,0.13)';
    ctx.beginPath();
    ctx.ellipse(0, 6.5, 8.5, 2.6, 0, 0, TAU);
    ctx.fill();
    ctx.translate(0, b - 1);
    ctx.fillStyle = C.goldDark;
    ctx.beginPath();
    ctx.moveTo(-8.5, 4.5);
    ctx.lineTo(8.5, 4.5);
    ctx.lineTo(6.5, -0.5);
    ctx.lineTo(-6.5, -0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(-6.5, -0.5);
    ctx.lineTo(6.5, -0.5);
    ctx.lineTo(4.8, -5);
    ctx.lineTo(-4.8, -5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-3.6, -3.6);
    ctx.lineTo(1.5, -3.6);
    ctx.stroke();
    ctx.restore();
    sparkle(x + 6, y - 7 + b, t * 1.7, '#ffffff');
  }

  function drawGem(x, y, t) {
    const b = Math.sin(t * 3) * 1.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(18,19,23,0.13)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 6, 2, 0, 0, TAU);
    ctx.fill();
    ctx.translate(0, b - 1);
    const pts = [
      [0, -7],
      [6, -1.5],
      [0, 7],
      [-6, -1.5],
    ];
    ctx.fillStyle = C.tealDark;
    ctx.beginPath();
    pts.forEach(([px, py]) => ctx.lineTo(px, py));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.teal;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(6, -1.5);
    ctx.lineTo(0, 7);
    ctx.lineTo(0, -1.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-6, -1.5);
    ctx.lineTo(0, -1.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    sparkle(x - 5, y - 6 + b, t * 1.9 + 1, '#ffffff');
  }

  function drawTrail(st) {
    const s = run.samples;
    const end = Math.min(st.trailEnd, s.length);
    if (end < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(18,19,23,0.22)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 4]);
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 2; i < end; i += 2) ctx.lineTo(s[i].x, s[i].y);
    ctx.lineTo(st.x, st.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawRoute(now) {
    const end = penEnd();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (run.plan.length) {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(run.x, run.y);
      for (const p of run.plan) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    const pulse = (now % 1000) / 1000;
    if (run.drawing) {
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 3.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(18,19,23,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 9, 0, TAU);
      ctx.stroke();
    } else {
      // Show where the next drag picks the route back up.
      const r = 10 + pulse * 12;
      ctx.strokeStyle = `rgba(18,19,23,${0.55 * (1 - pulse)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(end.x, end.y, r, 0, TAU);
      ctx.stroke();
      if (run.plan.length) {
        ctx.fillStyle = C.plate;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4.2, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCamera(v, t) {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.fillStyle = 'rgba(18,19,23,0.16)';
    ctx.beginPath();
    ctx.arc(1.5, 2.5, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = C.inkSoft;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
    ctx.rotate(v.a);
    ctx.fillStyle = C.ink;
    ctx.fillRect(-4, -4, 12, 8);
    ctx.fillStyle = '#cfd8e3';
    ctx.fillRect(7, -3, 1.6, 6);
    ctx.fillStyle = Math.floor(t * 2) % 2 === 0 ? C.red : '#5c1418';
    ctx.beginPath();
    ctx.arc(-1, 0, 1.7, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawGuard(v, t) {
    const swing = v.walk ? Math.sin(t * 11 + v.i * 1.7) : 0;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.fillStyle = 'rgba(18,19,23,0.15)';
    ctx.beginPath();
    ctx.ellipse(1.5, 2.5, 10, 9, 0, 0, TAU);
    ctx.fill();
    ctx.rotate(v.a);
    ctx.fillStyle = C.redDark;
    ctx.beginPath();
    ctx.arc(1.5 + swing * 3.2, -8.6, 2.7, 0, TAU);
    ctx.arc(1.5 - swing * 3.2, 8.6, 2.7, 0, TAU);
    ctx.fill();
    // Faceted torso: one flat red, one shaded half.
    ctx.fillStyle = C.red;
    ctx.beginPath();
    ctx.moveTo(-5, -8.5);
    ctx.lineTo(2, -9.5);
    ctx.lineTo(5.5, -4);
    ctx.lineTo(5.5, 4);
    ctx.lineTo(2, 9.5);
    ctx.lineTo(-5, 8.5);
    ctx.lineTo(-7.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(120,8,14,0.35)';
    ctx.beginPath();
    ctx.moveTo(-7.5, 0);
    ctx.lineTo(5.5, 0);
    ctx.lineTo(5.5, 4);
    ctx.lineTo(2, 9.5);
    ctx.lineTo(-5, 8.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.redLight;
    ctx.beginPath();
    ctx.moveTo(0, -4.8);
    ctx.lineTo(4.2, -2.4);
    ctx.lineTo(4.2, 2.4);
    ctx.lineTo(0, 4.8);
    ctx.lineTo(-4.2, 2.4);
    ctx.lineTo(-4.2, -2.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, -4.8);
    ctx.lineTo(4.2, -2.4);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.plate;
    ctx.beginPath();
    ctx.moveTo(4.4, -2.4);
    ctx.lineTo(7, 0);
    ctx.lineTo(4.4, 2.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawThief(st, t) {
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.fillStyle = 'rgba(18,19,23,0.16)';
    ctx.beginPath();
    ctx.ellipse(1.2, 2.2, 9, 8, 0, 0, TAU);
    ctx.fill();
    if (st.alert > 0) {
      ctx.strokeStyle = `rgba(229,32,43,${0.35 + st.alert * 0.65})`;
      ctx.lineWidth = 1.5 + st.alert * 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 11 + st.alert * 3, 0, TAU);
      ctx.stroke();
    }
    ctx.rotate(st.a);
    const swing = Math.sin((t * SPEED) / 5.5);
    if (st.loot.some(Boolean)) {
      ctx.fillStyle = C.goldDark;
      ctx.beginPath();
      ctx.arc(-7.5, 0, 4.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(-7.2, -0.8, 3, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(1.5 + swing * 2.6, -7.2, 2.3, 0, TAU);
    ctx.arc(1.5 - swing * 2.6, 7.2, 2.3, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4.5, -7);
    ctx.lineTo(2, -7.8);
    ctx.lineTo(4.8, -3);
    ctx.lineTo(4.8, 3);
    ctx.lineTo(2, 7.8);
    ctx.lineTo(-4.5, 7);
    ctx.lineTo(-6.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b2e36';
    ctx.beginPath();
    ctx.arc(0.5, 0, 4.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = C.plate;
    ctx.fillRect(1.9, -3.7, 2, 7.4);
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(3, -1.7, 0.8, 0, TAU);
    ctx.arc(3, 1.7, 0.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawMark(v, alert, caught) {
    const big = caught || alert > 0.5;
    ctx.save();
    ctx.translate(v.x, v.y - 18);
    ctx.fillStyle = caught ? C.red : C.plate;
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-5.5, -7, 11, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = caught ? C.plate : C.red;
    ctx.font = `900 12px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(big ? '!' : '?', 0, 0);
    ctx.restore();
  }

  function drawOverlay(st, now) {
    const heat = Math.max(st.alert * 0.55, redFlash * 0.5);
    if (heat > 0.01) {
      const g = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75);
      g.addColorStop(0, 'rgba(229,32,43,0)');
      g.addColorStop(1, `rgba(229,32,43,${heat})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (replay) {
      const x = view.ox;
      const y = view.oy;
      const w = WORLD_W * view.s;
      ctx.fillStyle = C.ink;
      ctx.fillRect(x, y, 112, 22);
      ctx.fillStyle = Math.floor(now / 500) % 2 ? C.red : '#ff8a8f';
      ctx.beginPath();
      ctx.arc(x + 11, y + 11, 3.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = C.plate;
      ctx.font = `600 10.5px ${MONO}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('REPLAY · 1×', x + 21, y + 11.5);
      const p = Math.max(0, Math.min(1, replay.t / replay.end));
      ctx.fillStyle = 'rgba(18,19,23,0.12)';
      ctx.fillRect(x, y - 4, w, 3);
      ctx.fillStyle = C.red;
      ctx.fillRect(x, y - 4, w * p, 3);
    }
  }

  /* ---------- HUD ---------- */

  const hudCache = {};
  function setText(el, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    el.textContent = value;
  }

  function updateHud(st) {
    setText(ui.time, 'time', st.t.toFixed(2));
    let flow = 'frozen';
    if (replay) flow = 'replay';
    else if (mode === 'caught') flow = 'busted';
    else if (mode === 'won') flow = 'escaped';
    else if (flowRate > 0.04) flow = 'moving';
    setText(ui.flowLabel, 'flow', flow === 'moving' ? 'time moving' : flow);
    ui.flow.classList.toggle('live', flow === 'moving' || flow === 'replay');
    setText(ui.loot, 'loot', `${st.loot.filter(Boolean).length}/${st.loot.length}`);
    const gem = st.gems.length > 0 && st.gems.every(Boolean);
    if (hudCache.gem !== gem) {
      hudCache.gem = gem;
      ui.gem.classList.toggle('got', gem);
    }
  }

  /* ---------- loop ---------- */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (mode !== 'menu' && run) {
      if (replay) {
        replay.t += dt;
        if (replay.t > replay.end + 1.4) replay.t = -0.5;
      }
      const gt = replay ? Math.max(0, Math.min(replay.t, replay.end)) : run.t;
      const inst = dt > 0 ? Math.max(0, (gt - lastGameT) / dt) : 0;
      lastGameT = gt;
      flowRate += (inst - flowRate) * Math.min(1, dt * 14);
      Sfx.flow(mode === 'caught' ? 0 : flowRate);
      const ease = Math.min(1, dt * 9);
      view.s += (view.ts - view.s) * ease;
      view.ox += (view.tox - view.ox) * ease;
      view.oy += (view.toy - view.oy) * ease;
      shake = Math.max(0, shake - dt * 3.2);
      redFlash = Math.max(0, redFlash - dt * 1.6);
      const st = render(now);
      if (st) updateHud(st);
    } else {
      Sfx.flow(0);
      render(now);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */

  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s };
  }

  function feed(p) {
    run.target = { x: p.x + run.grab.x, y: p.y + run.grab.y };
    penTo(run.target.x, run.target.y);
    advance();
  }

  canvas.addEventListener('pointerdown', (e) => {
    Sfx.unlock();
    if (mode === 'caught') {
      if (performance.now() > bustReadyAt) restart();
      return;
    }
    if (mode !== 'play' || run.drawing) return;
    e.preventDefault();
    const p = toWorld(e);
    const end = penEnd();
    run.grab = { x: end.x - p.x, y: end.y - p.y };
    run.drawing = true;
    run.pid = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture is best effort */
    }
    ui.hint.classList.add('gone');
    if (ui.flash.textContent) clearFlash();
    feed(p);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'play' || !run.drawing || e.pointerId !== run.pid) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (list.length) {
      for (const ev of list) {
        if (mode !== 'play') break;
        feed(toWorld(ev));
      }
    } else {
      feed(toWorld(e));
    }
  });

  const lift = (e) => {
    if (run && run.drawing && e.pointerId === run.pid) {
      run.drawing = false;
      run.pid = null;
      run.target = null;
    }
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('lostpointercapture', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  /* Leaving the page (or the Android app) mid-drag must not leave the clock or the drone running. */
  function pause() {
    if (run) {
      run.drawing = false;
      run.pid = null;
      run.target = null;
    }
    Sfx.flow(0);
    Sfx.suspend();
  }
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      if (mode !== 'menu') restart();
    } else if (e.key === 'Escape') {
      if (mode !== 'menu') goMenu();
    } else if (e.key === 'Enter' && mode === 'won' && !ui.results.hidden) {
      nextLevel();
    }
  });

  $('btn-menu').addEventListener('click', goMenu);
  $('btn-restart').addEventListener('click', () => {
    Sfx.unlock();
    restart();
  });
  $('btn-retry').addEventListener('click', restart);
  $('btn-again').addEventListener('click', restart);
  $('btn-next').addEventListener('click', nextLevel);
  $('btn-busted-menu').addEventListener('click', goMenu);
  $('btn-results-menu').addEventListener('click', goMenu);
  for (const b of ui.sound) {
    b.addEventListener('click', () => {
      save.sound = !save.sound;
      persist();
      Sfx.unlock();
      syncSound();
    });
  }

  window.addEventListener('resize', () => {
    resize();
  });

  // Hooks for the Android shell (android/) and automated play-testing (tools/playtest.js).
  window.TMWYD = {
    /* Hardware back: leave a heist for the heist list. Returns false on the menu so the app can close. */
    back: () => {
      if (mode === 'menu') return false;
      goMenu();
      return true;
    },
    pause,
    state: () => ({
      mode,
      level: L.index,
      t: run ? run.t : 0,
      x: run ? run.x : 0,
      y: run ? run.y : 0,
      loot: run ? run.loot.slice() : [],
      gems: run ? run.gems.slice() : [],
      alert: run ? run.alert : 0,
      resultsOpen: !ui.results.hidden,
    }),
    toScreen: (x, y) => {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + view.ox + x * view.s, y: r.top + view.oy + y * view.s };
    },
  };

  // Inside another page's frame (itch.io embeds the game this way), keep clear of the host's overlay buttons.
  try {
    if (window.self !== window.top) document.documentElement.classList.add('embedded');
  } catch (e) {
    document.documentElement.classList.add('embedded'); // a cross-origin parent can refuse the check; that means framed too
  }

  syncSound();
  renderMenu();
  resize();
  requestAnimationFrame(frame);
})();
