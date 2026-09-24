import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const exe = process.argv[2];
const output = 'outputs/native-1.3-verification';
await mkdir(output, { recursive: true });
let child, browser, page;
async function launch() {
  child = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9447' } });
  for (let i = 0; i < 100; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9447', { timeout: 1000 }); break; }
    catch { await delay(400); }
  }
  assert(browser, 'Installed WebView2 did not start');
  for (let i = 0; i < 100; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
    if (page) break;
    await delay(200);
  }
  assert(page);
  await page.getByRole('heading', { name: 'Make every question count.' }).waitFor();
}
async function stop() {
  if (child?.exitCode === null && child?.signalCode === null) {
    const exit = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exit;
  }
  try { await browser?.close(); } catch {}
  child = browser = page = null;
  await delay(800);
}
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const report = { version: '1.3.0', checkedAt: new Date().toISOString() };
try {
  await launch();
  const firstState = await invoke('load_state'), firstStudy = await invoke('load_study');
  report.dataLocation = await invoke('data_location');
  report.observedRecords = Object.keys(firstState.progress).length;
  report.observedXp = firstStudy.xp;
  await writeFile(`${output}/observed.json`, JSON.stringify(report, null, 2));
  assert.equal(Object.keys(firstState.progress).length, 21);
  assert.equal(firstStudy.xp, 299);
  assert.equal(Object.keys(firstStudy.progression.stages).length, 0);
  assert.equal(firstStudy.progression.runs.length, 0);
  assert(Object.values(firstStudy.progression.quests).every(q => !q.paidAt));
  assert.equal(firstStudy.progression.rank.highest, 0);
  report.statusText = await page.getByRole('region', { name: 'Player status' }).innerText();
  assert.match(report.statusText, /Bronze III/);
  assert.match(report.statusText, /0 \/ 288 Stars/);
  await page.getByText('Exact requirements for the next rank', { exact: true }).click();
  report.nextRankRequirements = await page.getByRole('region', { name: 'Player status' }).locator('details').innerText();
  assert.equal(await page.getByRole('button', { name: /^Full SAT Mock/ }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /^Challenge Ladder/ }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Open Campaign & Records' }).count(), 1);
  await stop();
  await launch();
  assert.deepEqual(await invoke('load_state'), firstState);
  assert.deepEqual(await invoke('load_study'), firstStudy);
  report.records = 21; report.xp = 299; report.rank = 'Bronze III'; report.stars = 0; report.status = 'passed';
} finally {
  await stop();
  await writeFile(`${output}/clean-final.json`, JSON.stringify(report, null, 2));
}
