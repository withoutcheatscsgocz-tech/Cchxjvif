# Time Moves When You Draw

A one-finger heist. You draw the thief's route with your finger, and the clock
only runs while you draw. Guards, cameras and lasers move exactly as far as
you do. Lift your finger and the whole building freezes, so you can stop
mid-step and plan the next move.

Grab the gold, reach the exit, don't get seen.

## Play

No build step, no dependencies. Open `index.html` in a browser, or serve the
folder so it also works on your phone:

```sh
npx serve .            # or: python3 -m http.server
```

It is a static site, so GitHub Pages works as-is (Settings → Pages → deploy
from branch, root folder).

- **Touch anywhere and drag.** The route grows from its current end and keeps
  the offset your finger started at, so you can draw from below the thief and
  keep it in view.
- **Time = distance.** Every pixel the thief walks is 1/84 of a game-second.
  Standing still costs nothing; to let time pass, scribble in place.
- **Getting seen.** A guard needs about 0.3 game-seconds of eye contact to
  catch you; the cone turns solid red when it is looking at you. Lasers and
  walking into a guard end the run at once. Dashed beams are off and brighten
  just before they switch on; the ring on an emitter counts down the current
  phase.
- **Stars**, kept per browser: escape, take the gem, beat par. You can earn
  them on different runs.
- **Replay.** A clean escape replays your whole heist in real time, so you can
  watch the guards actually move.
- Keyboard: `R` restarts, `Esc` opens the heist list, `Enter` goes to the next
  heist from the results.

## How it works

```
index.html        page, HUD, menu and result sheets (CSS inline)
js/sim.js         the rules: map, collisions, sightlines, guard/camera/laser timelines
js/levels.js      the 8 heists (ASCII maps + patrol data)
js/audio.js       synthesized sound (Web Audio, no files)
js/game.js        input, game loop, canvas rendering, screens
tools/solve.js    proves every heist is beatable and suggests par times
tools/playtest.js plays every heist in headless Chromium along the solver's route
```

Everything that can catch you is a **pure function of game time** (`sim.js`).
A guard's patrol is baked into a looping timeline (hold, turn, walk), a camera
sweeps on a sine, a laser blinks on a fixed cycle. The game only decides how
fast time advances, and it advances by distance walked. That one choice gives
three things for free:

1. **Freeze.** No input means no time, so nothing to simulate.
2. **Replay.** Record the thief's position per game-second and evaluate the
   world at any `t`, so the real-time replay is exact.
3. **A solver.** `tools/solve.js` searches tile × loot × time with no grace
   period and a safety margin around guards and lasers, so a route it finds
   is a route a player can take.

## Making a heist

Maps in `js/levels.js` are 15 × 25 tiles:

| char | meaning |
| ---- | ------- |
| `#`  | wall |
| `.`  | floor |
| `S`  | start |
| `E`  | exit (opens once all gold is taken) |
| `$`  | gold (all of it is required) |
| `*`  | bonus gem (optional, worth a star) |

```js
guards: [
  { path: [[1, 7], [13, 7]], speed: 2, pause: 0.8 },       // walks back and forth
  { path: [[7, 9]], look: [0, 270, 180, 270], pause: 2 },  // sentry turning its head
],
cameras: [{ at: [13, 16], angle: 180, sweep: 40, period: 5, range: 8 }],
lasers: [{ a: [5, 16], b: [9, 16], on: 1.2, off: 1.2, phase: 0 }], // a, b are wall tiles
```

Coordinates are `[column, row]`, angles in degrees (0 = right, 90 = down),
speeds in tiles per game-second. Then check the heist:

```sh
npm run solve              # every heist: fastest escape, with gem, suggested par
node tools/solve.js 8 --map  # draw the route for heist 8
npm run playtest           # play them all in a real browser (needs Playwright)
```

`playtest` drags the mouse along the solver's route, waiting by scribbling the
way a player would, and checks that the thief escapes with the gem and that
the game clock matches the solver's clock.
