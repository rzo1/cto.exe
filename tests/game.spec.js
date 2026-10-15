// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const CLOCK_START = new Date('2026-01-01T09:00:00Z');

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Installs the seeded test hooks and collects page errors. Call before page.goto. */
async function prepare(page, { seed = 1234 } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.addInitScript((s) => { window.__CTO_TEST_HOOKS__ = { seed: s }; }, seed);
  return errors;
}

const api = (page, fn, arg) => page.evaluate(([source, a]) => {
  // eslint-disable-next-line no-new-func -- test-only helper; the game itself never uses eval/Function
  const f = new Function('api', 'arg', `return (${source})(api, arg);`);
  return f(window.__CTO_TEST_HOOKS__.api, a);
}, [fn.toString(), arg]);

async function openGame(page, query = '') {
  await page.goto(`./${query}`);
  await expect(page.locator('#screen-intro')).toBeVisible();
}

async function startGame(page, nickname, { waitForInput = true } = {}) {
  await page.fill('#nickname', nickname);
  await page.click('#start-btn');
  await expect(page.locator('#screen-level')).toBeVisible();
  if (waitForInput) await expect(page.locator('#typing-input')).toBeEnabled({ timeout: 20_000 });
}

/** Types the current passage until it matches, correcting any mismatches. Works for every nickname. */
async function typePassage(page) {
  const input = page.locator('#typing-input');
  const passage = await api(page, (a) => a.currentPassage());
  for (let round = 0; round < 400; round++) {
    if (await input.isDisabled()) return;
    const value = await input.inputValue();
    if (value === passage) return;
    let ok = 0;
    while (ok < value.length && value[ok] === passage[ok]) ok++;
    if (ok < value.length) {
      await input.evaluate((node, from) => node.setSelectionRange(from, node.value.length), ok);
      await page.keyboard.press('Backspace');
      continue;
    }
    // Small chunks keep corrections cheap when Daniel's keyboard drops a key.
    await page.keyboard.type(passage.slice(ok, ok + 20));
  }
}

async function answerCurrent(page, correct) {
  const question = await api(page, (a) => a.currentQuestion());
  const index = correct ? question.correctIndex : (question.correctIndex + 1) % question.options.length;
  await page.click(`.answer-option[data-index="${index}"]`);
  return { question, index };
}

async function playQuizLevel(page, correctness = () => true) {
  for (let i = 0; i < 10; i++) {
    await expect(page.locator('.answer-option').first()).toBeVisible();
    expect(await page.locator('#question-host').evaluate((node) => Array.from(node.childNodes).some((c) => c.nodeType === Node.TEXT_NODE))).toBe(false);
    await answerCurrent(page, correctness(i));
    const next = page.locator('#quiz-next');
    const finishing = (await next.textContent()).includes('Finish');
    await next.click();
    if (finishing) break;
  }
  await expect(page.locator('#screen-interlude')).toBeVisible();
}

async function continueInterlude(page) {
  await page.click('#interlude-continue');
}

async function playFullGame(page, nickname, { correctness = () => true } = {}) {
  await startGame(page, nickname);
  await typePassage(page);
  await expect(page.locator('#screen-interlude')).toBeVisible();
  await continueInterlude(page);
  for (let level = 2; level <= 4; level++) {
    await playQuizLevel(page, correctness);
    await continueInterlude(page);
  }
  await expect(page.locator('#typing-input')).toBeEnabled({ timeout: 20_000 });
  await typePassage(page);
  await expect(page.locator('#screen-interlude')).toBeVisible();
  await expect(page.locator('#interlude-continue')).toHaveText(/Compile results/);
  await continueInterlude(page);
  await expect(page.locator('#screen-results')).toBeVisible();
}

async function finalScore(page) {
  const state = await api(page, (a) => a.getState());
  return state.final.score;
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `horizontal overflow on ${label}`).toBeLessThanOrEqual(innerWidth + 1);
}

/** Starts a level-1 run under a paused fake clock with the countdown already finished. */
async function startWithFakeClock(page, nickname) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: CLOCK_START });
  await openGame(page);
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 5000));
  await startGame(page, nickname, { waitForInput: false });
  await page.clock.runFor(3000);
  await expect(page.locator('#typing-input')).toBeEnabled();
}

/* ------------------------------------------------------------------ */
/* 1. Loading                                                          */
/* ------------------------------------------------------------------ */

test('1. game loads without JavaScript errors', async ({ page }) => {
  const errors = await prepare(page);
  await openGame(page);
  await expect(page).toHaveTitle(/CTO\.exe/);
  await expect(page.locator('#intro-title')).toContainText('CTO');
  await expect(page.locator('.hero-sub')).toHaveText("Prove You're Not a Junior");
  await expect(page.locator('.tagline')).toHaveText('A completely fair benchmark of your engineering abilities.');
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* 2. Nickname form                                                    */
/* ------------------------------------------------------------------ */

test('2. nickname form validates and starts the game', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await page.click('#start-btn');
  await expect(page.locator('#nickname-error')).toContainText('Invalid nickname');
  await expect(page.locator('#screen-intro')).toBeVisible();

  await page.fill('#nickname', '<script>alert(1)</script>');
  await page.click('#start-btn');
  await expect(page.locator('#nickname-error')).toContainText('Invalid nickname');
  await expect(page.locator('#nickname')).toHaveAttribute('aria-invalid', 'true');

  await page.fill('#nickname', '  Ada   Lovelace ');
  await page.click('#start-btn');
  await expect(page.locator('#screen-level')).toBeVisible();
  await expect(page.locator('#hud-title')).toHaveText('Keyboard Calibration');
  await expect(page.locator('#hud-level')).toHaveText('Level 1 / 5');
  const state = await api(page, (a) => a.getState());
  expect(state.nickname).toBe('Ada Lovelace');
  expect(state.rules.profileKey).toBe('standard');
});

/* ------------------------------------------------------------------ */
/* 3. Full playthrough                                                 */
/* ------------------------------------------------------------------ */

test('3. all five levels are playable end to end', async ({ page }) => {
  const errors = await prepare(page);
  await openGame(page);
  await startGame(page, 'Alice');
  await expect(page.locator('#passage')).toBeVisible();
  await typePassage(page);
  await expect(page.locator('#interlude-title')).toHaveText('Level cleared');
  await continueInterlude(page);

  await expect(page.locator('#hud-title')).toHaveText('CTO Logic Gate');
  await expect(page.locator('#question-counter')).toHaveText('Question 1 of 5');
  await playQuizLevel(page);
  await continueInterlude(page);

  await expect(page.locator('#hud-title')).toHaveText('The Impossible Bug');
  await expect(page.locator('.code-window')).toBeVisible();
  await expect(page.locator('.code li').first()).toBeVisible();
  await playQuizLevel(page);
  await continueInterlude(page);

  await expect(page.locator('#hud-title')).toHaveText('Production Incident');
  await expect(page.locator('.alert.p0')).toContainText('The CEO has opened DevTools.');
  await expect(page.locator('.alerts')).toContainText('Rollback unavailable. Someone force-pushed main.');
  await expect(page.locator('.log-terminal')).toContainText('ECONNREFUSED');
  await playQuizLevel(page);
  await continueInterlude(page);

  await expect(page.locator('#hud-title')).toContainText('Final Boss');
  await expect(page.locator('#typing-input')).toBeEnabled();
  await typePassage(page);
  await continueInterlude(page);

  await expect(page.locator('#screen-results')).toBeVisible();
  await expect(page.locator('#result-correct')).toHaveText('10/10');
  await expect(page.locator('#result-achievements')).toContainText('Senior Stack Overflow Engineer');
  const score = await finalScore(page);
  await expect(page.locator('#final-score')).toHaveText(score.toLocaleString('en-US'));
  const breakdownSum = await page.$$eval('#score-breakdown li span:last-child', (spans) => spans.reduce((sum, s) => sum + Number(s.textContent.replace(/,/g, '')), 0));
  expect(breakdownSum).toBe(score);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* 4 & 5. Correct and incorrect answers                                */
/* ------------------------------------------------------------------ */

async function reachLogicGate(page, nickname = 'Alice') {
  await openGame(page);
  await startGame(page, nickname);
  await typePassage(page);
  await continueInterlude(page);
  await expect(page.locator('#question-counter')).toHaveText('Question 1 of 5');
}

test('4. correct answers award points', async ({ page }) => {
  await prepare(page);
  await reachLogicGate(page);
  const before = Number((await page.textContent('#hud-score')).replace(/,/g, ''));
  await answerCurrent(page, true);
  await expect(page.locator('#feedback')).toHaveClass(/good/);
  await expect(page.locator('#feedback .verdict')).toContainText('Correct! +');
  const after = Number((await page.textContent('#hud-score')).replace(/,/g, ''));
  expect(after).toBeGreaterThanOrEqual(before + 400);
  const state = await api(page, (a) => a.getState());
  expect(state.questionResults).toHaveLength(1);
  expect(state.questionResults[0]).toMatchObject({ questionId: 'event-loop', correct: true, category: 'riddle' });
  expect(state.achievements).toContain('eventLoopWhisperer');
});

test('5. incorrect answers give feedback, no points, and lock the question', async ({ page }) => {
  await prepare(page);
  await reachLogicGate(page);
  const before = await page.textContent('#hud-score');
  const { question, index } = await answerCurrent(page, false);
  await expect(page.locator('#feedback')).toHaveClass(/bad/);
  const quips = await api(page, (a) => a.GAME_CONFIG.wrongAnswerQuips);
  const verdict = await page.textContent('#feedback .verdict');
  expect(quips).toContain(verdict);
  await expect(page.locator(`.answer-option[data-index="${index}"]`)).toHaveClass(/is-wrong/);
  await expect(page.locator(`.answer-option[data-index="${question.correctIndex}"]`)).toHaveClass(/is-correct/);
  await expect(page.locator('.answer-option').first()).toBeDisabled();
  await expect(page.locator('#hud-score')).toHaveText(before);
  // Pressing a number key after answering must not record a second answer.
  await page.locator('#quiz-next').blur();
  await page.keyboard.press(String(question.correctIndex + 1));
  const state = await api(page, (a) => a.getState());
  expect(state.questionResults).toHaveLength(1);
  expect(state.questionResults[0].correct).toBe(false);
});

/* ------------------------------------------------------------------ */
/* 6. WPM and accuracy                                                 */
/* ------------------------------------------------------------------ */

test('6. typing WPM and accuracy are calculated correctly', async ({ page }) => {
  await prepare(page);
  await startWithFakeClock(page, 'Alice');
  const passage = await api(page, (a) => a.currentPassage());
  const n = passage.length;

  await page.keyboard.type(passage.slice(0, 10));
  await page.keyboard.type('#');            // one wrong keystroke
  await page.keyboard.press('Backspace');   // correction is not a keystroke
  await page.keyboard.type(passage.slice(10, n - 1));
  await page.clock.runFor(60_000);          // exactly one minute between first and last keystroke
  await page.keyboard.type(passage.slice(n - 1));

  await expect(page.locator('#screen-interlude')).toBeVisible();
  const expectedWpm = Math.round((n / 5) / 1);
  const expectedAccuracy = n / (n + 1);
  const state = await api(page, (a) => a.getState());
  const level = state.levelResults[0];
  expect(level.keystrokes).toBe(n + 1);
  expect(level.correctKeystrokes).toBe(n);
  expect(level.elapsedMs).toBe(60_000);
  expect(level.wpm).toBe(expectedWpm);
  expect(level.accuracy).toBeCloseTo(expectedAccuracy, 10);
  await expect(page.locator('#interlude-stats')).toContainText(String(expectedWpm));
  await expect(page.locator('#interlude-stats')).toContainText(`${(expectedAccuracy * 100).toFixed(1)}%`);

  // Pure scoring helpers
  const unit = await api(page, (a) => ({
    wpm: a.Scoring.computeWpm(250, 60000),
    wpmHalf: a.Scoring.computeWpm(100, 30000),
    wpmZero: a.Scoring.computeWpm(100, 0),
    acc: a.Scoring.computeAccuracy(9, 10),
    accNone: a.Scoring.computeAccuracy(0, 0),
    accClamp: a.Scoring.computeAccuracy(12, 10),
    points: a.Scoring.typingLevelPoints({ wpm: 60, accuracy: 1, comboPoints: 10, isBoss: false }),
    bossPoints: a.Scoring.typingLevelPoints({ wpm: 60, accuracy: 1, comboPoints: 10, isBoss: true }),
    clampedWpm: a.Scoring.typingLevelPoints({ wpm: 9999, accuracy: 1.7, comboPoints: 0, isBoss: false }),
    combo: [0, 14, 15, 30, 1000].map((c) => a.Scoring.comboMultiplier(c)),
    completion: [0, 120, 220, 99999, -5].map((s) => a.Scoring.completionBonus(s)),
  }));
  expect(unit.wpm).toBe(50);
  expect(unit.wpmHalf).toBe(40);
  expect(unit.wpmZero).toBe(0);
  expect(unit.acc).toBeCloseTo(0.9);
  expect(unit.accNone).toBe(0);
  expect(unit.accClamp).toBe(1);
  expect(unit.points).toBe(60 * 30 + 20);
  expect(unit.bossPoints).toBe(Math.round((60 * 30 + 20) * 1.5));
  expect(unit.clampedWpm).toBe(250 * 30);
  expect(unit.combo).toEqual([1, 1, 1.5, 2, 4]);
  expect(unit.completion).toEqual([1500, 1500, 1000, 0, 1500]);
});

/* ------------------------------------------------------------------ */
/* 7 & 8. Interference only for Daniel                                 */
/* ------------------------------------------------------------------ */

async function typeOnceAsIs(page, nickname) {
  await openGame(page);
  await startGame(page, nickname);
  const passage = await api(page, (a) => a.currentPassage());
  await page.keyboard.type(passage);
  const value = await page.locator('#typing-input').inputValue();
  const state = await api(page, (a) => a.getState());
  return { passage, value, state };
}

test('7. Daniel gets game-only typing anomalies under seeded randomness', async ({ page, context }) => {
  await prepare(page, { seed: 1234 });
  const first = await typeOnceAsIs(page, 'Daniel');
  expect(first.state.rules.profileKey).toBe('daniel');
  expect(first.state.prankStats.rejectedKeystrokes).toBeGreaterThan(0);
  expect(first.value).not.toBe(first.passage);
  expect(first.value.length).toBe(first.passage.length - first.state.prankStats.rejectedKeystrokes);
  expect(first.state.prankStats.delayedFrames).toBeGreaterThan(0);

  // Same seed => identical anomalies (deterministic).
  const second = await context.newPage();
  await prepare(second, { seed: 1234 });
  const replay = await typeOnceAsIs(second, 'Daniel');
  expect(replay.value).toBe(first.value);
  expect(replay.state.prankStats).toEqual(first.state.prankStats);
  await second.close();

  // The rate model: 4–8% base, ramping up in the final 25%, 1.5× in the boss level.
  const model = await api(page, (a) => {
    const rules = a.resolvePlayerRules('Daniel');
    const out = [];
    for (let seed = 1; seed <= 50; seed++) {
      const normal = new a.InputInterference(rules, a.createSeededRandom(seed), false);
      const boss = new a.InputInterference(rules, a.createSeededRandom(seed), true);
      out.push({ start: normal.rejectProbability(0), mid: normal.rejectProbability(0.75), end: normal.rejectProbability(1), bossStart: boss.rejectProbability(0) });
    }
    return out;
  });
  for (const m of model) {
    expect(m.start).toBeGreaterThanOrEqual(0.04);
    expect(m.start).toBeLessThanOrEqual(0.08);
    expect(m.mid).toBeCloseTo(m.start, 10);
    expect(m.end).toBeCloseTo(m.start + 0.06, 10);
    expect(m.bossStart).toBeCloseTo(m.start * 1.5, 10);
  }
});

test('8. ordinary nicknames never have keystrokes rejected', async ({ page }) => {
  for (const [seed, nickname] of [[1, 'Alice'], [1234, 'Daniela'], [99, 'Dan iel'], [7, 'Richard']]) {
    const p = await page.context().newPage();
    await prepare(p, { seed });
    const result = await typeOnceAsIs(p, nickname);
    expect(result.value, nickname).toBe(result.passage);
    expect(result.state.prankStats.rejectedKeystrokes).toBe(0);
    expect(result.state.prankStats.delayedFrames).toBe(0);
    await expect(p.locator('#screen-interlude')).toBeVisible();
    await p.close();
  }
  await prepare(page);
  await openGame(page);
  const neverRejects = await api(page, (a) => {
    for (const name of ['Alice', 'Richard', 'Daniela', 'xdaniel', '']) {
      const interference = new a.InputInterference(a.resolvePlayerRules(name), a.createSeededRandom(42), true);
      for (let i = 0; i < 20000; i++) if (interference.shouldRejectKeystroke(i / 20000)) return name;
    }
    return null;
  });
  expect(neverRejects).toBeNull();
});

/* ------------------------------------------------------------------ */
/* 9. Richard                                                          */
/* ------------------------------------------------------------------ */

async function playLevelOneDeterministically(page, nickname) {
  await startWithFakeClock(page, nickname);
  const passage = await api(page, (a) => a.currentPassage());
  await page.keyboard.type(passage.slice(0, -1));
  await page.clock.runFor(30_000);
  await page.keyboard.type(passage.slice(-1));
  await expect(page.locator('#screen-interlude')).toBeVisible();
  const state = await api(page, (a) => a.getState());
  const points = Number((await page.textContent('#interlude-points')).replace(/[+,]/g, ''));
  return { level: state.levelResults[0], points, state };
}

test('9. Richard receives the hidden score advantage with ordinary-looking stats', async ({ page, context }) => {
  await prepare(page);
  const alice = await playLevelOneDeterministically(page, 'Alice');
  const other = await context.newPage();
  await prepare(other);
  const richard = await playLevelOneDeterministically(other, 'Richard');

  // Identical, real typing statistics…
  expect(richard.level.wpm).toBe(alice.level.wpm);
  expect(richard.level.accuracy).toBe(alice.level.accuracy);
  expect(richard.level.keystrokes).toBe(alice.level.keystrokes);
  await expect(other.locator('#interlude-stats')).toContainText(String(alice.level.wpm));

  // …but a very different competitive score.
  const base = await api(page, (a, lvl) => a.Scoring.typingLevelPoints(lvl), alice.level);
  expect(alice.points).toBe(base + 250);
  expect(richard.points).toBe(Math.round(base * 2.5) + 250 + 750);
  expect(richard.state.rules.profileKey).toBe('richard');
  expect(richard.state.prankStats.rejectedKeystrokes).toBe(0);

  // Nothing in the UI admits it.
  const visibleText = await other.evaluate(() => document.body.innerText);
  expect(visibleText).not.toMatch(/cheat mode|admin mode|god mode|richard mode/i);

  // Competent play wins for Richard, but not for an ordinary player with identical play.
  const outcome = await api(page, (a) => {
    const competent = {
      typingLevels: [
        { wpm: 60, accuracy: 0.95, comboPoints: 150, isBoss: false },
        { wpm: 60, accuracy: 0.95, comboPoints: 250, isBoss: true },
      ],
      questions: [
        ...[true, true, true, false, false].map((correct) => ({ category: 'riddle', correct, secondsLeft: 10, timeLimitSec: 25 })),
        ...[true, true, false].map((correct) => ({ category: 'debug', correct, secondsLeft: 10, timeLimitSec: 35 })),
        ...[true, false].map((correct) => ({ category: 'incident', correct, secondsLeft: 20, timeLimitSec: 45 })),
      ],
      completedLevels: 5, totalLevels: 5, activeSeconds: 240,
    };
    return {
      richard: a.Scoring.computeScore(competent, a.resolvePlayerRules('Richard').scoring).total,
      alice: a.Scoring.computeScore(competent, a.resolvePlayerRules('Alice').scoring).total,
      deterministic: a.Scoring.computeScore(competent, a.resolvePlayerRules('Richard').scoring).total === a.Scoring.computeScore(competent, a.resolvePlayerRules(' RICHARD ').scoring).total,
    };
  });
  const standings = await api(page, (a) => a.standings());
  expect(outcome.richard).toBeGreaterThan(standings[0].score);
  expect(outcome.alice).toBeLessThan(standings[0].score);
  expect(outcome.deterministic).toBe(true);
  await other.close();
});

/* ------------------------------------------------------------------ */
/* 10. Mixed case                                                      */
/* ------------------------------------------------------------------ */

test('10. mixed-case nicknames resolve to the right rules', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  const keys = await api(page, (a) => ['Richard', '  rIcHaRd  ', 'RICHARD', 'Daniel', 'dAnIeL', ' DANIEL ', 'Richardson', 'Dan iel', 'Danny', 'alice']
    .map((n) => a.resolvePlayerRules(n).profileKey));
  expect(keys).toEqual(['richard', 'richard', 'richard', 'daniel', 'daniel', 'daniel', 'standard', 'standard', 'standard', 'standard']);

  await startGame(page, '  DaNiEl ');
  const state = await api(page, (a) => a.getState());
  expect(state.nickname).toBe('DaNiEl');
  expect(state.rules.profileKey).toBe('daniel');
});

/* ------------------------------------------------------------------ */
/* 11. Timers                                                          */
/* ------------------------------------------------------------------ */

test('11. timers and countdowns behave correctly (fake clock)', async ({ page, context }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: CLOCK_START });
  await openGame(page);
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 5000));
  await startGame(page, 'Alice', { waitForInput: false });

  // 3-2-1-GO countdown keeps the input disabled.
  await expect(page.locator('#typing-input')).toBeDisabled();
  await page.clock.runFor(1500);
  await expect(page.locator('#typing-input')).toBeDisabled();
  await page.clock.runFor(1400);
  await expect(page.locator('#typing-input')).toBeEnabled();
  await expect(page.locator('#hud-timer')).toHaveText('2:00');

  await page.clock.runFor(10_000);
  await expect(page.locator('#hud-timer')).toHaveText('1:50');
  await page.clock.runFor(105_000);
  await expect(page.locator('#hud-timer')).toHaveText('0:05');
  await expect(page.locator('#hud-timer')).toHaveClass(/low/);
  await page.clock.runFor(5_200);
  await expect(page.locator('#screen-interlude')).toBeVisible();
  await expect(page.locator('#interlude-title')).toHaveText('Time! Level closed');

  // Question timer: expiring counts as a wrong answer with zero points.
  await continueInterlude(page);
  await expect(page.locator('#hud-timer')).toHaveText('0:25');
  await page.clock.runFor(25_200);
  await expect(page.locator('#feedback')).toHaveClass(/bad/);
  await expect(page.locator('#feedback .verdict')).toContainText("Time's up");
  const state = await api(page, (a) => a.getState());
  expect(state.questionResults[0]).toMatchObject({ correct: false, timedOut: true, secondsLeft: 0 });

  // Richard's countdown silently runs longer while displaying the same numbers.
  const other = await context.newPage();
  await prepare(other);
  await startWithFakeClock(other, 'Richard');
  await expect(other.locator('#hud-timer')).toHaveText('2:00');
  await other.clock.runFor(121_000);
  await expect(other.locator('#screen-level')).toBeVisible();
  await other.clock.runFor(18_000);
  await expect(other.locator('#screen-interlude')).toBeVisible();
  await other.close();
});

/* ------------------------------------------------------------------ */
/* 12–15. Leaderboard                                                  */
/* ------------------------------------------------------------------ */

test('12. a score cannot be submitted twice', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await playFullGame(page, 'Alice');
  await page.locator('#submit-score').dblclick({ force: true });
  await page.locator('#submit-score').click({ force: true });
  await api(page, (a) => Promise.all([a.submitScore(), a.submitScore()]));
  await expect(page.locator('#submit-status')).toContainText('Saved. You are #');
  await expect(page.locator('#submit-score')).toBeDisabled();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ctoexe.leaderboard.v1')));
  expect(stored).toHaveLength(1);
  await page.reload();
  const storedAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('ctoexe.leaderboard.v1')));
  expect(storedAfterReload).toHaveLength(1);
});

test('13. the local leaderboard persists after reload and highlights the player', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await playFullGame(page, 'Alice');
  const score = await finalScore(page);
  await page.click('#submit-score');
  await expect(page.locator('#submit-status')).toContainText('Saved.');
  await page.reload();
  await page.click('#open-leaderboard');
  await expect(page.locator('#leaderboard-title')).toHaveText('Local leaderboard');
  await expect(page.locator('#board-note')).toContainText('not synchronized');
  const row = page.locator('#leaderboard-body tr.is-current');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Alice');
  await expect(row.locator('.score')).toHaveText(score.toLocaleString('en-US'));
  await expect(row.locator('.tag.you')).toBeVisible();
});

test('14. clearing the local leaderboard works (with confirmation)', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('ctoexe.leaderboard.v1', JSON.stringify([
        { id: 'run-a1', name: 'Alice', score: 5000, wpm: 50, accuracy: 0.9, createdAt: 1 },
        { id: 'run-b2', name: 'Bob', score: 7000, wpm: 60, accuracy: 0.95, createdAt: 2 },
      ]));
    }
  });
  await openGame(page);
  await page.click('#open-leaderboard');
  const demoCount = await api(page, async (a) => (await a.standings()).filter((e) => e.demo).length);
  await expect(page.locator('#leaderboard-body tr')).toHaveCount(demoCount + 2);
  await page.click('#clear-leaderboard');
  await expect(page.locator('#clear-leaderboard')).toHaveText('Click again to confirm');
  await expect(page.locator('#leaderboard-body tr')).toHaveCount(demoCount + 2);
  await page.click('#clear-leaderboard');
  await expect(page.locator('#leaderboard-status')).toContainText('cleared');
  await expect(page.locator('#leaderboard-body tr')).toHaveCount(demoCount);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('ctoexe.leaderboard.v1'))).toBeNull();
});

test('15. rankings are sorted and numbered consistently', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    localStorage.setItem('ctoexe.leaderboard.v1', JSON.stringify([
      { id: 'run-low', name: 'Low', score: 100, wpm: 10, accuracy: 0.5, createdAt: 1 },
      { id: 'run-tie-b', name: 'TieLaterSameAcc', score: 15410, wpm: 88, accuracy: 0.968, createdAt: 9 },
      { id: 'run-tie-a', name: 'TieBetterAcc', score: 15410, wpm: 70, accuracy: 0.99, createdAt: 5 },
      { id: 'run-top', name: 'Topper', score: 50000, wpm: 120, accuracy: 1, createdAt: 3 },
      { id: 'bad', name: 'Broken', score: 'NaN', wpm: 1, accuracy: 1 },
    ]));
  });
  await openGame(page);
  await page.click('#open-leaderboard');
  const rows = await page.$$eval('#leaderboard-body tr', (trs) => trs.map((tr) => ({
    rank: Number(tr.querySelector('.rank-pill').textContent),
    name: tr.querySelector('.player').firstChild.textContent,
    score: Number(tr.querySelector('.score').textContent.replace(/,/g, '')),
  })));
  expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
  for (let i = 1; i < rows.length; i++) expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
  expect(rows[0].name).toBe('Topper');
  expect(rows.map((r) => r.name)).not.toContain('Broken');
  const tieOrder = rows.filter((r) => r.score === 15410).map((r) => r.name);
  expect(tieOrder).toEqual(['TieBetterAcc', 'YAML_Sommelier', 'TieLaterSameAcc']);
  await expect(page.locator('#leaderboard-body tr').nth(0)).toHaveClass(/rank-1/);
  await expect(page.locator('#leaderboard-body tr').nth(1)).toHaveClass(/rank-2/);
  await expect(page.locator('#leaderboard-body tr').nth(2)).toHaveClass(/rank-3/);
  await expect(page.locator('#leaderboard-body tr').nth(3)).not.toHaveClass(/rank-/);
});

/* ------------------------------------------------------------------ */
/* 16. Sharing                                                         */
/* ------------------------------------------------------------------ */

test('16. sharing generates a valid challenge URL (clipboard fallback and Web Share)', async ({ page, baseURL }) => {
  await prepare(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
  });
  await openGame(page);
  await playFullGame(page, 'Alice');
  const score = await finalScore(page);

  await page.click('#challenge-btn');
  await expect(page.locator('#share-status')).toHaveText('Challenge link copied to clipboard.');
  const link = await page.locator('#share-output').inputValue();
  const url = new URL(link);
  expect(link.startsWith(baseURL)).toBe(true);
  expect(url.pathname).toBe('/cto-challenge/');
  expect(url.searchParams.get('from')).toBe('Alice');
  expect(url.searchParams.get('claim')).toBe(String(score));
  expect(url.searchParams.get('c')).toMatch(/^[A-Za-z0-9]{4,24}$/);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain(`I just survived CTO.exe with ${score.toLocaleString('en-US')} points.`);
  expect(clipboard).toContain(link);

  await page.click('#copy-results');
  await expect(page.locator('#share-status')).toHaveText('Results copied to clipboard.');
  const summary = await page.evaluate(() => navigator.clipboard.readText());
  expect(summary).toContain('CTO.exe — Benchmark Results');
  expect(summary).toContain('Player: Alice');
  expect(summary).toContain(`Score: ${score.toLocaleString('en-US')}`);

  // Opening the link shows an unverified challenge banner and does not touch the leaderboard.
  const visitor = await page.context().newPage();
  await prepare(visitor);
  await visitor.goto(link);
  await expect(visitor.locator('#challenge-banner')).toBeVisible();
  await expect(visitor.locator('#challenge-from')).toHaveText('Alice');
  await expect(visitor.locator('#challenge-claim')).toHaveText(`${score.toLocaleString('en-US')} points`);
  await expect(visitor.locator('#challenge-banner')).toContainText('unverified claim');
  expect(await visitor.evaluate(() => localStorage.getItem('ctoexe.leaderboard.v1'))).toBeNull();
  await visitor.close();

  // Web Share API path.
  await page.evaluate(() => {
    window.__shared = null;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.__shared = data; } });
  });
  await page.click('#challenge-btn');
  await expect(page.locator('#share-status')).toContainText('Challenge sent');
  const shared = await page.evaluate(() => window.__shared);
  expect(shared.url).toBe(link);
  expect(shared.text).toContain('Prove it.');
});

/* ------------------------------------------------------------------ */
/* 17. Injection                                                       */
/* ------------------------------------------------------------------ */

test('17. shared URL parameters cannot inject HTML or JavaScript', async ({ page }) => {
  const errors = await prepare(page);
  const payloads = [
    '?from=%3Cimg%20src%3Dx%20onerror%3D%22window.__pwned%3D1%22%3E&claim=1234',
    '?from=Eve&claim=%3Cscript%3Ewindow.__pwned%3D1%3C%2Fscript%3E',
    '?from=Eve&claim=99999999999',
    '?from=%22%3E%3Csvg%20onload%3Dwindow.__pwned%3D1%3E&claim=1',
    '?from=javascript%3Aalert(1)&claim=1',
  ];
  for (const query of payloads) {
    await page.goto(`./${query}`);
    await expect(page.locator('#challenge-banner')).toBeHidden();
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  }

  await page.goto('./?from=O%27Brien&claim=4200&m=9&c=%3Cb%3Ex%3C%2Fb%3E');
  await expect(page.locator('#challenge-banner')).toBeVisible();
  await expect(page.locator('#challenge-from')).toHaveText("O'Brien");
  await expect(page.locator('#challenge-claim')).toHaveText('4,200 points');
  expect(await page.locator('#challenge-banner img, #challenge-banner script, #challenge-banner b').count()).toBe(0);
  const message = await page.textContent('#challenge-message');
  const messages = await api(page, (a) => a.GAME_CONFIG.challengeMessages);
  expect(message).toBe(messages[0]);

  // Poisoned localStorage entries are dropped, never rendered as HTML.
  await page.evaluate(() => localStorage.setItem('ctoexe.leaderboard.v1', JSON.stringify([
    { id: 'run-evil', name: '<img src=x onerror="window.__pwned=1">', score: 99999, wpm: 1, accuracy: 1, createdAt: 1 },
    { id: 'run-ok', name: 'Mallory', score: 1, wpm: 1, accuracy: 1, createdAt: 1 },
  ])));
  await page.reload();
  await page.click('#open-leaderboard');
  await expect(page.locator('#leaderboard-body')).toContainText('Mallory');
  expect(await page.locator('#leaderboard-body img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* 18. GitHub Pages subpath                                            */
/* ------------------------------------------------------------------ */

test('18. works when hosted under a GitHub Pages project subpath', async ({ page, request, baseURL }) => {
  const errors = await prepare(page);
  const root = new URL('/', baseURL).toString();
  const rootResponse = await request.get(root);
  expect(rootResponse.status()).toBe(404); // nothing is served from the domain root

  const noSlash = await request.get(new URL('/cto-challenge', baseURL).toString(), { maxRedirects: 0 });
  expect(noSlash.status()).toBe(301);

  await page.goto(baseURL);
  await expect(page.locator('#screen-intro')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/cto-challenge/');
  // The optional read-only shared leaderboard is fetched relative to the page.
  await page.click('#open-leaderboard');
  await expect(page.locator('#tab-shared')).toBeVisible();
  await page.click('#tab-shared');
  await expect(page.locator('#leaderboard-title')).toHaveText('Shared leaderboard (read-only)');
  await expect(page.locator('#clear-leaderboard')).toBeHidden();
  await expect(page.locator('#leaderboard-body tr')).toHaveCount(3);

  // Also works when opened as /cto-challenge/index.html.
  await page.goto(new URL('index.html?from=Zed&claim=10', baseURL).toString());
  await expect(page.locator('#challenge-from')).toHaveText('Zed');
  const base = await api(page, (a) => a.ShareService.gameBaseUrl().toString());
  expect(base).toBe(baseURL);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* 19. Mobile layout                                                   */
/* ------------------------------------------------------------------ */

test('19. mobile viewport has no horizontal overflow', async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await openGame(page);
  await expectNoHorizontalOverflow(page, 'intro');
  await startGame(page, 'Alice');
  await expectNoHorizontalOverflow(page, 'level 1');
  await typePassage(page);
  await expectNoHorizontalOverflow(page, 'interlude');
  await continueInterlude(page);
  await expectNoHorizontalOverflow(page, 'level 2');
  await playQuizLevel(page);
  await continueInterlude(page);
  await expectNoHorizontalOverflow(page, 'level 3 code');
  await playQuizLevel(page);
  await continueInterlude(page);
  await expectNoHorizontalOverflow(page, 'level 4 incident');
  await playQuizLevel(page);
  await continueInterlude(page);
  await expect(page.locator('#typing-input')).toBeEnabled();
  await typePassage(page);
  await continueInterlude(page);
  await expect(page.locator('#screen-results')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'results');
  await page.click('#submit-score');
  await page.click('#view-leaderboard');
  await expectNoHorizontalOverflow(page, 'leaderboard');
  await page.click('#leaderboard-back');
  await page.click('#behind-benchmark');
  await expectNoHorizontalOverflow(page, 'reveal');
});

/* ------------------------------------------------------------------ */
/* 20. Keyboard navigation and reduced motion                          */
/* ------------------------------------------------------------------ */

test('20. keyboard navigation and reduced-motion support work', async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#particles')).toBeHidden();

  // Tab from the top of the page to the nickname field, then start with Enter.
  await page.locator('body').focus();
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'nickname');
  }
  expect(reached).toBe(true);
  await page.keyboard.type('KeyboardUser');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-input')).toBeEnabled();
  await expect(page.locator('#typing-input')).toBeFocused();
  await typePassage(page);
  await expect(page.locator('#interlude-continue')).toBeFocused();
  await page.keyboard.press('Enter');

  // Answer with number keys, continue with Enter on the focused button.
  const q = await api(page, (a) => a.currentQuestion());
  await expect(page.locator('.answer-option').first()).toBeFocused();
  await page.keyboard.press(String(q.correctIndex + 1));
  await expect(page.locator('#feedback')).toHaveClass(/good/);
  await expect(page.locator('#quiz-next')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#question-counter')).toHaveText('Question 2 of 5');

  // Visible focus indicator on keyboard focus.
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).toBe('solid');

  // Manual toggle persists.
  await page.goto('./');
  await page.click('#motion-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await page.reload();
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'false');
});

/* ------------------------------------------------------------------ */
/* 21. Reveal and easter eggs                                          */
/* ------------------------------------------------------------------ */

test('21a. Daniel gets the prank reveal with his real numbers', async ({ page }) => {
  await prepare(page, { seed: 4242 });
  await openGame(page);
  await expect(page.locator('#behind-benchmark')).toBeHidden();
  await playFullGame(page, 'Daniel');
  const state = await api(page, (a) => a.getState());
  expect(state.prankStats.rejectedKeystrokes).toBeGreaterThan(0);
  // The results page shows the real, accepted-keystroke statistics.
  await expect(page.locator('#result-keystrokes')).toHaveText(state.final.keystrokes.toLocaleString('en-US'));
  await expect(page.locator('#result-wpm')).toHaveText(String(state.final.wpm));
  await page.click('#behind-benchmark');
  await expect(page.locator('#reveal-quote')).toHaveText("Congratulations. You've completed a benchmark designed by Richard. The keyboard was never going to let Daniel win.");
  await expect(page.locator('#reveal-body')).toContainText(`swallowed ${state.prankStats.rejectedKeystrokes} of your keystrokes`);
  await expect(page.locator('#reveal-body')).toContainText('your keyboard is fine');
  await page.click('#reveal-back');
  await expect(page.locator('#screen-results')).toBeVisible();
});

test('21b. Richard gets the architect reveal; easter eggs work', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await playFullGame(page, 'Richard');
  await page.click('#behind-benchmark');
  await expect(page.locator('#reveal-quote')).toHaveText('Architect privileges confirmed. The benchmark is working as designed.');
  await page.click('#reveal-play-again');
  await expect(page.locator('#screen-intro')).toBeVisible();

  // Konami code -> Matrix overlay.
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
    await page.keyboard.press(key);
  }
  await expect(page.locator('#matrix-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#matrix-overlay')).toHaveCount(0);

  // Version label x5 -> release notes.
  for (let i = 0; i < 5; i++) await page.click('#version-label');
  await expect(page.locator('#modal-backdrop')).toBeVisible();
  await expect(page.locator('#modal-title')).toContainText('Release notes');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-backdrop')).toBeHidden();
});

test('21c. ordinary players get the general reveal', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await playFullGame(page, 'Grace');
  await page.click('#behind-benchmark');
  await expect(page.locator('#reveal-quote')).toContainText('The keyboard was never going to let Daniel win.');
  await expect(page.locator('#reveal-body')).toContainText('You played the honest version.');
});

/* ------------------------------------------------------------------ */
/* 22. No remote dependencies                                          */
/* ------------------------------------------------------------------ */

test('22. no remote dependencies are needed for gameplay', async ({ page, baseURL }) => {
  const errors = await prepare(page);
  const origin = new URL(baseURL).origin;
  const external = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  await openGame(page);
  await startGame(page, 'Offline');
  await typePassage(page);
  await continueInterlude(page);
  await playQuizLevel(page);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);

  // Static checks on the deployed file.
  expect(INDEX_HTML).not.toMatch(/<script[^>]+src=/i);
  expect(INDEX_HTML).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
  expect(INDEX_HTML).not.toMatch(/@import/);
  expect(INDEX_HTML).not.toMatch(/\beval\s*\(/);
  expect(INDEX_HTML).not.toMatch(/new Function\s*\(/);
  expect(INDEX_HTML).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  expect(INDEX_HTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
});
