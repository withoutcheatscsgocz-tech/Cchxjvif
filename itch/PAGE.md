# itch.io page setup: Time Moves When You Draw

## Rychlý postup (česky)

1. **Soubory.** `npm run build:web` vytvoří `dist/time-moves-when-you-draw-web-1.0.0.zip`. APK stáhni z GitHub Actions (artefakt `time-moves-when-you-draw-apk`, uvnitř je `time-moves-when-you-draw-1.0.0.apk`).
2. **Nová stránka** na <https://itch.io/game/new>: název *Time Moves When You Draw*, adresa `time-moves-when-you-draw`, tagline z části „Short description“ níže, *Classification* = Games, *Kind of project* = **HTML**, *Release status* = Released, *Pricing* = No payments.
3. **Nahrání.** ZIP nahraj a zaškrtni *This file will be played in the browser*. APK nahraj a zaškrtni jen *Android*. (Nebo to nech na CI přes butler, viz „Automatic uploads with butler“. Pak nic nenahrávej ručně.)
4. **Embed:** *Embed in page*, 450 × 800, *Mobile friendly* zapnuto s orientací *Portrait*, *Fullscreen button* zapnuto, *Automatically start on page load* vypnuto.
5. **Popis:** v editoru popisu přepni na HTML (tlačítko `<>`) a vlož celý obsah `itch/description.html`. Zpátky do běžného editoru už nepřepínej. *Genre* = Puzzle, 10 tagů ze seznamu níže.
6. **Generative AI disclosure:** **Yes** a zaškrtni Code, Graphics, Text & Dialog a Sound.
7. **Obrázky:** cover `itch/cover.png`, screenshoty `itch/gameplay.gif` a `itch/screens/*.png`. Po uložení otevři *Edit theme*: barvy a fonty podle části „Theme“, banner `itch/banner.png`, *Layout → Screenshots* = Sidebar.
8. **Test a zveřejnění.** Stránku nech jako **Draft**, ulož ji a otevři tajný odkaz na počítači i na telefonu. Projdi kontrolní seznam na konci. Až pak přepni *Visibility* na **Public**. Zveřejni jen jednou, až bude vše hotové: do seznamu „Most Recent“ se hra dostane jen napoprvé.

---

Everything below follows the itch.io edit form from top to bottom. `<itch-username>` stands for your itch.io account name, so the page will live at `https://<itch-username>.itch.io/time-moves-when-you-draw`.

## Before you start: the files

| File | What it is | Where it comes from |
| --- | --- | --- |
| `dist/time-moves-when-you-draw-web-1.0.0.zip` | Browser build, `index.html` at the zip root, 14 files, about 150 KB | `npm run build:web` (or `npm run playtest:web` to build it and play every heist in a 450 × 800 itch-style frame). CI also keeps it as the artifact `time-moves-when-you-draw-web` on `v*` tags and manual runs. |
| `dist/time-moves-when-you-draw-1.0.0.apk` | Android app, about 170 KB, Android 8.0+ | GitHub Actions, workflow *Android APK*, artifact `time-moves-when-you-draw-apk` (a zip; the APK is inside). A `v*` tag also attaches it to a GitHub release. Building locally gives `android/app/build/outputs/apk/release/app-release.apk`; rename it. |
| `itch/cover.png` | Cover, 630 × 500 (exactly 315:250) | in the repo |
| `itch/banner.png` | Page banner, 960 × 280, contains the title | in the repo |
| `itch/gameplay.gif` | One heist: drawn, frozen, escaped, replayed. Under 3 MB | in the repo |
| `itch/screens/01-title.png` … `05-escape-replay.png` | Five portrait screenshots, 900 × 1600 (the 450 × 800 embed at 2×) | in the repo |
| `itch/description.html` | The page description, paste-ready | in the repo |
| `itch/devlog-launch.md` | The launch devlog post | in the repo |

`tools/itch-assets.js` regenerates every image from the real game if the game changes.

Pick **one** upload route and stick to it: by hand (the *Uploads* step below) or with butler from CI (see [Automatic uploads with butler](#automatic-uploads-with-butler)). If both exist, an old hand-made upload can be the one that plays.

## 1. Create the page

Go to <https://itch.io/game/new>. The fields, in the order the form shows them:

### Title

`Time Moves When You Draw`

Search on itch.io works best on the exact title, and this one is not a single common word, which is good for being found.

### Project URL

`time-moves-when-you-draw`

itch fills it in from the title. Check that it reads exactly like this: the README and the `ITCH_GAME` variable for CI uploads use this slug.

### Short description or tagline

```
A one-finger heist. Guards, cameras and lasers only move while you draw. Lift your finger and the building freezes.
```

That is 115 characters. itch doesn't publish a limit, but none of 1,305 taglines sampled from itch's browse pages was longer than 120 characters, so treat 120 as the cap. The tagline appears in browse listings and in link previews when someone shares the page. Shorter alternative (60 characters): `A one-finger heist where the clock only runs while you draw.`

### Classification

**Games**

### Kind of project

**HTML**

This makes the page play the game in the browser. The APK can still be offered as a download on an HTML page. butler (if you use it) also needs the page to be HTML before a browser upload can be marked playable.

### Release status

**Released**

### Pricing

**No payments.** All files are free to download and nothing stands between a player and the APK.

The alternative is **$0 or donate**, if you want tips. Be aware that itch then shows a donation prompt before every download (with a "No thanks, just take me to the downloads" link). **Paid** doesn't fit: itch only takes donations for HTML5 games.

### Uploads

Skip this step if CI uploads with butler.

1. **Upload** `time-moves-when-you-draw-web-1.0.0.zip`. Tick **This file will be played in the browser**. Don't tick any platform box for it.
2. **Upload** `time-moves-when-you-draw-1.0.0.apk`. Set its type to **Executable** and tick **Android** only. Never tick Windows, macOS or Linux: itch asks you to tick only platforms the file runs on directly.
3. In the **download & install instructions** box, paste:

   ```
   Android app: Android 8.0 or newer, about 170 KB.
   Download the .apk on your phone and open it. Android asks once whether your browser (or file manager) may install apps: allow it, then tap Install. Play Protect may warn about an unknown developer, because the app is not on Google Play. The app needs no internet permission.
   A newer version installs over the old one and keeps your stars.
   ```

The last sentence holds while every build is signed with the same key. CI and local builds use the committed `android/app/debug.keystore`. If you ever switch to your own release key (the `ANDROID_KEYSTORE_BASE64` secret and the three that go with it), the key changes: players must uninstall the old app first, and they lose their stars. Pick a key before you share builds widely (README, *Signing*).

Google has announced developer verification for apps installed outside the Play Store. It starts on 30 September 2026 in Brazil, Indonesia, Singapore and Thailand and is planned to apply worldwide in 2027. Check <https://developer.android.com/developer-verification> before you rely on sideloading for the long term.

### Embed options

These appear because the kind is HTML.

| Setting | Value | Why |
| --- | --- | --- |
| Embed mode | **Embed in page** | Plays right on the page on desktop. |
| Viewport dimensions | **450 × 800** | A portrait phone shape, the size the screenshots and the playtest use. |
| Mobile friendly | **On**, Orientation **Portrait** | The game is built for phones: it resizes to the window and uses touch. Phones always get "click to launch in fullscreen", locked to portrait where the browser allows it. |
| Automatically start on page load | **Off** (click to launch) | With auto-start, some browsers mute the audio. |
| Fullscreen button | **On** | An 800 px frame doesn't fit on a 720–768 px laptop screen. The button sits over the bottom-right corner of the game and overlaps 15 × 20 px of the "Heists" button on the result sheet. `tools/playtest.js --iframe 450x800` checks that every result button stays tappable. |
| Enable scrollbars | **Off** | The heist list scrolls inside the game. |
| SharedArrayBuffer support | **Off** | The game doesn't need it. Turning it on later moves the game to another domain, and every player loses their stars. |

### Details

**Description.** In the description editor, click the **`<>`** button to switch to HTML mode, select everything in it, and paste the whole of `itch/description.html`. Don't switch back to the rich-text view afterwards, because that can rewrite or strip the markup. The file only uses tags itch keeps: `h2`, `p`, `strong`, `ul`, `ol`, `li` and `a`. It has no images, classes or styles. Use preview to check that the six `h2` section titles look like itch's own section headers.

**Genre.** **Puzzle**. The game is route planning with time stopped, which matches itch's description of Puzzle ("critical thinking to solve levels") better than Action.

**Tags.** Use all 10 slots. Type each one and pick it from the suggestions:

| Tag | Why it fits |
| --- | --- |
| Stealth | Don't get seen. |
| Heist | Grab the gold, reach the exit. |
| Top-Down | The camera looks straight down on the map. |
| Minimalist | Flat white world, red threats, black thief. |
| Drawing | You play by drawing a route. |
| Singleplayer | Single player only. |
| Short | 8 heists, one sitting. |
| Touch-Friendly | Built for one finger. |
| Tactical | Every move is planned with time frozen. |
| time-manipulation | The core mechanic. Free-form, but it is what people who want this kind of game search for. |

If you'd rather use only itch's suggested tags, swap `time-manipulation` for **Crime**. Don't add: *Puzzle* (it's already the genre), *superhot* (another game's name), *Time Travel* (a different mechanic), *mobile*, the game's own title, or any *AI* tag. The AI disclosure below adds those tags itself. Unrelated tags can get a page removed from browse.

**App store links.** Leave empty. The app is not on Google Play or the App Store.

**Custom noun.** Leave empty. "game" is right.

### Generative AI disclosure

Answer **Yes**, then tick:

- **Code**: the game, the solver, the playtest bot and the Android shell were written with Claude, Anthropic's AI assistant.
- **Graphics**: everything on screen is drawn by that code, and the cover, banner and screenshots are rendered from the game by `tools/itch-assets.js`. No image-generation model was used, but itch doesn't say whether art drawn by AI-written code counts, so ticking it is the safe reading.
- **Text & Dialog**: the in-game text, the level hints, the page description and the devlog.
- **Sound**: synthesized live by AI-written code. No audio files and no audio model, but the same reasoning applies.

itch asks for accurate tagging. Disclosing a little more than strictly needed is safe; disclosing too little can get a page delisted. The page will show an "AI Disclosure" row in its *More information* panel and appear on itch's AI-assisted browse page. itch also asks that AI use is stated in the description itself: `description.html` says so under *Credits*. If you want to add your own part (for example direction or playtesting), add it there in your own words, and only what is true.

### Metadata

Depending on itch's current layout, these fields are on the main form or on a separate *Metadata* tab of the edit page.

| Field | Value |
| --- | --- |
| Languages | **English** |
| Inputs | **Touchscreen**, **Mouse**. Leave *Keyboard* off: the keys are only shortcuts (R, Esc, Enter), and you can't play by keyboard alone. |
| Average session | **A few minutes**. Heists are short (par times are 11.5 to 36.5 game-seconds) and you play them one at a time. |
| Multiplayer | none |
| Accessibility | leave empty. No box has been checked against the game. |
| Code license / Asset license | leave empty for now. The repository has no LICENSE file, so there is no license to state. The fonts are under the SIL OFL 1.1, as the credits say. |
| Made with | leave empty. It is plain JavaScript with no engine. |
| Release date | leave the default. A future date would block downloads until that day. |
| Links | **Source code**: <https://github.com/withoutcheatscsgocz-tech/Cchxjvif> |

### Media (right-hand column)

**Cover image.** Upload `itch/cover.png`. It is 630 × 500, exactly itch's 315:250 ratio, so itch doesn't crop it in browse grids, and the title stays readable at thumbnail size. The cover is required: without one the page never shows up in browse or search.

**Gameplay video or trailer.** Leave empty. The field only takes YouTube, Vimeo or SketchFab links, and there is no video.

**Screenshots.** Upload in this order:

1. `itch/gameplay.gif`: the whole idea in motion. Put it first.
2. `itch/screens/02-planning.png`: Crossfire, frozen mid-route.
3. `itch/screens/03-busted.png`: Night Shift, caught by a guard.
4. `itch/screens/04-vault.png`: The Vault.
5. `itch/screens/05-escape-replay.png`: three stars and the replay.
6. `itch/screens/01-title.png`: the title screen.

itch recommends 3 to 5 screenshots. If you want to stay within that, leave out `01-title.png`; it also serves as the embed's background (see *Theme*). Every file is under itch's 3 MB limit. Portrait images display fine: the sidebar fits them into 347 × 500 px.

### Community

**Comments.**

### Visibility & access

**Draft** for now. Click **Save**.

A draft is only visible to you and to people with its secret link. It can be shared freely for testing, because drafts never appear in browse or search.

## 2. Edit theme

Open the saved page and click **Edit theme**.

**Layout → Screenshots: Sidebar.** The default, *Auto*, hides the screenshot column on pages with a game embed, so without this change nobody sees the screenshots.

**Banner:** upload `itch/banner.png` (960 × 280, the width of itch's page column). It replaces the title text above the description, and it contains the title, so nothing is lost. Its background is the game's paper colour, `#eceef1`, so it blends into the column below.

**Colours**, from the game's own palette:

| Field | Value | In the game |
| --- | --- | --- |
| BG (page background) | `#eceef1` | paper |
| BG2 (content column) | `#eceef1`, alpha 100% (under *More options*) | paper |
| Text | `#121317` | ink |
| Link | `#e5202b` | the red of cones and lasers |
| Buttons | `#121317` | the game's black buttons |
| Headers | `#121317` | ink |

For a framed look instead, set BG to `#121317` and keep BG2 at `#eceef1`.

**Fonts:** Headers **Big Shoulders Display**, Body **IBM Plex Mono**. These are the game's own fonts, and itch offers every Google Font in its font lists. Google Fonts now files the first one under the family name **Big Shoulders**, so pick whichever of the two names the list shows. If neither is offered, the closest stand-ins are *Oswald* for headers and *Space Mono* for body text.

**Embed / Run game placeholder:** set the background image behind the "Run game" button to `itch/screens/01-title.png`, so the frame looks like the game before it starts. Leave the gradient overlay off.

Save the theme.

## 3. Test the draft

Open the draft's secret link while logged out (or in another browser).

**Desktop**

- Click **Run game**. The title screen appears. Sound plays once you click inside the game.
- Scroll down inside the game to reach the heist list. At 450 × 800 the title fills the first screen, so the heists start below it.
- Play heist 1. The clock runs only while you drag.
- Finish it. The result sheet's Retry, Next and Heists buttons all respond, including "Heists" next to itch's fullscreen button.
- Click into the game, then try R, Esc and Enter.
- Try the fullscreen button. In browser fullscreen, Esc leaves fullscreen first.
- Reload the page. Your stars are still there.

**Android phone (Chrome)**

- Tap **Run game**. The game opens fullscreen in portrait.
- Check that the bottom of the screen isn't cut off on the first launch: finish a heist and look at the result sheet. Other itch games have reported this with Portrait until the first tap.
- Drag to play. With sound on, pickups and getting caught should buzz.
- Download the APK from the page, install it and play one heist.

**iPhone (if you have one)**

- itch opens the game "maximized" instead of fullscreen, because iPhone Safari has no fullscreen for page elements. Check that it plays and that swiping back leaves it.
- Stars may be forgotten once Safari closes. That is expected (the description says so).

## 4. Publish

When every box in the checklist below is ticked, set **Visibility & access** to **Public** and save.

- **Publish once, when it's ready.** The first time a page goes public, it enters itch's *Most Recent* list. That can't happen a second time.
- **New accounts get reviewed.** A first project usually waits in a review queue for a few business days before it shows in browse and search. The page works by its link the whole time. Traffic from outside itch moves it up the queue, so share the link off-site right away. Don't delete and recreate the page. Contact support only after at least a day.
- **Announce it.** Post `itch/devlog-launch.md` as a devlog with the type **Major Update or Launch**; itch may promote it, and recently updated games get a boost in browse. Announce it on the [Release Announcements board](https://itch.io/board/10022/release-announcements), not in other games' comments.

## Automatic uploads with butler

The *Android APK* workflow has an `itch` job that runs after the APK job on `v*` tags and manual runs. It builds the web version, plays every heist in a 450 × 800 itch-style frame, then uses butler to push `dist/web` to the **html5** channel and the APK to the **android** channel, both labelled with the `package.json` version. The README section *itch.io* has the details. In short:

1. Create the page first (butler can't), with *Kind of project* = HTML, and keep it a draft. Upload nothing by hand. If you already did, delete that upload.
2. Get an API key: run `butler login` once on your computer and copy the key from `~/.config/itch/butler_creds`, or copy the `wharf` key from <https://itch.io/user/settings/api-keys>. Paste it without a trailing newline. If the key ever appears in a log, revoke it there.
3. In the GitHub repository, *Settings → Secrets and variables → Actions*: add the **secret** `BUTLER_API_KEY` and the **variable** `ITCH_GAME` set to `<itch-username>/time-moves-when-you-draw`.
4. Bump `version` in `package.json` and push a matching tag: `git tag v1.0.0 && git push origin v1.0.0`.
5. After the first push only: on the edit page, tick **This file will be played in the browser** on the `html5` upload and save. The `android` upload is tagged Android automatically from the channel name. Then set up the embed options as above.

Until the secret and the variable exist, the job still builds and checks the web version and skips the upload with a notice. After the second release, check that the `html5` upload is still the one that plays.

## Pre-launch checklist

- [ ] Title, URL `time-moves-when-you-draw`, tagline (120 characters or fewer)
- [ ] Classification Games, kind HTML, Released, pricing chosen
- [ ] Web zip uploaded and marked *played in the browser*, by hand or through the `html5` channel, and only one of them
- [ ] APK uploaded with only *Android* ticked, install instructions pasted
- [ ] Embed: 450 × 800, Mobile friendly + Portrait, fullscreen button on, click to launch, scrollbars off, SharedArrayBuffer off
- [ ] Description pasted in HTML mode; the six section titles render as headers; the GitHub and Google Fonts links work
- [ ] Genre Puzzle, 10 tags, no AI or title tags
- [ ] Generative AI disclosure: Yes, with Code, Graphics, Text & Dialog and Sound
- [ ] Metadata: English, Touchscreen + Mouse, A few minutes, source link
- [ ] Cover uploaded; GIF and screenshots uploaded in order
- [ ] Theme: Screenshots = Sidebar, banner, colours, fonts, Run game background
- [ ] Community: Comments
- [ ] Tested through the secret link on desktop and on an Android phone, the APK installed from the page
- [ ] Devlog text ready, link ready to share off-site
- [ ] Visibility switched to Public, once

## Sources

Checked on 2026-10-04. Re-check anything that looks different in the dashboard.

- Getting started (cover size, screenshots, tagline): <https://itch.io/docs/creators/getting-started>
- Quality guidelines (cover, tags, AI disclosure, publish when ready): <https://itch.io/docs/creators/quality-guidelines>
- Getting indexed (requirements, review queue): <https://itch.io/docs/creators/getting-indexed>
- HTML5 games (zip rules, embed options, mobile): <https://itch.io/docs/creators/html5>
- Page design (theme, banner, screenshot layout): <https://itch.io/docs/creators/design>
- Pricing: <https://itch.io/docs/creators/pricing>
- Access control (draft, public): <https://itch.io/docs/creators/access-control>
- Generative AI disclosure field: <https://itch.io/t/4309690/generative-ai-disclosure-tagging>
- butler channels and pushing: <https://itch.io/docs/butler/pushing.html>
- Android developer verification: <https://developer.android.com/developer-verification>
