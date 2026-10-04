/*
 * Simulation core for "Time Moves When You Draw".
 *
 * Everything that can catch the thief (guards, cameras, lasers) is a pure
 * function of game time `t`. The game only decides how fast `t` advances
 * (it advances when the thief walks), so the live game, the real-time replay
 * and the offline solver in tools/solve.js all share this file.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 24;
  const COLS = 15;
  const ROWS = 25;
  const THIEF_R = 7;
  const GUARD_R = 8;
  const SPEED = 84; // thief walking speed, px per game-second
  const TURN = 3.2; // guard turn rate, rad per game-second
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  function wrapAngle(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  function tileCenter(c, r) {
    return { x: (c + 0.5) * TILE, y: (r + 0.5) * TILE };
  }

  function smooth(u) {
    return u * u * (3 - 2 * u);
  }

  /* ---------- level compilation ---------- */

  function compile(def, index) {
    const rows = def.map;
    const h = rows.length;
    const w = rows[0].length;
    if (w !== COLS || h !== ROWS) {
      throw new Error(`Level ${index + 1} "${def.name}" is ${w}x${h}, expected ${COLS}x${ROWS}`);
    }
    const grid = new Uint8Array(w * h);
    let start = null;
    let exit = null;
    const loot = [];
    const gems = [];
    for (let r = 0; r < h; r++) {
      if (rows[r].length !== w) throw new Error(`Level ${index + 1} row ${r} has width ${rows[r].length}`);
      for (let c = 0; c < w; c++) {
        const ch = rows[r][c];
        if (ch === '#') grid[r * w + c] = 1;
        else if (ch === 'S') start = tileCenter(c, r);
        else if (ch === 'E') exit = tileCenter(c, r);
        else if (ch === '$') loot.push(tileCenter(c, r));
        else if (ch === '*') gems.push(tileCenter(c, r));
        else if (ch !== '.') throw new Error(`Level ${index + 1}: unknown tile "${ch}" at ${c},${r}`);
      }
    }
    if (!start || !exit) throw new Error(`Level ${index + 1} needs an S and an E`);

    const L = {
      index,
      name: def.name,
      hint: def.hint || '',
      par: def.par || 0,
      w,
      h,
      grid,
      start,
      exit,
      loot,
      gems,
      guards: [],
      cameras: [],
      lasers: [],
    };
    L.guards = (def.guards || []).map(compileGuard);
    L.cameras = (def.cameras || []).map(compileCamera);
    L.lasers = (def.lasers || []).map((l) => compileLaser(L, l));
    return L;
  }

  /*
   * A guard's patrol is baked into a looping timeline of segments:
   * hold at a waypoint, turn towards the next one, walk to it.
   * Guards with a single waypoint stand still and cycle through `look` angles.
   */
  function compileGuard(g) {
    const speed = (g.speed != null ? g.speed : 2) * TILE;
    const pts = g.path.map(([c, r]) => tileCenter(c, r));
    const pauseOf = (i) => {
      if (Array.isArray(g.pause)) return g.pause[i % g.pause.length] || 0;
      return g.pause != null ? g.pause : 0.5;
    };
    const segs = [];
    let t = 0;
    const push = (dur, x0, y0, x1, y1, a0, a1, walk) => {
      if (dur <= 1e-6) return;
      segs.push({ t0: t, t1: t + dur, x0, y0, x1, y1, a0, a1, walk });
      t += dur;
    };

    let route = pts;
    if (pts.length === 1) {
      const p = pts[0];
      const looks = (g.look || [90]).map((d) => d * DEG);
      let a = looks[0];
      for (let i = 0; i < looks.length; i++) {
        push(pauseOf(i), p.x, p.y, p.x, p.y, a, a, false);
        const d = wrapAngle(looks[(i + 1) % looks.length] - a);
        push(Math.abs(d) / TURN, p.x, p.y, p.x, p.y, a, a + d, false);
        a += d;
      }
      if (t <= 0) push(1, p.x, p.y, p.x, p.y, a, a, false);
    } else {
      const pingpong = (g.mode || 'pingpong') === 'pingpong';
      const idx = pts.map((_, i) => i);
      const order = pingpong ? idx.concat(idx.slice(1, -1).reverse()) : idx;
      route = order.map((i) => pts[i]);
      const n = route.length;
      const dir = (i) => {
        const p = route[i];
        const q = route[(i + 1) % n];
        return Math.atan2(q.y - p.y, q.x - p.x);
      };
      let a = dir(n - 1);
      for (let i = 0; i < n; i++) {
        const p = route[i];
        const q = route[(i + 1) % n];
        const d = wrapAngle(dir(i) - a);
        const turn = Math.abs(d) / TURN;
        push(Math.max(0, pauseOf(order[i]) - turn), p.x, p.y, p.x, p.y, a, a, false);
        push(turn, p.x, p.y, p.x, p.y, a, a + d, false);
        a += d;
        push(Math.hypot(q.x - p.x, q.y - p.y) / speed, p.x, p.y, q.x, q.y, a, a, true);
      }
    }

    return {
      segs,
      period: t,
      offset: g.offset || 0,
      fov: (g.fov != null ? g.fov : 70) * DEG,
      range: (g.range != null ? g.range : 5) * TILE,
      route: pts,
      loop: pts.length > 2 && g.mode === 'loop',
    };
  }

  function guardState(g, t) {
    let tt = (t + g.offset) % g.period;
    if (tt < 0) tt += g.period;
    const segs = g.segs;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].t1 <= tt) lo = mid + 1;
      else hi = mid;
    }
    const s = segs[lo];
    const u = Math.min(1, Math.max(0, (tt - s.t0) / (s.t1 - s.t0)));
    const k = s.walk ? u : smooth(u);
    return {
      x: s.x0 + (s.x1 - s.x0) * u,
      y: s.y0 + (s.y1 - s.y0) * u,
      a: s.a0 + (s.a1 - s.a0) * k,
      walk: s.walk,
    };
  }

  function compileCamera(c) {
    const p = tileCenter(c.at[0], c.at[1]);
    return {
      x: p.x,
      y: p.y,
      base: c.angle * DEG,
      sweep: (c.sweep || 0) * DEG,
      period: c.period || 6,
      phase: c.phase || 0,
      fov: (c.fov != null ? c.fov : 50) * DEG,
      range: (c.range != null ? c.range : 6) * TILE,
    };
  }

  function cameraAngle(cam, t) {
    return cam.base + cam.sweep * Math.sin(TAU * (t / cam.period + cam.phase));
  }

  function compileLaser(L, l) {
    const a = tileCenter(l.a[0], l.a[1]);
    const b = tileCenter(l.b[0], l.b[1]);
    // Clip the beam to the floor so emitters sit on the wall faces.
    const face = (p, q) => {
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      for (let s = 0; s <= len; s += 0.5) {
        const x = p.x + ((q.x - p.x) * s) / len;
        const y = p.y + ((q.y - p.y) * s) / len;
        if (!isWallAt(L, x, y)) return { x, y };
      }
      return { x: q.x, y: q.y };
    };
    const fa = face(a, b);
    const fb = face(b, a);
    return {
      ax: fa.x,
      ay: fa.y,
      bx: fb.x,
      by: fb.y,
      on: l.on != null ? l.on : 1,
      off: l.off || 0,
      phase: l.phase || 0,
    };
  }

  /* Returns whether the beam is lit and how long until it flips. */
  function laserState(l, t) {
    if (l.off <= 0) return { on: true, left: Infinity };
    const cyc = l.on + l.off;
    let u = (t + l.phase) % cyc;
    if (u < 0) u += cyc;
    return u < l.on ? { on: true, left: l.on - u } : { on: false, left: cyc - u };
  }

  /* ---------- geometry ---------- */

  function isWall(L, c, r) {
    return c < 0 || r < 0 || c >= L.w || r >= L.h || L.grid[r * L.w + c] === 1;
  }

  function isWallAt(L, x, y) {
    return isWall(L, Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /* Push a circle out of any wall tiles it overlaps. */
  function collide(L, x, y, rad) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const c0 = Math.floor((x - rad) / TILE);
      const c1 = Math.floor((x + rad) / TILE);
      const r0 = Math.floor((y - rad) / TILE);
      const r1 = Math.floor((y + rad) / TILE);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!isWall(L, c, r)) continue;
          const left = c * TILE;
          const top = r * TILE;
          const nx = Math.max(left, Math.min(x, left + TILE));
          const ny = Math.max(top, Math.min(y, top + TILE));
          const dx = x - nx;
          const dy = y - ny;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rad * rad) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            x += (dx / d) * (rad - d);
            y += (dy / d) * (rad - d);
          } else {
            // Centre is inside the tile: leave through the nearest edge.
            const exits = [
              [x - left + rad, -1, 0],
              [left + TILE - x + rad, 1, 0],
              [y - top + rad, 0, -1],
              [top + TILE - y + rad, 0, 1],
            ].sort((p, q) => p[0] - q[0]);
            x += exits[0][1] * exits[0][0];
            y += exits[0][2] * exits[0][0];
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, y };
  }

  /* Grid DDA: distance from (x, y) along `ang` to the first wall, capped at maxDist. */
  function castRay(L, x, y, ang, maxDist) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let cx = Math.floor(x / TILE);
    let cy = Math.floor(y / TILE);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((cx + 1) * TILE - x) / dx : dx < 0 ? (cx * TILE - x) / dx : Infinity;
    let tMaxY = dy > 0 ? ((cy + 1) * TILE - y) / dy : dy < 0 ? (cy * TILE - y) / dy : Infinity;
    for (let i = 0; i < 256; i++) {
      let t;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        cy += stepY;
      }
      if (t >= maxDist) return maxDist;
      if (isWall(L, cx, cy)) return t;
    }
    return maxDist;
  }

  function lineClear(L, x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1e-6) return true;
    return castRay(L, x0, y0, Math.atan2(y1 - y0, x1 - x0), d) >= d - 1e-6;
  }

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let u = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(px - (ax + vx * u), py - (ay + vy * u));
  }

  /* ---------- threats ---------- */

  /* Everything with eyes at time t: guards and cameras. */
  function viewers(L, t) {
    const out = [];
    for (let i = 0; i < L.guards.length; i++) {
      const g = L.guards[i];
      const s = guardState(g, t);
      out.push({ kind: 'guard', i, x: s.x, y: s.y, a: s.a, fov: g.fov, range: g.range, walk: s.walk });
    }
    for (let i = 0; i < L.cameras.length; i++) {
      const c = L.cameras[i];
      out.push({ kind: 'camera', i, x: c.x, y: c.y, a: cameraAngle(c, t), fov: c.fov, range: c.range });
    }
    return out;
  }

  function sees(L, v, x, y) {
    const dx = x - v.x;
    const dy = y - v.y;
    const d = Math.hypot(dx, dy);
    if (d > v.range + THIEF_R * 0.5) return false;
    if (d > 1) {
      const slack = Math.asin(Math.min(1, (THIEF_R * 0.6) / d));
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - v.a)) > v.fov / 2 + slack) return false;
    }
    return lineClear(L, v.x, v.y, x, y);
  }

  /*
   * What threatens a thief standing at (x, y) at time t?
   * `lethal` ends the run instantly (laser, bumping into a guard);
   * `seen` is the viewer that has eyes on the thief, if any.
   * `margin` (px) widens the lethal checks; the solver uses it to stay clear.
   */
  function threat(L, x, y, t, vs, margin) {
    vs = vs || viewers(L, t);
    margin = margin || 0;
    let lethal = null;
    let seen = null;
    for (const v of vs) {
      if (v.kind === 'guard' && Math.hypot(x - v.x, y - v.y) < GUARD_R + THIEF_R + margin) {
        lethal = { kind: 'bump', viewer: v };
        break;
      }
    }
    if (!lethal) {
      for (let i = 0; i < L.lasers.length; i++) {
        const l = L.lasers[i];
        if (laserState(l, t).on && segDist(x, y, l.ax, l.ay, l.bx, l.by) < THIEF_R - 1 + margin) {
          lethal = { kind: 'laser', laser: i };
          break;
        }
      }
    }
    for (const v of vs) {
      if (sees(L, v, x, y)) {
        seen = v;
        break;
      }
    }
    return { lethal, seen };
  }

  return {
    TILE,
    COLS,
    ROWS,
    THIEF_R,
    GUARD_R,
    SPEED,
    DEG,
    TAU,
    wrapAngle,
    tileCenter,
    compile,
    guardState,
    cameraAngle,
    laserState,
    isWall,
    isWallAt,
    collide,
    castRay,
    lineClear,
    segDist,
    viewers,
    sees,
    threat,
  };
});
