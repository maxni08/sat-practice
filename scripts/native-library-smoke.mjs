/** Installed WebView2 smoke test using a disposable profile in the system temp folder. */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rename, rm, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw Error('Windows WebView2 required');
const executable = path.resolve(process.argv[2]);
if (!existsSync(executable)) throw Error(`Missing installed executable: ${executable}`);
const profile = await mkdtemp(path.join(os.tmpdir(), 'sat-practice-1.5-smoke-'));
const port = 9461;
let child, browser, page, passed = false;
const checks = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const invoke = (command, args={}) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args), {command,args});
async function launch() {
  child = spawn(executable, [], {env:{...process.env,SAT_PRACTICE_TEST_DATA_DIR:profile,WEBVIEW2_USER_DATA_FOLDER:path.join(profile,'WebView2'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},windowsHide:true,stdio:'ignore'});
  for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error(`App exited: ${child.exitCode}`);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break}catch{await delay(350)}}
  if(!browser)throw Error('Installed WebView2 did not open');
  for(let i=0;i<80;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200)}
  if(!page)throw Error('Main window missing');
  page.setDefaultTimeout(15000);
  await page.getByRole('heading',{name:'Make every question count.'}).waitFor();
}
async function stop(){
  if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended}
  try{await browser?.close()}catch{}
  child=null;browser=null;page=null;await delay(500);
}
async function home(){
  const back=page.getByRole('button',{name:'Save and return home',exact:true});
  if(await back.count())await back.click();
  else {const b=page.getByRole('button',{name:'← Home',exact:true});if(await b.count())await b.click()}
  await page.getByRole('heading',{name:'Make every question count.'}).waitFor();
}
function ps(value){return `'${value.replaceAll("'","''")}'`}
async function createPack(){
  const stage=path.join(profile,'staging');await mkdir(path.join(stage,'assets'),{recursive:true});
  const name='qa-pack', externalId='math:42';
  const question={id:externalId,test:'Math',domain:'Algebra',skill:'Linear equations in one variable',difficulty:'Medium',questionType:'multiple-choice',stem:'If 2x = 8, what is x?',choices:[{label:'A',text:'1'},{label:'B',text:'2'},{label:'C',text:'4'},{label:'D',text:'8'}],correctAnswer:'C',rationale:'Divide both sides by 2.',assets:['assets/figure.png']};
  await writeFile(path.join(stage,'manifest.json'),JSON.stringify({schemaVersion:1,sourceId:name,sourceName:'External QA Pack',packVersion:'1',questionCount:1}));
  await writeFile(path.join(stage,'questions.json'),JSON.stringify([question]));
  const bank=JSON.parse(await readFile('public/bank/questions.json','utf8'));
  const sample=bank.find(q=>q.assets?.length).assets[0];
  await copyFile(path.join('public',sample.replace(/^\//,'')),path.join(stage,'assets','figure.png'));
  const zip=path.join(profile,'staging.zip');
  const command=`Compress-Archive -Path ${ps(path.join(stage,'*'))} -DestinationPath ${ps(zip)} -Force`;
  const result=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr||'Pack creation failed');
  const pack=path.join(profile,'Question Packs','qa-pack.satpack');
  await rename(zip,pack);
  return pack;
}
try{
  await launch();
  const location=String(await invoke('data_location'));
  assert(location.toLowerCase().includes(path.basename(profile).toLowerCase()), `Unexpected test data path: ${location}`);
  assert((await stat(path.join(profile,'WebView2'))).isDirectory(), 'WebView2 local storage must be isolated');
  assert.equal(Object.keys((await invoke('load_state')).progress).length,0);
  const initialXp=(await invoke('load_study')).xp;
  check('installed app uses isolated temporary profile');
  await page.getByRole('button',{name:/Question Library & Sources/}).click();
  await createPack();
  await page.getByText('External QA Pack').first().waitFor({timeout:20000});
  const snapshot=await invoke('load_question_library');
  assert.equal(snapshot.questions.length,1);
  const question=snapshot.questions[0], id=question.id;
  assert.equal(question.questionId,'qa-pack:math:42');
  assert((await invoke('read_question_asset',{uri:question.assets[0]})).startsWith('data:image/png;base64,'));
  check('live folder detection, stable ID and local image');
  await page.getByRole('button',{name:/External QA Pack/}).first().click();
  await page.getByRole('button',{name:/qa-pack:math:42/}).first().click();
  await page.locator('.zoom-source').first().waitFor();
  assert(await page.locator('.zoom-source').first().evaluate(el=>el.naturalWidth>0));
  await page.locator('.zoom-source').first().click();
  await page.getByRole('dialog',{name:/Enlarged/}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog',{name:/Enlarged/}).count(),0);
  check('Study/View asset render and Escape zoom');
  await page.getByRole('button',{name:'Practice this question'}).click();
  await page.locator('.choice').filter({has:page.locator('.choice-letter',{hasText:'C'})}).click();
  await page.getByRole('button',{name:'Submit Answer'}).click();
  assert.equal((await invoke('load_state')).progress[id].attempts,1);
  assert.equal((await invoke('load_study')).xp,initialXp);
  check('external custom answer saves history without changing official XP');
  await home();
  await page.getByRole('button',{name:/Question Library & Sources/}).click();
  await page.getByRole('button',{name:/External QA Pack/}).first().click();
  await page.getByRole('button',{name:'Disable'}).click();
  assert.equal((await invoke('load_question_library')).questions.length,0);
  await page.getByRole('button',{name:'Enable'}).click();
  assert.equal((await invoke('load_question_library')).questions[0].id,id);
  assert.equal((await invoke('load_state')).progress[id].attempts,1);
  check('source toggle preserves versioned question history');
  await page.getByRole('button',{name:'Add Question'}).click();
  await page.getByLabel('Domain').fill('Algebra');await page.getByLabel('Skill').fill('Linear equations in one variable');
  await page.getByLabel('Question text').fill('What is 3 + 4?');
  for(const [i,value] of ['5','6','7','8'].entries())await page.locator('.library-choices input').nth(i).fill(value);
  await page.getByLabel('Correct answer').selectOption('C');
  await page.getByLabel('Explanation').fill('Add 3 and 4 to get 7.');
  await page.getByRole('button',{name:'Save Question'}).click();
  assert.equal((await invoke('load_question_library')).questions.length,2);
  check('personal question appears immediately');
  await home();await page.getByRole('button',{name:/Question Finder & Study Tools/}).click();
  await page.getByLabel('Find question').fill('qa-pack:math:42');
  await page.getByRole('button',{name:/qa-pack:math:42/}).first().click();
  await page.getByRole('button',{name:'Add to Study Queue'}).click();
  check('Finder and Study Queue use external question');
  await stop();await launch();
  assert.equal((await invoke('load_question_library')).questions.length,2);
  assert.equal((await invoke('load_state')).progress[id].attempts,1);
  assert.equal((await invoke('load_study')).xp,initialXp);
  await page.getByRole('button',{name:/Question Finder & Study Tools/}).click();
  await page.getByRole('button',{name:/Queue \(1\)/}).waitFor();
  check('pack, personal question, history and queue survive restart');
  passed=true;
} finally {
  await stop();
  const target=path.resolve(profile), temp=path.resolve(os.tmpdir())+path.sep;
  if(passed&&target.toLowerCase().startsWith(temp.toLowerCase()))await rm(profile,{recursive:true,force:true});
  else if(!passed)console.error(`Isolated failed-test profile retained: ${profile}`);
  console.log(`${checks.length} installed WebView2 checks passed`);
}
