# Out now: a heist where the clock only runs while you draw

*Post this on the game's devlog with the type **Major Update or Launch**. Paste everything below the line into the post body.*

---

Time Moves When You Draw is out. It's a one-finger heist: you drag to draw the thief's route, and the game clock only runs while the thief walks it.

The whole game hangs on one rule: game time is distance. Every 84 pixels the thief walks is one game-second, and nothing else moves the clock. Lift your finger and the guards, cameras and lasers stop exactly where they are. Want a guard to walk past? Scribble in place.

That rule made the rest simple. Everything that can catch you depends on game time alone: patrols are looping timelines, cameras sweep on a sine, lasers blink on a fixed cycle. The replay after an escape is exact, because the game just asks where everything was at each recorded moment.

And a program can check the heists: every one is proven solvable. A small solver searches position, loot and time across the map, with no grace period and extra distance from guards and lasers. It is stricter than the game, so if it finds a route, a player can take it. It also suggests the par times.

Then a bot plays them. It drags along the solver's route in a headless browser, with mouse or touch, scribbling to wait like a player would. It checks that the thief escapes with the gem and that the game clock matches the solver's. Network requests are blocked, so a pass also proves the game runs offline. The bot plays the copy inside the Android app, and the web build inside a 450 × 800 frame like this page's.

8 heists, 24 stars, and an Android app of about 170 KB. The code and text were made with an AI assistant; the game page's credits have the details.

Which heist took you longest? Tell me in the comments.
