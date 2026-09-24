/** Exercise an actual release/installed Windows WebView2 app. No debug port is built into the app.
 * Usage: node scripts/native-smoke.mjs "C:\path with spaces\sat-practice.exe"
 * The test backs up and restores existing app state through native commands.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('This test must run on Windows with WebView2.');
const executable = path.resolve(process.argv[2] ?? 'src-tauri/target/release/sat-practice.exe');
if (!existsSync(executable)) throw new Error(`Build the app first: ${executable}`);
const output = path.resolve('outputs/native-verification');
await mkdir(output, { recursive: true });
const report = { executable, startedAt: new Date().toISOString(), checks: [], errors: [] };
let child, browser, page, original;
const port = 9447;
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
async function invoke(command, args = {}) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}
async function launch() {
  child = spawn(executable, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore', windowsHide: true,
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Application exited early: ${child.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
    catch { await delay(500); }
  }
  if (!browser) throw new Error('Could not connect to the actual application WebView2.');
  for (let attempt = 0; attempt < 80; attempt++) {
    page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().includes('tauri.localhost'));
    if (page) break;
    await delay(250);
  }
  if (!page) throw new Error('Local practice webview did not appear.');
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.getByRole('heading', { name: 'Make every question count.' }).waitFor();
}
async function stop() {
  // An abrupt process stop proves that committed SQLite state is durable.
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  try { await browser?.close(); } catch {}
  browser = null; page = null;
  await delay(600);
}
async function home() {
  await page.keyboard.press('Escape');
  const button = page.getByRole('button', { name: 'Save and return home', exact: true });
  if (await button.count()) await button.click();
  else if (await page.getByRole('button', { name: '← Home', exact: true }).count()) await page.getByRole('button', { name: '← Home', exact: true }).click();
  await page.getByRole('heading', { name: 'Make every question count.' }).waitFor();
}
async function begin(section) {
  await page.getByRole('button', { name: section === 'Math' ? /^Math Build precision/ : /^Reading & Writing Read closely/ }).click();
  await page.getByLabel('Number of questions').fill('3');
  await page.getByLabel('Randomized order').uncheck();
  await page.getByLabel('Timing', { exact: true }).selectOption('question');
  await page.getByRole('button', { name: 'Begin practice →', exact: true }).click();
  if (await page.getByRole('button', { name: 'Start new session', exact: true }).count()) await page.getByRole('button', { name: 'Start new session', exact: true }).click();
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).waitFor();
}

async function verifyLayouts(section) {
  const cdp = await browser.contexts()[0].newCDPSession(page);
  report.emulatedWebViewLayouts ??= [];
  try {
    for (const display of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      for (const scale of [1, 1.25, 1.5]) {
        const width = Math.floor(display.width / scale);
        const height = Math.floor(display.height / scale);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
        await page.locator('.answer-pane').evaluate(element => { element.scrollTop = 0; });
        const layout = await page.evaluate(() => ({
          width: innerWidth, height: innerHeight, devicePixelRatio,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          controlsVisible: [...document.querySelectorAll('.practice-toolbar button,.practice-footer button')].every(button => {
            const rect = button.getBoundingClientRect();
            return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
          }),
        }));
        assert.equal(layout.overflow, false);
        assert.equal(layout.controlsVisible, true);
        report.emulatedWebViewLayouts.push({ section, display, scale, ...layout });
        await page.screenshot({ path: path.join(output, `webview2-${section}-${display.width}x${display.height}-${scale * 100}.png`) });
      }
    }
    check(`${section}: six resolution/DPI combinations pass in the installed WebView2 engine (device-metrics emulation)`);
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
  }
}

try {
  await launch();
  check('Packaged Windows executable launches and loads the local bank');
  original = await invoke('load_state');
  // Durable recovery snapshot in scratch space, never in shipped artifacts.
  await mkdir('work/native-test', { recursive: true });
  await writeFile('work/native-test/original-state.json', JSON.stringify(original));
  report.dataLocation = await invoke('data_location');
  assert.match(report.dataLocation.toLowerCase(), /appdata[\\/]roaming[\\/]com\.local\.satpractice[\\/]progress\.sqlite3$/);
  check('SQLite is in the writable Windows Roaming app-data directory');
  report.display = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  await page.screenshot({ path: path.join(output, 'packaged-home.png'), fullPage: true });
  const bankText = await page.evaluate(async () => (await fetch('/bank/questions.json')).text());
  const bank = JSON.parse(bankText);
  const digest = text => createHash('sha256').update(text).digest('hex');
  report.bankSha256 = digest(bankText);
  assert.equal(report.bankSha256, digest(await readFile('public/bank/questions.json', 'utf8')));
  check('Packaged question-bank checksum exactly matches the imported source bank');
  report.questionCounts = { total: bank.length, math: bank.filter(q => q.test === 'Math').length, readingWriting: bank.filter(q => q.test !== 'Math').length };
  assert.deepEqual(report.questionCounts, { total: 3770, math: 1925, readingWriting: 1845 });
  check('All 3,770 questions are packaged: 1,925 Math and 1,845 Reading & Writing');
  await begin('Math');
  const before = await invoke('load_state');
  const id = before.session.questionIds[0];
  const question = bank.find(q => q.id === id);
  assert.equal(await page.getByRole('region', { name: 'Answer explanation' }).count(), 0);
  const bookmark = page.getByRole('button', { name: 'Mark for Review', exact: true });
  if (await bookmark.getAttribute('aria-pressed') !== 'true') await bookmark.click();
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Question note', exact: true }).fill('Native packaged verification note');
  await page.keyboard.press('Escape');
  if (question.questionType === 'multiple-choice') {
    await page.getByRole('button', { name: 'Cross out A', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Restore A', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Restore A', exact: true }).click();
    const wrong = ['A', 'B', 'C', 'D'].find(choice => choice !== question.correctAnswer);
    await page.locator('.choice').filter({ has: page.locator('.choice-letter', { hasText: wrong }) }).click();
  } else await page.getByRole('textbox', { name: 'Your answer', exact: true }).fill('-987654321');
  assert.equal(await page.getByRole('region', { name: 'Answer explanation' }).count(), 0);
  check('Math renders and selecting/entering an answer does not reveal the solution');
  await page.getByRole('button', { name: 'Hide Timer', exact: true }).click();
  await page.getByRole('button', { name: 'Show Timer', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show Timer', exact: true }).click();
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
  await page.getByRole('heading', { name: 'Incorrect', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'College Board explanation', exact: true }).waitFor();
  check('Explicit submit exposes correctness and the original explanation');
  let saved = await invoke('load_state');
  assert.equal(saved.progress[id].bookmark, true);
  assert.equal(saved.progress[id].notes, 'Native packaged verification note');
  assert.equal(saved.progress[id].lastResult, false);
  check('Answer, bookmark, note, and session are committed to native SQLite');
  if (question.questionType === 'numeric') {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Cross out A', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Restore A', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Restore A', exact: true }).click();
    await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  }
  check('Crossing out and restoring an option works independently of answer submission');
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  assert.ok(await page.locator('.stem img').count());
  check('Packaged Math equation and explanation image assets load');
  await page.screenshot({ path: path.join(output, 'packaged-math.png'), fullPage: true });
  await verifyLayouts('math');
  await page.getByRole('button', { name: 'Calculator', exact: true }).click();
  const context = browser.contexts()[0];
  let calculator;
  for (let attempt = 0; attempt < 100; attempt++) {
    calculator = browser.contexts().flatMap(ctx => ctx.pages()).find(p => p.url().startsWith('https://www.desmos.com/calculator'));
    if (calculator) break;
    await delay(300);
  }
  assert.ok(calculator, 'Official Desmos must open in an application webview');
  await calculator.waitForLoadState('domcontentloaded');
  await calculator.locator('.dcg-calculator-api-container,.dcg-calculator').first().waitFor({ timeout: 30000 });
  await calculator.screenshot({ path: path.join(output, 'packaged-desmos.png') });
  const denied = await calculator.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__) return true;
    try { await window.__TAURI_INTERNALS__.invoke('load_state'); return false; } catch { return true; }
  });
  assert.equal(denied, true);
  if (process.env.SAT_MANUAL_CALCULATOR_CHECK === '1') {
    // Optional checkpoint for a real Windows close/reopen action through the
    // title bar. The automation caller supplies the observed result in a file.
    const ready = 'work/native-test/calculator-ready.json';
    const reviewed = 'work/native-test/calculator-reviewed.json';
    const token = new Date().toISOString();
    await writeFile(ready, JSON.stringify({ token, title: 'Desmos Calculator — SAT Practice' }));
    console.log(`MANUAL_READY ${token}`);
    let result;
    for (let attempt = 0; attempt < 360; attempt++) {
      if (existsSync(reviewed)) {
        const candidate = JSON.parse(await readFile(reviewed, 'utf8'));
        if (candidate.token === token) { result = candidate; break; }
      }
      await delay(500);
    }
    assert.equal(result?.passed, true, 'Native calculator close/reopen verification must pass');
    assert.equal(calculator.isClosed(), false, 'Closing the calculator must retain its webview');
    check('Real Windows calculator close/reopen retains its webview and practice session');
  }
  saved = await invoke('load_state');
  assert.equal(saved.session.answers[id].correct, false);
  check('Official Desmos loads in WebView2 without losing the answer, and cannot access native progress');
  await stop();
  await launch();
  const restored = await invoke('load_state');
  assert.equal(restored.progress[id].lastResult, false);
  assert.equal(restored.progress[id].notes, 'Native packaged verification note');
  assert.equal(restored.session.answers[id].correct, false);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('heading', { name: 'Incorrect', exact: true }).waitFor();
  check('Completed progress and interrupted session survive an actual process restart');
  await home();
  await page.getByRole('button', { name: /^Math Build precision/ }).click();
  await page.getByLabel('Question history', { exact: true }).selectOption('incorrect');
  const matching = await page.getByText('matching questions').textContent();
  assert.ok(Number(matching.replace(/[^0-9]/g, '')) > 0);
  check('Incorrect-before filtering remains available after restart');
  await home();
  await begin('Reading and Writing');
  assert.ok(await page.locator('.passage-pane').count());
  await page.screenshot({ path: path.join(output, 'packaged-reading-writing.png'), fullPage: true });
  await verifyLayouts('reading');
  check('Reading & Writing loads in the packaged app with a split passage workspace');
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight selected text', exact: true }).click();
  await page.locator('.passage-pane .question-text').evaluate(element => {
    const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(24, node.textContent.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator('.passage-pane .question-text').dispatchEvent('mouseup');
  await page.locator('.passage-pane mark').first().waitFor();
  const readingState = await invoke('load_state');
  const readingId = readingState.session.questionIds[0];
  assert.ok(readingState.progress[readingId].highlights.length > 0);
  await stop();
  await launch();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('.passage-pane mark').first().waitFor();
  check('Selectable Reading & Writing text highlights persist through an actual Windows process restart');
  const readingQuestion = bank.find(question => question.id === readingId);
  await page.locator('.choice').filter({ has: page.locator('.choice-letter', { hasText: readingQuestion.correctAnswer }) }).click();
  assert.equal(await page.getByRole('region', { name: 'Answer explanation' }).count(), 0);
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
  await page.getByRole('heading', { name: 'Correct', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show original explanation', exact: true }).click();
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  check('Reading & Writing explicit submission and original College Board explanation work after restart');
  const images = await page.locator('img').evaluateAll(elements => elements.map(img => ({ src: img.currentSrc, loaded: img.complete && img.naturalWidth > 0 })));
  assert.ok(images.every(img => img.loaded));
  check('All currently displayed packaged source images load');
  await home();
  const numeric = bank.find(q => q.questionType === 'numeric' && q.acceptedAnswers.some(answer => /^-?\d+$/.test(answer)));
  assert.ok(numeric, 'Bank must include numeric questions');
  const number = numeric.acceptedAnswers.find(answer => /^-?\d+$/.test(answer));
  const numericSession = {
    id: `native-numeric-${Date.now()}`, test: 'Math', questionIds: [numeric.id], index: 0,
    answers: {}, drafts: {}, eliminated: {}, elapsed: {}, timerMode: 'none', timerSeconds: 0,
    startedAt: Date.now(), deadline: null, timerHidden: false, finished: false,
  };
  await invoke('save_session', { session: numericSession });
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your answer', exact: true }).fill(`${Number(number) * 2}/2`);
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
  await page.getByRole('heading', { name: 'Correct', exact: true }).waitFor();
  check('Native numeric entry accepts an equivalent fraction and saves the correct attempt');
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  if (original && page) {
    try {
      await home();
      await delay(500);
      const current = await invoke('load_state');
      for (const id of Object.keys(current.progress)) if (!(id in original.progress)) await invoke('reset_question', { questionId: id });
      for (const [questionId, progress] of Object.entries(original.progress)) await invoke('save_progress', { questionId, progress });
      await invoke('save_session', { session: original.session });
      check('Original personal progress restored after verification');
    } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  }
  if (browser || child) await stop();
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'native-test-report.json'), JSON.stringify(report, null, 2));
}
