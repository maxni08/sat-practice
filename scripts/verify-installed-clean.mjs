/** Read-only final installed-app check; the baseline contains protected real data. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const baseline = JSON.parse(await readFile('work/native-study/clean-state.json', 'utf8'));
const exe = process.env.LOCALAPPDATA + '\\SAT Practice\\sat-practice.exe';
const child = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9447' } });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9447'); break; } catch { await delay(300); } }
  assert(browser);
  let page;
  for (let i = 0; i < 100; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
    if (page) break;
    await delay(200);
  }
  assert(page, 'Installed WebView2 page did not become ready');
  await page.getByRole('heading', { name: 'Make every question count.' }).waitFor();
  const current = await page.evaluate(async () => ({ state: await window.__TAURI_INTERNALS__.invoke('load_state'), study: await window.__TAURI_INTERNALS__.invoke('load_study'), path: await window.__TAURI_INTERNALS__.invoke('data_location') }));
  assert.deepEqual(current.state, baseline.state);
  assert.equal(current.study.xp, baseline.study.xp);
  assert.equal(current.study.modules.length, 0);
  assert.deepEqual(current.study.trophies.awardedXp, {});
  for (const [id, date] of Object.entries(baseline.study.achievements)) assert.equal(current.study.achievements[id], date);
  assert(!current.study.ladder);
  const report = { status: 'passed', checkedAt: new Date().toISOString(), executable: exe, dataLocation: current.path, realRecords: Object.keys(current.state.progress).length, xp: current.study.xp, temporaryDataRemoved: true };
  await writeFile('outputs/post-cleanup-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (child.exitCode === null && child.signalCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
  await browser?.close();
}
