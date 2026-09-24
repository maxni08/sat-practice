import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";

const exe = process.argv[2], exercise = process.argv.includes("--exercise"), port = 9454;
let child, browser, page;
async function launch() {
  child = spawn(exe, [], { windowsHide: true, stdio: "ignore", env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  for (let i=0;i<100;i++) { try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000}); break; } catch { await delay(300); } }
  assert(browser);
  for (let i=0;i<100;i++) { page=browser.contexts().flatMap((context)=>context.pages()).find((candidate)=>candidate.url().includes("tauri.localhost")); if(page) break; await delay(200); }
  assert(page); await page.getByRole("heading",{name:"Make every question count."}).waitFor();
}
async function stop() {
  if(child?.exitCode===null){const exited=new Promise((resolve)=>child.once("exit",resolve));child.kill();await exited;}
  try{await browser?.close();}catch{} child=browser=page=null; await delay(700);
}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
try {
  await launch();
  const state=await invoke("load_state"), study=await invoke("load_study"), history=await invoke("load_duel_history");
  assert.equal(Object.keys(state.progress).length,21); assert.equal(study.xp,299);
  const status=await page.getByRole("region",{name:"Player status"}).innerText();
  assert.match(status,/CURRENT SAT RANK/); assert.match(status,/84% toward Bronze II/);
  if(!exercise) console.log("PASS installed 1.4.1 baseline: 21 records, XP 299, normalized rank progress visible");
  else {
    await page.getByRole("button",{name:/^Local 1v1/}).click();
    await page.getByLabel("1v1 questions").selectOption("5"); await page.getByLabel("1v1 timer").selectOption("0");
    await page.getByLabel("Player 1 name").fill("Nicolás"); await page.getByLabel("Player 2 name").fill("Agustín");
    await page.getByRole("button",{name:"Start Local 1v1"}).click();
    await assert.doesNotMatch(await page.locator(".duel-scoreboard").innerText(),/NaN/);
    await assert.match(await page.locator(".duel-scoreboard").innerText(),/NICOLÁS\s+0 — 0\s+AGUSTÍN/);
    for(let i=0;i<5;i++){
      await page.keyboard.press("a"); await page.keyboard.press("j");
      await page.getByRole("region",{name:"Nicolás"}).getByRole("button",{name:"Lock in"}).click();
      await page.getByRole("region",{name:"Agustín"}).getByRole("button",{name:"Lock in"}).click();
      await page.getByRole("button",{name:i===4?"Finish match":"Next question"}).click();
    }
    await page.getByText("FINAL SCORE").waitFor();
    const saved=await invoke("load_duel_history"); assert.equal(saved.matches.length,(history?.matches.length??0)+1);
    assert.deepEqual(await invoke("load_state"),state); assert.deepEqual(await invoke("load_study"),study);
    await stop(); await launch();
    const restarted=await invoke("load_duel_history"); assert.equal(restarted.matches.length,(history?.matches.length??0)+1); assert.equal(restarted.matches.at(-1).p1Name,"Nicolás"); assert.equal(restarted.matches.at(-1).p2Name,"Agustín");
    assert.deepEqual(await invoke("load_state"),state); assert.deepEqual(await invoke("load_study"),study);
    await invoke("open_calculator"); let calculator;
    for(let i=0;i<120;i++){calculator=browser.contexts().flatMap((context)=>context.pages()).find((candidate)=>candidate.url().includes("desmos.com/calculator"));if(calculator&&await calculator.locator("canvas").count())break;await delay(500);}
    assert(calculator); await calculator.locator("canvas").first().waitFor({timeout:60000});
    console.log("PASS installed 1.4.1: zero-score Local 1v1, custom names, isolated data, restart history, rank UI, Desmos");
  }
} finally { await stop(); }
