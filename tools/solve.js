#!/usr/bin/env node
/*
 * Offline solver: proves every level can be beaten and suggests par times.
 *
 * It searches (tile, loot collected) states over game time in half-step
 * layers. A move to a neighbouring tile costs 2 half-steps, a diagonal 3,
 * and waiting in place 1. Every move is sampled against Sim.threat with no
 * grace period and extra clearance, so it is stricter than the game (which
 * lets a guard glimpse you for a moment). If this finds a route, a player
 * can follow it; tools/playtest.js proves that in a real browser.
 *
 *   node tools/solve.js            all levels
 *   node tools/solve.js 3 --map    level 3, and draw the route
 */
'use strict';

const Sim = require('../js/sim.js');
const LEVELS = require('../js/levels.js');

const HALF = Sim.TILE / Sim.SPEED / 2; // game-seconds per half-step
const MARGIN = 5; // extra px of clearance from guards and lasers, so sampled routes stay safe in between
const MAX_T = 150;

function solve(L, wantGem) {
  const W = L.w;
  const cellOf = (p) => Math.floor(p.y / Sim.TILE) * W + Math.floor(p.x / Sim.TILE);
  const pickups = L.loot.map(cellOf);
  if (wantGem) pickups.push(...L.gems.map(cellOf));
  const full = (1 << pickups.length) - 1;
  const exitCell = cellOf(L.exit);
  const startCell = cellOf(L.start);
  const N = W * L.h * (full + 1);
  const layers = Math.ceil(MAX_T / HALF) + 4;
  const seen = new Map(); // layer -> Uint8Array
  const parent = new Map(); // layer*N+state -> prev layer*N+state

  const center = (cell) => ({ x: ((cell % W) + 0.5) * Sim.TILE, y: (Math.floor(cell / W) + 0.5) * Sim.TILE });
  const safe = (x, y, t) => {
    const th = Sim.threat(L, x, y, t, null, MARGIN);
    return !th.lethal && !th.seen;
  };
  const maskAt = (cell, mask) => {
    for (let i = 0; i < pickups.length; i++) if (pickups[i] === cell) mask |= 1 << i;
    return mask;
  };
  const layer = (k) => {
    let a = seen.get(k);
    if (!a) seen.set(k, (a = new Uint8Array(N)));
    return a;
  };

  if (!safe(L.start.x, L.start.y, 0)) return { error: 'start is unsafe' };
  const s0 = maskAt(startCell, 0) * W * L.h + startCell;
  layer(0)[s0] = 1;

  const moves = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      moves.push({ dx, dy, cost: dx === 0 && dy === 0 ? 1 : dx !== 0 && dy !== 0 ? 3 : 2 });
    }
  }

  for (let k = 0; k < layers; k++) {
    const cur = seen.get(k);
    if (!cur) continue;
    for (let s = 0; s < N; s++) {
      if (!cur[s]) continue;
      const cell = s % (W * L.h);
      const mask = Math.floor(s / (W * L.h));
      if (cell === exitCell && mask === full) {
        const route = [];
        let key = k * N + s;
        while (key !== undefined) {
          route.push({ t: Math.floor(key / N) * HALF, cell: (key % N) % (W * L.h) });
          key = parent.get(key);
        }
        return { t: k * HALF, route: route.reverse() };
      }
      const c = cell % W;
      const r = Math.floor(cell / W);
      const from = center(cell);
      for (const m of moves) {
        const nc = c + m.dx;
        const nr = r + m.dy;
        if (Sim.isWall(L, nc, nr)) continue;
        if (m.dx && m.dy && (Sim.isWall(L, c + m.dx, r) || Sim.isWall(L, c, r + m.dy))) continue;
        const ncell = nr * W + nc;
        const nk = k + m.cost;
        const to = center(ncell);
        let ok = true;
        const samples = m.cost * 3;
        for (let j = 1; j <= samples && ok; j++) {
          const u = j / samples;
          ok = safe(from.x + (to.x - from.x) * u, from.y + (to.y - from.y) * u, (k + m.cost * u) * HALF);
        }
        if (!ok) continue;
        const ns = maskAt(ncell, mask) * W * L.h + ncell;
        const next = layer(nk);
        if (next[ns]) continue;
        next[ns] = 1;
        parent.set(nk * N + ns, k * N + s);
      }
    }
    seen.delete(k);
  }
  return { error: `no route within ${MAX_T}s` };
}

function drawRoute(def, route) {
  const rows = def.map.map((row) => row.split(''));
  const W = rows[0].length;
  let waits = 0;
  route.forEach((p, i) => {
    const c = p.cell % W;
    const r = Math.floor(p.cell / W);
    if (i > 0 && route[i - 1].cell === p.cell) waits++;
    if (rows[r][c] === '.') rows[r][c] = 'o';
  });
  return rows.map((r) => '    ' + r.join('')).join('\n') + `\n    (${waits} half-steps spent waiting)`;
}

module.exports = { solve, HALF };
if (require.main !== module) return;

const args = process.argv.slice(2);
const only = args.find((a) => /^\d+$/.test(a));
const showMap = args.includes('--map');
let failed = false;

LEVELS.forEach((def, i) => {
  if (only && Number(only) !== i + 1) return;
  const L = Sim.compile(def, i);
  const base = solve(L, false);
  const gem = L.gems.length ? solve(L, true) : null;
  const fmt = (res) => (res.error ? `FAIL (${res.error})` : `${res.t.toFixed(2)}s`);
  // Par leaves room for human scribbling, and is reachable on the same run as the gem.
  const ref = gem && !gem.error ? gem : base;
  const suggested = ref.error ? '-' : (Math.ceil(ref.t * 1.3 * 2) / 2).toFixed(1);
  console.log(
    `${String(i + 1).padStart(2)} ${def.name.padEnd(18)} escape ${fmt(base).padEnd(10)} with gem ${gem ? fmt(gem).padEnd(10) : 'n/a'.padEnd(10)}` +
      ` par ${String(def.par).padEnd(4)} (suggest ${suggested})`
  );
  if (base.error || (gem && gem.error)) failed = true;
  if (showMap && !base.error) console.log(drawRoute(def, (gem && !gem.error ? gem : base).route));
});

process.exit(failed ? 1 : 0);
