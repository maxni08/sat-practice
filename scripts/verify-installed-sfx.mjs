import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const exe = process.argv[2];
let child, browser, page;
async function launch() {
  child = spawn(exe, [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9448",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9448", {
        timeout: 1000,
      });
      break;
    } catch {
      await delay(300);
    }
  }
  assert(browser, "Installed WebView2 did not start");
  for (let i = 0; i < 100; i++) {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("tauri.localhost"));
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
  try {
    await browser?.close();
  } catch {}
  child = browser = page = null;
  await delay(600);
}
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const stored = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("sat-practice:sfx:v1") ?? "null"),
  );

let baselineState, baselineStudy;
try {
  await launch();
  baselineState = await invoke("load_state");
  baselineStudy = await invoke("load_study");
  assert.equal(Object.keys(baselineState.progress).length, 21);
  assert.equal(baselineStudy.xp, 299);
  await page.getByRole("button", { name: "About & storage" }).click();
  await page.getByRole("checkbox", { name: /SFX/ }).uncheck();
  await page.getByRole("checkbox", { name: /SFX/ }).check();
  await page.getByRole("slider", { name: "SFX volume" }).fill("23");
  await page.getByRole("combobox", { name: "Sound mode" }).selectOption("important");
  assert.deepEqual(await stored(), {
    enabled: true,
    volume: 23,
    mode: "important",
  });
  await stop();

  await launch();
  assert.deepEqual(await invoke("load_state"), baselineState);
  assert.deepEqual(await invoke("load_study"), baselineStudy);
  await page.getByRole("button", { name: "About & storage" }).click();
  assert.equal(await page.getByRole("checkbox", { name: /SFX/ }).isChecked(), true);
  assert.equal(await page.getByRole("slider", { name: "SFX volume" }).inputValue(), "23");
  assert.equal(
    await page.getByRole("combobox", { name: "Sound mode" }).inputValue(),
    "important",
  );
  await page.keyboard.press("Escape");
  await invoke("open_calculator");
  let calculator;
  for (let i = 0; i < 120; i++) {
    calculator = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("desmos.com/calculator"));
    if (calculator && (await calculator.locator("canvas").count())) break;
    await delay(500);
  }
  assert(calculator, "Desmos window did not open");
  await calculator.locator("canvas").first().waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "About & storage" }).click();
  await page.getByRole("slider", { name: "SFX volume" }).fill("40");
  await page.getByRole("combobox", { name: "Sound mode" }).selectOption("all");
  assert.deepEqual(await stored(), { enabled: true, volume: 40, mode: "all" });
  assert.deepEqual(await invoke("load_state"), baselineState);
  assert.deepEqual(await invoke("load_study"), baselineStudy);
  console.log("PASS installed 1.3.1: 21 records, XP 299, SFX restart persistence, Desmos");
} finally {
  await stop();
}
