# Out now: a heist where the clock only runs while you draw

*Post this on the game's devlog with the type **Major Update or Launch**. Paste everything below the line into the post body.*

---

Time Moves When You Draw is out. It's a one-finger heist: you drag to draw the thief's route, and the game clock only runs while the thief walks it.

The whole game hangs on one rule: game time is distance. Every 84 pixels the thief walks on the map (three and a half floor tiles) is one game-second, and nothing else moves the clock. Lift your finger and the guards, cameras and lasers stop exactly where they are. Want a guard to walk past? Scribble in place.

That rule made the rest simple. Everything that can catch you depends on game time alone: patrols are looping timelines, cameras sweep on a sine, lasers blink on a fixed cycle. The replay after an escape is exact, because the game just asks where everything was at each recorded moment.

It also lets a program check the heists. A small solver searches position, loot and time, and finds a route through every heist under stricter rules than the game: no grace period when seen, extra distance from guards and lasers. It also suggests the par times.

Then a bot plays them in a headless browser, dragging along the solver's route and scribbling to wait like a player would. It checks that the thief escapes with all the gold and the gem, and reports the game clock next to the solver's; they end within a fifth of a second of each other. Network requests are blocked, so a pass also shows the game needs no connection. Every release is played twice: the copy packed into the Android app, and the web build in a 450 × 800 frame like the game page's.

8 heists, 24 stars, and an Android app of about 170 KB. The code and text were written with Claude, an AI assistant; the credits on the game page have the details.

Which heist took you longest? Tell me in the comments.
