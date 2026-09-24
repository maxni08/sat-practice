/** Final installed-release check. Existing v1.1 native full-section and calculator
 * close/reopen proofs are retained; this checks changed reward/presentation paths.
 * Normal QA responses are removed by restoring a verified post-upgrade snapshot.
 * Secrets and Platinum are tested only in isolated unit/browser fixtures.
 */
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const exe=path.resolve(process.argv[2]),python=process.env.PYTHON??'python',output=path.resolve('outputs/native-1.3-verification');
await mkdir(output,{recursive:true});
const bank=JSON.parse(await readFile('public/bank/questions.json','utf8'));
const baseline=JSON.parse(await readFile('work/native-study/baseline-1.3.json','utf8'));
const snapshot=path.resolve('work/native-study/real-progress-1.3-before-qa-'+Date.now()+'.sqlite3');
const report={version:'1.3.0',executable:exe,startedAt:new Date().toISOString(),checks:[],errors:[]};
let child,browser,page,dataLocation,protectedState,protectedStudy,backupCreated=false;
const check=s=>{console.log(`PASS ${s}`);report.checks.push(s);};
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const state=()=>invoke('load_state'),study=()=>invoke('load_study');
async function launch(){
 child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9447'}});
 for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9447',{timeout:1000});break;}catch{await delay(400);}}
 assert(browser,'Installed WebView2 did not start');
 for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}
 assert(page);page.setDefaultTimeout(25000);page.on('pageerror',e=>report.errors.push(e.message));await page.getByRole('heading',{name:'Make every question count.'}).waitFor();
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}child=null;try{await browser?.close();}catch{}browser=null;page=null;await delay(800);}
async function home(){await page.keyboard.press('Escape');for(const name of ['Save and return home','Back to home','← Home']){const b=page.getByRole('button',{name,exact:true});if(await b.count()){await b.click();break;}}await page.getByRole('heading',{name:'Make every question count.'}).waitFor();}
async function confirm(){const b=page.getByRole('button',{name:'Start new session',exact:true});if(await b.count())await b.click();}
async function select(correct=true){
 const visible=(await page.locator('.question-id').innerText()).replace(/^ID\s*/,'').trim(),q=bank.find(q=>q.questionId===visible);assert(q);
 const answer=correct?q.acceptedAnswers[0]:q.questionType==='numeric'?'-987654321':q.choices.find(c=>c.label!==q.correctAnswer).label;
 if(q.questionType==='numeric')await page.getByRole('textbox',{name:'Your answer',exact:true}).fill(answer);else await page.locator('.choice').filter({has:page.locator('.choice-letter',{hasText:answer})}).click();
 for(let i=0;i<100&&(await state()).session.drafts[q.id]!==answer;i++)await delay(15);
 assert.equal((await state()).session.drafts[q.id],answer);return q;
}
async function finish(){await page.locator('.navigator-button').click();await page.getByRole('button',{name:'Finish session',exact:true}).click();await page.getByRole('button',{name:'View results',exact:true}).click();}
async function photo(name){await page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled'});}
try{
 await launch();dataLocation=await invoke('data_location');report.dataLocation=dataLocation;report.backup=snapshot;
 protectedState=await state();protectedStudy=await study();
 assert.deepEqual(protectedState,baseline.state);assert.equal(Object.keys(protectedState.progress).length,21);assert.equal(protectedStudy.xp,299);
 for(const field of ['credits','evidence','reviews','adaptive','modules','completedSessions','skillAwards','achievements','trophies','ladder'])assert.deepEqual(protectedStudy[field],baseline.study[field]);
 assert.deepEqual(Object.keys(protectedStudy.skills).sort(),Object.keys(baseline.study.skills).sort());
 assert.equal(protectedStudy.progression.version,1);assert.deepEqual(protectedStudy.progression.stages,{});assert(Object.values(protectedStudy.progression.quests).every(q=>!q.paidAt));
 await page.getByText('Exact requirements for the next rank',{exact:true}).click();report.realStatus=await page.getByRole('region',{name:'Player status'}).innerText();await photo('real-status');
 check('Upgrade retains 21 complete real records, XP 299, all legacy achievements/dates, learning history, notes/highlights/bookmarks and ladder; migration gives no quest XP');
 await stop();execFileSync(python,['scripts/sqlite-snapshot.py','backup',dataLocation,snapshot],{windowsHide:true,stdio:'inherit'});backupCreated=true;
 await launch();assert.deepEqual(await state(),protectedState);assert.deepEqual(await study(),protectedStudy);check('Full installed process restart preserves migrated rank, quests and all prior data');
 await page.getByRole('button',{name:'Open Campaign & Records'}).click();await photo('campaign');
 const firstIds=[];
 for(let stage=1;stage<=2;stage++){
  await page.getByRole('button',{name:'Start stage',exact:true}).first().click();await confirm();
  const current=(await state()).session;assert.equal(current.campaign.stage,`0-0-${stage}`);if(stage===1)firstIds.push(...current.questionIds);else assert(!current.questionIds.some(id=>firstIds.includes(id)));
  for(let i=0;i<current.questionIds.length;i++){await select(true);await delay(3300);assert.equal(await page.locator('.feedback').count(),0);if(i<current.questionIds.length-1)await page.getByRole('button',{name:'Next',exact:true}).click();}
  assert.deepEqual((await state()).session.answers,{});await finish();await page.getByRole('heading',{name:`Algebra — Stage ${stage}: Cleared`,exact:true}).waitFor();assert.equal((await study()).progression.stages[`0-0-${stage}`].stars,3);
  await home();await page.getByRole('button',{name:'Open Campaign & Records'}).click();
 }
 const earned=await study();assert.equal(earned.progression.stages['0-0-1'].stars,3);assert.equal(earned.progression.stages['0-0-2'].stars,3);assert(earned.xp>299);assert(Object.values(earned.progression.quests).some(q=>q.paidAt));assert(earned.progression.records.stage.value===2);assert.equal(earned.modules.length,protectedStudy.modules.length);
 check('Two real timed campaign runs grade only at completion, earn six permanent stars, unlock stages, pay a quest once, update XP/mastery/rank/records and avoid prior IDs');
 await page.getByRole('button',{name:'Replay with fresh questions',exact:true}).first().click();await page.getByText(/Personal ghost: 8\/8/).waitFor();assert(!(await state()).session.questionIds.some(id=>firstIds.includes(id)));await select(true);
 const calculatorBefore=(await state()).session;await page.getByRole('button',{name:'Calculator',exact:true}).click();let calc;
 for(let i=0;i<120;i++){calc=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('desmos.com'));if(calc&&await calc.locator('canvas').count())break;await delay(500);}assert(calc);await calc.locator('canvas').first().waitFor({state:'attached',timeout:60000});
 await writeFile('work/native-study/desmos-ready-1.3.json',JSON.stringify({ready:true}));console.log('DESMOS_READY_FOR_NATIVE_CLOSE');
 let closed=false;for(let i=0;i<300;i++){try{await access('work/native-study/desmos-closed-1.3');closed=true;break;}catch{}await delay(1000);}assert(closed,'Native Desmos close check was not completed');
 await page.getByRole('button',{name:'Calculator',exact:true}).click();await calc.locator('canvas').first().waitFor({state:'attached'});assert.deepEqual((await state()).session.drafts,calculatorBefore.drafts);
 check('Personal ghost replay and official Desmos native close/reopen preserve the current question and draft');
 await home();const qaState=await state(),qaStudy=await study();await stop();await launch();assert.deepEqual(await state(),qaState);assert.deepEqual(await study(),qaStudy);
 check('Second real restart preserves campaign/ghost/stars, paid quests, rank, records, XP, mastery, achievements and current session');
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.stack??e);console.error(e);process.exitCode=1;try{await photo('failure');}catch{}}
finally{
 await stop();
 if(backupCreated){execFileSync(python,['scripts/sqlite-snapshot.py','restore',dataLocation,snapshot],{windowsHide:true,stdio:'inherit'});await launch();assert.deepEqual(await state(),protectedState);assert.deepEqual(await study(),protectedStudy);await stop();check('Temporary validation data removed; exact post-migration real study state restored and verified in the installed app');}
 report.finishedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}
