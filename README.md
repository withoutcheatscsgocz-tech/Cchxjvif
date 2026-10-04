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

## Android app

`android/` wraps the same game in a tiny native app: one Activity with a
full-screen WebView, no libraries, about 170 KB. The game files are copied
into the APK at build time and served from
`https://appassets.androidplatform.net/`, so progress saves normally and the
app needs no internet permission. The hardware back button leaves a heist
(and closes the app from the heist list), leaving the app mid-drag stops the
clock and the sound, the screen stays on while you plan, and the system bars
stay hidden until swiped in.

**Get the APK.** Every push that changes the game, the app or `tools/`
builds it in GitHub Actions (workflow *Android APK*, artifact
`time-moves-when-you-draw-apk`). Pushing a `v*` tag also
attaches it to a GitHub release. On the phone, open the `.apk` and allow
installs from that source.

**Build it yourself** (JDK 17+, Android SDK with platform 36):

```sh
cd android
./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

The version comes from `package.json` (`1.2.3` → versionName 1.2.3,
versionCode 10203), so bump it there before a release.

**Signing.** Builds are signed with `android/app/debug.keystore`, which is
committed on purpose (like React Native's template): it is not a secret, and
sharing it means a new build always installs over the old one without losing
saved stars. For a store release use your own key. Set `ANDROID_KEYSTORE`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`
locally, or in CI add the repository secrets `ANDROID_KEYSTORE_BASE64`
(`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
and `ANDROID_KEY_PASSWORD`. Apps signed with different keys can't update
each other, so pick one before you share builds widely.

To check the packaged game rather than the repo copy:

```sh
unzip -q app-release.apk 'assets/web/*' -d /tmp/apk
node tools/playtest.js --root /tmp/apk/assets/web --touch
```

## itch.io

The browser version goes on itch.io as an HTML5 game, with the APK as an
extra Android download. `itch/PAGE.md` walks through the itch.io dashboard
field by field (embed settings, tags, description, images); this section
covers the files.

**Build the web zip.**

```sh
npm run build:web    # → dist/web/ and dist/time-moves-when-you-draw-web-<version>.zip
npm run playtest:web # build, then play every heist inside a 450 × 800 iframe
                     # (needs Playwright: npm ci && npx playwright install chromium)
```

The build is `index.html`, `js/` and `fonts/`, with one change: scripts,
stylesheet and fonts are linked as `file?v=<hash>`, because itch.io caches
them for a month and only refreshes `index.html`. It stops with an error if
itch.io would reject or break the build (index.html not at the root, over
1,000 files, paths over 240 characters, absolute, missing or wrong-case
links, anything loaded from another server). The zip is reproducible: same sources,
same bytes. `--iframe 450x800` plays the game the way itch.io embeds it: in a
frame of that size on a page from another origin, behind a "Run game" click,
with itch's fullscreen button over the corner.

**Upload by hand.** Create the page with *Kind of project* set to HTML,
upload the zip and tick *This file will be played in the browser*. Embed it
at 450 × 800 with *Mobile friendly* on (Portrait), the fullscreen button on,
and click to launch. Add `time-moves-when-you-draw-<version>.apk` (from the
GitHub release, or inside the zip GitHub gives you for the
`time-moves-when-you-draw-apk` artifact) as a second file with only
*Android* ticked.

**Or let CI publish it.** The `itch` job in the *Android APK* workflow runs
after the APK job on `v*` tags and manual runs. It builds the web version,
plays it in the itch-style frame, then uses
[butler](https://itch.io/docs/butler/) to push it to the `html5` channel and
the APK to the `android` channel, both labelled with the `package.json`
version. To turn it on:

1. Create the itch.io page first (butler can't), with *Kind of project* set
   to HTML, and keep it a draft. Don't also upload a zip by hand; if you
   did, delete it so the butler upload is the one that plays.
2. Get an API key: run `butler login` once on your computer and copy the key
   from `butler_creds` (Linux `~/.config/itch/`, macOS
   `~/Library/Application Support/itch/`, Windows
   `%USERPROFILE%\.config\itch\`), or copy the `wharf` key from
   [itch.io/user/settings/api-keys](https://itch.io/user/settings/api-keys).
   Paste it without a trailing newline; if it ever shows up in a log, revoke
   it there.
3. In the GitHub repo, *Settings → Secrets and variables → Actions*: add the
   secret `BUTLER_API_KEY`, and the variable `ITCH_GAME` set to
   `<itch-username>/time-moves-when-you-draw` (the page's address is
   `https://<itch-username>.itch.io/time-moves-when-you-draw`).
4. Push a tag that matches the version in `package.json` (bump it there
   first for every later release): `git tag v1.0.0 && git push origin v1.0.0`.
   Or start the workflow by hand: *Actions → Android APK → Run workflow*,
   which publishes whatever branch you pick.
5. After the first push only: on the page's edit screen, tick *This file
   will be played in the browser* on the `html5` upload, then set up the
   embed as above. Later pushes to the same channel should keep it; check
   the page after the second release.

Until the secret and the variable exist, the job still builds and checks the
web version (artifact `time-moves-when-you-draw-web`) and skips the upload
with a notice.

Stars are kept per browser, so the itch.io page, a GitHub Pages copy and the
app each have their own. itch.io runs the game in a third-party frame, so
Safari (and every iPhone browser) and private windows may forget them when
the browser closes; the app keeps them for good.

## How it works

```
index.html         page, HUD, menu and result sheets (CSS inline)
js/sim.js          the rules: map, collisions, sightlines, guard/camera/laser timelines
js/levels.js       the 8 heists (ASCII maps + patrol data)
js/audio.js        synthesized sound (Web Audio, no files)
js/game.js         input, game loop, canvas rendering, screens
fonts/             Big Shoulders Display + IBM Plex Mono (OFL), bundled for offline play
android/           the Android app (WebView shell, Gradle project)
itch/              the itch.io page: dashboard guide (PAGE.md), copy, cover, screenshots
tools/solve.js     proves every heist is beatable and suggests par times
tools/playtest.js  plays every heist in headless Chromium along the solver's route,
                   offline, with mouse or touch (--touch), optionally inside an
                   itch.io-style iframe (--iframe 450x800)
tools/build-web.js builds the web version for itch.io: dist/web/ and a zip
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
