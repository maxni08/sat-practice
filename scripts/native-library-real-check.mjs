/** Read-only installed upgrade/restart check. Never submits answers or writes test data. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const executable=path.resolve(process.argv[2]);
if(!existsSync(executable))throw Error(`Missing installed app: ${executable}`);
const port=9462;
let child,browser,page;
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
async function launch(){
  child=spawn(executable,[],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},windowsHide:true,stdio:'ignore'});
  for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error(`App exited: ${child.exitCode}`);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break}catch{await delay(350)}}
  if(!browser)throw Error('Installed WebView2 did not open');
  for(let i=0;i<80;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200)}
  if(!page)throw Error('Main webview missing');
  await page.getByRole('heading',{name:'Make every question count.'}).waitFor({timeout:20000});
}
async function stop(){
  if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended}
  try{await browser?.close()}catch{}
  child=null;browser=null;page=null;await delay(600);
}
try{
  for(let run=1;run<=2;run++){
    await launch();
    const location=await invoke('data_location');
    assert.match(location.toLowerCase(),/appdata[\\/]roaming[\\/]com\.local\.satpractice[\\/]progress\.sqlite3$/);
    const state=await invoke('load_state'),study=await invoke('load_study'),library=await invoke('load_question_library');
    assert.equal(Object.keys(state.progress).length,21);
    assert.equal(study.xp,299);
    assert.equal(library.sources.find(source=>source.id==='personal')?.count,0);
    const bank=await page.evaluate(async()=>await (await fetch('/bank/questions.json')).json());
    assert.equal(bank.length,3770);
    await page.getByRole('button',{name:/Question Library & Sources/}).click();
    await page.getByRole('heading',{name:'Question Sources'}).waitFor();
    assert(await page.getByText('Built-in SAT Bank').first().isVisible());
    console.log(`PASS installed launch ${run}: 21 real records, 299 XP, 3,770 built-in questions, Library UI`);
    await stop();
  }
} finally {await stop()}
