import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";

const exe = process.argv[2];
const exercise = process.argv.includes("--exercise");
const port = 9452;
let child, browser, page;

async function launch() {
  child = spawn(exe, [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
      break;
    } catch {
      await delay(300);
    }
  }
  assert(browser, "Installed WebView2 did not start");
  for (let i = 0; i < 100; i++) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes("tauri.localhost"));
    if (page) break;
    await delay(200);
  }
  assert(page, "Installed SAT Practice page did not become ready");
  await page.getByRole("heading", { name: "Make every question count." }).waitFor();
}

async function stop() {
  if (child?.exitCode === null && child?.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  try { await browser?.close(); } catch {}
  child = browser = page = null;
  await delay(700);
}

const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });

async function verifyIdentity() {
  const state = await invoke("load_state");
  const study = await invoke("load_study");
  const playtime = await invoke("load_playtime");
  assert.equal(Object.keys(state.progress).length, 21);
  assert.equal(study.xp, 299);
  assert.equal(playtime.version, 1);
  assert(playtime.totalSeconds >= 0);
  await page.getByRole("region", { name: "Player status" }).waitFor();
  assert.match(await page.getByRole("region", { name: "Player status" }).innerText(), /Total Playtime/);
  await page.getByRole("button", { name: /Your progress/ }).click();
  const panel = page.getByRole("region", { name: "Active study playtime" });
  await panel.waitFor();
  for (const label of ["Total Playtime", "Today", "This Week", "Current Session", "Average active day", "Longest study day"])
    assert.match(await panel.innerText(), new RegExp(label, "i"));
  await page.getByRole("button", { name: "← Home" }).click();
  return { state, study, playtime };
}

try {
  await launch();
  const baseline = await verifyIdentity();
  if (!exercise) {
    console.log(`PASS installed 1.3.2 baseline: 21 records, XP 299, playtime ${baseline.playtime.totalSeconds}s`);
  } else {
    await page.getByRole("button", { name: /^Reading & Writing/ }).click();
    await page.getByLabel("Number of questions").fill("3");
    await page.getByLabel("Randomized order").uncheck();
    await page.getByRole("button", { name: "Begin practice →" }).click();
    if (await page.getByRole("button", { name: "Start new session" }).count())
      await page.getByRole("button", { name: "Start new session" }).click();
    await page.getByRole("button", { name: "Submit Answer" }).waitFor();
    await delay(18_000);
    let saved;
    for (let i = 0; i < 20; i++) {
      saved = await invoke("load_playtime");
      if (saved.totalSeconds > baseline.playtime.totalSeconds) break;
      await delay(500);
    }
    assert(saved.totalSeconds > baseline.playtime.totalSeconds, "Active practice time was not persisted");
    const persistedTotal = saved.totalSeconds;
    await stop();
    await launch();
    const restarted = await verifyIdentity();
    assert(restarted.playtime.totalSeconds >= persistedTotal);
    assert.equal(Object.keys(restarted.state.progress).length, 21);
    assert.equal(restarted.study.xp, 299);
    console.log(`PASS installed 1.3.2 restart: active playtime persisted (${baseline.playtime.totalSeconds}s → ${restarted.playtime.totalSeconds}s)`);
  }
} finally {
  await stop();
}
