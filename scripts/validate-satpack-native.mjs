/** Validate a .satpack with the installed 1.5.0 Tauri importer in Temp only. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw Error('Native Windows WebView2 validation requires Windows');
const executable = path.resolve(process.argv[2]);
const pack = path.resolve(process.argv[3]);
const review = process.argv[4] ? path.resolve(process.argv[4]) : null;
if (!existsSync(executable) || !existsSync(pack)) throw Error('Expected installed EXE and existing .satpack');
const profile = await mkdtemp(path.join(os.tmpdir(), 'satpack-native-validation-'));
const port = 9464;
let child, browser, passed = false;
try {
  child = spawn(executable, [], { env: { ...process.env,
    SAT_PRACTICE_TEST_DATA_DIR: profile,
    WEBVIEW2_USER_DATA_FOLDER: path.join(profile, 'WebView2'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`
  }, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`App exited: ${child.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
    catch { await delay(350); }
  }
  if (!browser) throw Error('Installed app WebView2 did not open');
  let page;
  for (let i = 0; i < 100; i++) {
    page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('tauri.localhost'));
    if (page) break;
    await delay(200);
  }
  if (!page) throw Error('Main app window missing');
  const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  await page.getByRole('heading', { name: 'Make every question count.' }).waitFor();
  const location = String(await invoke('data_location'));
  assert(location.toLowerCase().includes(path.basename(profile).toLowerCase()), 'Validation did not use the isolated Temp profile');
  const report = await invoke('import_question_file', { path: pack });
  assert.deepEqual([report.valid, report.skipped, report.duplicates, report.invalid, report.missingAssets, report.unsupported], [3770, 0, 0, 0, 0, 0]);
  const library = await invoke('load_question_library');
  assert.equal(library.questions.length, 3770);
  const math = library.questions.find(q => q.test === 'Math' && q.assets?.length);
  const rw = library.questions.find(q => q.test === 'Reading and Writing' && q.sourceAssets?.length);
  assert(math && rw);
  assert.equal(math.sourcePages.length > 0, true);
  assert((await invoke('read_question_asset', { uri: math.assets[0] })).startsWith('data:image/png;base64,'));
  assert((await invoke('read_question_asset', { uri: rw.sourceAssets[0] })).startsWith('data:image/png;base64,'));
  if (review) {
    const data = JSON.parse(await readFile(review, 'utf8'));
    data.validation = { result: 'passed', engine: 'installed SAT Practice 1.5.0 native validator',
      valid: report.valid, skipped: report.skipped, duplicates: report.duplicates,
      invalid: report.invalid, missingAssets: report.missingAssets, unsupported: report.unsupported };
    await writeFile(review, JSON.stringify(data, null, 2));
  }
  console.log(JSON.stringify({ report, questions: library.questions.length, mathAsset: true, readingAsset: true, isolatedProfile: true }));
  passed = true;
} finally {
  if (child && child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
  try { await browser?.close(); } catch { /* closed */ }
  const target = path.resolve(profile), temp = path.resolve(os.tmpdir()) + path.sep;
  if (passed && target.toLowerCase().startsWith(temp.toLowerCase())) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await rm(profile, { recursive: true, force: true }); break; }
      catch (error) {
        if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
        if (attempt === 19) throw error;
        await delay(500);
      }
    }
  }
  else if (!passed) console.error(`Isolated failed validation retained at ${profile}`);
}
