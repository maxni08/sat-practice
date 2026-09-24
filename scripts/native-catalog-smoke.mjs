/** Final installed-release check. Existing v1.1 native full-section and calculator
 * close/reopen proofs are retained; this checks changed reward/presentation paths.
 * Normal QA responses are removed by restoring a verified post-upgrade snapshot.
 * Secrets and Platinum are tested only in isolated unit/browser fixtures.
 */
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const exe=path.resolve(process.argv[2]),python=process.env.PYTHON??'python',output=path.resolve('outputs/native-1.2-verification');
await mkdir(output,{recursive:true});
const bank=JSON.parse(await readFile('public/bank/questions.json','utf8'));
const baseline=JSON.parse(await readFile('work/native-study/clean-state.json','utf8'));
const snapshot=path.resolve('work/native-study/real-progress-1.2-before-qa-'+Date.now()+'.sqlite3');
const report={version:'1.2.0',executable:exe,startedAt:new Date().toISOString(),checks:[],errors:[]};
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
 assert.deepEqual(protectedState.progress,baseline.state.progress);assert.equal(Object.keys(protectedState.progress).length,21);assert.deepEqual(protectedState.session,baseline.state.session);
 assert.equal(protectedStudy.xp,baseline.study.xp);for(const [id,date] of Object.entries(baseline.study.achievements))assert.equal(protectedStudy.achievements[id],date);
 for(const field of ['credits','evidence','reviews','adaptive','modules','completedSessions','skillAwards'])assert.deepEqual(protectedStudy[field],baseline.study[field]);
 assert.equal(protectedStudy.trophies.version,2);assert.deepEqual(protectedStudy.trophies.awardedXp,{});
 check('Upgrade preserves all 21 real records, newer highlight, notes, bookmarks, session, XP/level, old achievement dates and learning history; no backfill reward');
 await photo('upgraded-home');await stop();
 execFileSync(python,['scripts/sqlite-snapshot.py','backup',dataLocation,snapshot],{windowsHide:true,stdio:'inherit'});backupCreated=true;
 execFileSync(python,['scripts/verify-study-snapshot.py',snapshot,'work/native-study/clean-state.json'],{windowsHide:true,stdio:'inherit'});
 await launch();assert.deepEqual(await state(),protectedState);assert.deepEqual(await study(),protectedStudy);check('Real process restart preserves upgraded catalog and all original study data');
 await page.getByRole('button',{name:'Achievements',exact:true}).click();assert.match(await page.locator('.trophy-summary').innerText(),/64/);await page.getByLabel('Show',{exact:true}).selectOption('Secret');assert.equal(await page.locator('.trophy-card').count(),10);assert.equal(await page.getByRole('heading',{name:'???',exact:true}).count(),10);await photo('locked-secrets');await home();
 await page.getByRole('button',{name:/^Practice Modules Timed/}).click();await page.getByRole('button',{name:'Start Math module',exact:true}).click();await confirm();
 const initial=(await state()).session;assert.equal(initial.questionIds.length,22);
 for(let i=0;i<22;i++){await select(i!==0);assert.equal(await page.locator('.feedback').count(),0);assert.equal(await page.locator('.choice.correct').count(),0);if(i===0){await page.getByRole('button',{name:'Mark for Review',exact:true}).click();await page.getByRole('button',{name:'Highlights & Notes',exact:true}).click();await page.getByRole('textbox',{name:'Question note'}).fill('Temporary final-release QA note');await page.keyboard.press('Escape');}if(i<21)await page.getByRole('button',{name:'Next',exact:true}).click();}
 assert.deepEqual((await state()).session.answers,{});await finish();await page.getByRole('heading',{name:'Module results',exact:true}).waitFor();
 const completed=await study();assert.equal(completed.modules.at(-1).score,21);assert(completed.xp>protectedStudy.xp);assert(Object.keys(completed.trophies.awardedXp).length>0);assert(completed.reviews[initial.questionIds[0]]);assert.notDeepEqual(completed.skills,protectedStudy.skills);
 await photo('module-and-achievement');report.newAchievements=Object.keys(completed.achievements).filter(id=>!protectedStudy.achievements[id]);check('Complete installed Math module keeps answers secret, then saves 21/22, normal live achievement rewards, XP, mastery and review scheduling');
 await home();await page.getByRole('button',{name:'Module History',exact:true}).click();await page.getByRole('button',{name:'Review module',exact:true}).first().click();await page.getByRole('heading',{name:'College Board explanation'}).waitFor();check('Installed module history opens preserved answers and College Board explanations');await home();
 await page.getByRole('button',{name:/^Challenge Ladder/}).click();await page.getByRole('button',{name:'Start challenge',exact:true}).click();await confirm();
 for(let i=0;i<12;i++){await select(true);if(i<11)await page.getByRole('button',{name:'Next',exact:true}).click();}
 await finish();await page.getByRole('heading',{name:'Challenge 1: Passed',exact:true}).waitFor();assert.equal((await study()).ladder.highestUnlocked,2);await photo('challenge-passed');check('Installed challenge grades a fresh 12-question set and persists the next unlocked level');await home();
 await page.getByRole('button',{name:/^Full SAT Mock/}).click();await confirm();
 for(let stage=0;stage<4;stage++){
  await page.getByText(`Full SAT Mock · Module ${stage+1} of 4`,{exact:true}).waitFor();
  const count=stage<2?27:22;for(let i=0;i<count;i++){await select(true);assert.equal(await page.locator('.feedback').count(),0);if(i<count-1)await page.getByRole('button',{name:'Next',exact:true}).click();}
  await finish();
  if(stage<3){await page.getByRole('button',{name:stage===1?'Continue to Math':'Start Module 2',exact:true}).click();}
 }
 await page.getByRole('heading',{name:'Estimated SAT Score',exact:true}).waitFor();assert.equal((await state()).session.questionIds.length,98);assert.equal(Object.values((await state()).session.answers).filter(a=>a.correct).length,98);await photo('full-mock-results');check('Installed full mock completes all four modules, adaptive routes and subject break, then displays raw performance and estimated score range');await home();
 await page.getByRole('button',{name:/^Adaptive Practice Practice/}).click();await page.getByRole('button',{name:'Begin adaptive practice',exact:true}).click();await confirm();
 for(let i=0;i<3;i++){await select(true);await page.getByRole('button',{name:'Submit Answer',exact:true}).click();await page.locator('.feedback h2').filter({hasText:'Correct'}).waitFor();if(i<2)await page.getByRole('button',{name:'Next',exact:true}).click();}
 assert.equal((await study()).adaptive.Math.level,'Hard');await page.getByRole('button',{name:'Next',exact:true}).click();await select(false);
 const calculatorBefore=(await state()).session;await page.getByRole('button',{name:'Calculator',exact:true}).click();let calc;
 for(let i=0;i<120;i++){calc=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('desmos.com'));if(calc&&await calc.locator('canvas').count())break;await delay(500);}assert(calc);await calc.locator('canvas').first().waitFor({state:'attached',timeout:60000});await calc.screenshot({path:path.join(output,'desmos.png')});
 assert.deepEqual((await state()).session.drafts,calculatorBefore.drafts);check('Installed Adaptive Practice updates difficulty and official Desmos renders without changing the current draft');
 await home();const qaState=await state(),qaStudy=await study();await stop();await launch();assert.deepEqual(await study(),qaStudy);assert.deepEqual(await state(),qaState);check('Second full restart preserves QA XP, achievements, mastery, module answers/history, adaptive state, notes, bookmarks, session and review schedule');
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.stack??e);console.error(e);process.exitCode=1;try{await photo('failure');}catch{}}
finally{
 await stop();
 if(backupCreated){
  execFileSync(python,['scripts/sqlite-snapshot.py','restore',dataLocation,snapshot],{windowsHide:true,stdio:'inherit'});
  await launch();assert.deepEqual(await state(),protectedState);assert.deepEqual(await study(),protectedStudy);await photo('real-progress-restored');await stop();check('All temporary QA data removed; post-upgrade real study snapshot restored and verified through the installed application');
 }
 report.finishedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}

