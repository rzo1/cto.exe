# CTO.exe — Prove You're Not a Junior

*A completely fair benchmark of your engineering abilities.*

A single-file browser game: TypeRacer meets a CTO interview, a hacker terminal and an escape room. Five levels, a local tournament leaderboard, share links and achievements.

It is also a friendly office prank. Players named **Daniel** get a keyboard that is subtly unreliable *inside the game's typing box only*. Players named **Richard** are mysteriously unbeatable. The joke is revealed after the game under **Behind the benchmark**.

> Spoiler warning: the rest of this README explains the prank. Don't send it to Daniel.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole game: HTML, CSS and JavaScript in one file. This is all you need to deploy. |
| `shared-leaderboard.json` | Optional, read-only "Shared" leaderboard tab, loaded from next to `index.html`. |
| `tests/game.spec.js` | Playwright end-to-end and unit tests. |
| `tests/static-server.js` | Zero-dependency static server that hosts the repo under `/cto-challenge/`, like GitHub Pages. |
| `playwright.config.js` | Test configuration (desktop Chrome + Pixel 7 mobile emulation). |
| `package.json` | Development-only scripts and the Playwright dev dependency. |

The game has **no runtime dependencies**: no frameworks, CDNs, fonts, images, analytics or backend.

## Play locally

```bash
# Any static server works. This one mimics GitHub Pages' project subpath:
npm run serve           # → http://127.0.0.1:4173/cto-challenge/
```

You can also double-click `index.html`. Under `file://` everything works except the optional shared leaderboard tab, because browsers block `fetch` there.

## Levels

1. **Keyboard Calibration**: TypeRacer-style passage. Tracks WPM, accuracy, keystrokes, time and a combo multiplier.
2. **CTO Logic Gate**: five timed multiple-choice riddles (event loop, `sort()`, logic, closures, binary search).
3. **The Impossible Bug**: three code snippets in an IDE-style viewer, with output revealed in a terminal.
4. **Production Incident**: alerts, logs, a stack trace and a deploy diff. Diagnose the root cause, then pick the fix.
5. **Final Boss**: a 30-second typing sprint through an increasingly ridiculous passage.

Typing fields block paste and drop. Quiz answers can be chosen with keys `1`–`4`, and `Enter` continues.

Easter eggs:
- The Konami code (↑ ↑ ↓ ↓ ← → ← → B A) starts Matrix mode.
- A certain nickname opens a secret arcade game (spoilers below).
- Clicking the version label five times shows the release notes.
- Finishing every level unlocks *Senior Stack Overflow Engineer*.

## The prank (how it works)

All nickname logic lives in **one object**, `PLAYER_RULES`, near the top of the `<script>` in `index.html`. The nickname is trimmed and lower-cased before matching, so `"  rIcHaRd "` counts as Richard but `"Richardson"` doesn't. Each profile is merged over `standard`.

**Daniel** (`PLAYER_RULES.profiles.daniel.inputInterference`):
- `rejectRateMin` / `rejectRateMax` (default 4–8%): chance that a printable keystroke in the typing box is silently ignored. A new rate is picked at the start of each typing level.
- `finalStretchStart` / `finalStretchExtraRate`: after 75% progress, the rate ramps up by as much as +6%.
- `bossIntensity` (default 1.5×): applies to all rates in the final boss.
- `feedbackDelayChance`, `feedbackDelayMinMs`, `feedbackDelayMaxMs`: occasional 100–250 ms lag in the passage highlighting.
- `glitchNoticeChance`, `glitchNoticeMaxPerLevel`: rare fake alerts such as `KEYBOARD_BUFFER_UNDERFLOW`. The messages are in `PLAYER_RULES.glitchNotices`.

Interference happens only in the game's own typing `<input>`, through its `beforeinput` event. The game never touches other fields, browser shortcuts or anything outside the page. Dropped keystrokes are not counted, so Daniel's displayed WPM and accuracy reflect the keystrokes the game actually accepted.

**Richard** (`PLAYER_RULES.profiles.richard`):
- `scoring.typingScoreMultiplier` (2.5×) and `scoring.riddleScoreMultiplier` (1.5×, applies to all quiz levels).
- `scoring.hiddenLevelBonus`: +750 per level, folded into the ordinary-looking "Level clears" line.
- `timing.timerAssistFactor` (0.15): every countdown silently runs 15% longer than it shows.
- Keystrokes are never rejected. WPM and accuracy are real. Only the competitive score is inflated.

**Adding another victim or VIP:** add a key, in lower case, under `PLAYER_RULES.profiles`. Include only the fields you want to override.

### The secret arcade: GRADIENT DESCENT

Enter the nickname **`Richard ist der Beste`** and press *Start benchmark*. Case and surrounding spaces don't matter. The benchmark doesn't start. Instead, a full-screen secret arcade opens: **GRADIENT DESCENT, a Matrix-grade shoot-'em-up**. It's an original horizontal shooter, inspired by the classic power-up-bar shmups and set in front of Matrix digital rain. Nothing from it reaches the leaderboard, and leaving it puts you back on the intro screen.

- **Controls:** arrows or WASD to fly, Space or J to fire (hold it down), Shift or K to merge an upgrade, P to pause, M for sound (off by default, WebAudio blips only), Esc or *Exit* to leave. On phones, drag anywhere to fly with auto-fire, and tap **⚡ Merge**. The game pauses itself when the tab is hidden.
- **Power-ups:** defeated enemies drop **PR capsules**. Each capsule moves the highlight one slot along the merge bar, and merging buys the highlighted upgrade:
  **Overclock** (speed, 4 levels) · **Async** (missiles that hug the floor) · **Fork** (double shot) · **Regex** (piercing laser; Fork and Regex are mutually exclusive) · **Pair Prog** (up to 2 trailing helper drones that copy your shots) · **Try/Catch** (shield that absorbs 3 hits). Losing a life sends your pair programmers to lunch and drops the shield.
- **Enemies:** bug swarms in sine waves, *NullPointerException* drone formations (clearing a whole formation drops a capsule), sunglasses agents in suits posted on the ceiling and floor as turrets, and merge-conflict blocks.
- **Boss:** **THE LEGACY MONOLITH** (code owner: Agent Daniel). Shoot away four "layers of abstraction" to expose its core. Beating it gives a life bonus and a friendly "LGTM. Ship it."
- **Konami nod:** ↑ ↑ ↓ ↓ ← → ← → B A *inside* the arcade grants a full loadout once per game. On the intro page, the same code still starts Matrix mode.
- **Achievements:** *Architect of the Matrix* for finding it and *Monolith Decomposer* for winning. They are toasts for this page session only, because there is no benchmark run to attach them to.
- **High score:** stored in `localStorage` under `ctoexe.arcade.highscore.v1`.
- **Reduced motion:** the game stays playable, but the rain is nearly static and there is no screen shake or flash.

**Changing the trigger:** edit `PLAYER_RULES.secretArcadeNicknames` (lower-case phrases). Triggers are checked before nickname validation, so they may be longer than the 20-character nickname limit. The input accepts up to 32 raw characters, and the default phrase is 21. Gameplay tuning (waves, enemy HP, boss, power-ups, scores) is in `ARCADE_CONFIG`, and the game is the `SecretArcade` object in `index.html`.

## Customizing content

Everything is in `GAME_CONFIG` near the top of the script:

- **Passages and time limits:** `levels[].passage` and `levels[].timeLimitSec`. Keep passages to plain ASCII so every keyboard can type them.
- **Riddles and bugs:** `riddles[]` and `bugs[]`. Each has `prompt`, optional `code` (an array of lines), `options`, `correctIndex`, `timeLimitSec`, `explanation` and an optional terminal `output`.
- **Incident:** `incident.alerts`, `incident.logs`, `incident.deploy.diff` and `incident.questions`.
- **Humor:** `wrongAnswerQuips`, `timeoutQuips`, `challengeMessages` and `rankTitles`.
- **Countdown:** `countdownSteps` and `countdownStepMs`.
- **Demo competitors:** `DEMO_COMPETITORS`. These are never stored; they are merged into the local standings.
- **Score weights:** `SCORE_WEIGHTS`, with comments on each weight. The scoring functions in `Scoring` are pure and deterministic.

Score summary:
- **Typing:** `WPM × 30 × accuracy²` (WPM clamped to 0–250), plus 2 × combo points. The boss level counts 1.5×.
- **Correct answers:** base points (riddle 400, debug 600, incident 800) plus a bonus for each second left.
- **Level clears:** +250 per level.
- **Speed bonus:** 1500, minus 5 per second of active play beyond 120 s.

## Leaderboard: what it is and isn't

- The **Local leaderboard** is stored in this browser's `localStorage`. It persists across reloads, but it is **not** shared between devices or people.
- Each run has a unique ID, so double clicks and repeated submits cannot create duplicate entries.
- *Clear local leaderboard* asks for confirmation. Demo competitors always remain.
- The **Shared (read-only)** tab appears when `shared-leaderboard.json` is present. To update it, edit the file and commit it. The game never writes to it.
- **GitHub Pages is static hosting.** A truly global, writable leaderboard needs a separate service or API. The code is ready for one: replace `LeaderboardService.backend` with an object that has the same async `list()`, `submit(entry)` and `clear()` methods and calls your API. No gameplay code needs to change.
- Scores are computed client-side and are **not** verified or tamper-proof.

## Sharing

**Challenge a Developer** uses the Web Share API when the browser supports it, and otherwise copies the text and link to the clipboard. The link is always shown in a text field as well. Example:

```
https://username.github.io/cto-challenge/?c=abc123&from=Alice&claim=12450&m=1
```

- The base URL comes from the current page's directory, so project subpaths work.
- Incoming parameters are strictly validated: nickname characters and length, the score as at most six digits, and the message as an index into a fixed list. Invalid links are ignored.
- Text is inserted with `textContent` only.
- A claimed score is shown as an *unverified claim* and never added to a leaderboard.

**Copy Results** copies a formatted summary.

## Tests

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # desktop + mobile projects
npm run test:desktop              # or one project
```

The suite starts `tests/static-server.js` and serves the game under `/cto-challenge/`, just like GitHub Pages. Randomness is seeded through `window.__CTO_TEST_HOOKS__ = { seed }`, which is injected before load; the game exposes its test API only when that object exists. Timers are tested with Playwright's fake clock. None of the tests depend on random outcomes.

Coverage, in the order of the requirements:
- Loading without errors, the nickname form, a full playthrough of all five levels, and correct and incorrect answers.
- Exact WPM and accuracy, using a fake clock.
- Daniel's seeded anomalies and that they are reproducible. Ordinary names (including Daniela, Dan iel and Richard) never lose a keystroke.
- Richard's multipliers, with identical displayed stats.
- Mixed-case nicknames.
- Countdowns, question timeouts and Richard's hidden timer assist.
- Double-submit protection, persistence, clearing, and ranking and tie-break order.
- Share URLs (clipboard and Web Share), URL and localStorage injection attempts, and subpath hosting.
- Mobile overflow, keyboard navigation and reduced motion, reveals and easter eggs.
- The secret arcade: the trigger and near-misses, movement, shooting, pause, power-up merges, the in-game Konami loadout next to the Matrix egg, clean exit (no loops or listeners left), game over, high score, boss and win, 360px layout and touch controls. These tests use a fake clock and seeded randomness.
- No remote requests or `eval`.

## Deploy to GitHub Pages

This repository lives at `git@github.com:rzo1/cto.exe.git`, so the game is served at **https://rzo1.github.io/cto.exe/** once Pages is enabled. For a fork, replace the user and repository names.

1. Push the files to `main`. This is already done for `rzo1/cto.exe`.
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, **Branch** to `main`, and the folder to `/ (root)`. Click **Save**.
4. After a minute the game is live at `https://rzo1.github.io/cto.exe/` (or `https://<username>.github.io/<repo>/` for a fork).

`node_modules/`, `tests/` and the config files are harmless on Pages; `.gitignore` already excludes `node_modules/`. Only `index.html` and, optionally, `shared-leaderboard.json` are used at runtime. No build step is needed.

## Accessibility and motion

- Visible focus states and full keyboard play.
- Live regions for timers, feedback and toasts.
- Leaderboard tabs use ARIA roles.
- The game respects `prefers-reduced-motion`. A **Reduce motion** toggle in the header overrides it and is remembered.

## Ethics, briefly

This is a prank for a colleague with a sense of humor. It only affects this page, and it explains itself at the end. Please don't use it to judge anyone's actual skills.
