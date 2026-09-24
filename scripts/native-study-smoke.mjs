/** Installed Windows QA. --prepare on v1, upgrade, then --verify on v1.1.
 * Uses a consistent external SQLite backup. --restore requires app fully closed.
 * PYTHON must name Python 3.11+. Never restores a live database.
 */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const executable=path.resolve(process.argv[2]);
const mode=process.argv[3]??'--verify';
const root=path.resolve('work/native-study');
const output=path.resolve(['--verify','--resume'].includes(mode)?'outputs/native-study-verification':mode==='--final'?'outputs/native-final-verification':`work/native-study/maintenance/${mode.slice(2)}`);
await mkdir(root,{recursive:true});await mkdir(output,{recursive:true});
const python=process.env.PYTHON??'python';
const calculatorMarker=path.join(root,mode==='--final'?'calculator-final-reopened.json':'calculator-reopened.json');
const report={executable,startedAt:new Date().toISOString(),checks:[],errors:[]};
if(mode==='--resume'){Object.assign(report,JSON.parse(await readFile(path.join(output,'report.json'),'utf8')));delete report.failure;report.status='resumed';}
let child,browser,page;
const bank=JSON.parse(await readFile('public/bank/questions.json','utf8'));
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const saved=()=>invoke('load_state');
const study=()=>invoke('load_study');
async function launch(){
  child=spawn(executable,[],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9447'},windowsHide:true,stdio:'ignore'});
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9447',{timeout:1000});break;}catch{await delay(400);}}
  assert(browser,'Installed WebView2 must open');
  for(let i=0;i<80;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await delay(200);}
  assert(page);page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('heading',{name:'Make every question count.'}).waitFor();
}
async function stop(){
  if(child&&child.exitCode===null&&child.signalCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}
  child=null;
  try{await browser?.close();}catch{}browser=null;page=null;await delay(800);
}
async function home(){
  await page.keyboard.press('Escape');
  for(const name of ['Save and return home','Back to home','← Home']){const b=page.getByRole('button',{name,exact:true});if(await b.count()){await b.click();break;}}
  await page.getByRole('heading',{name:'Make every question count.'}).waitFor();
}
async function select(correct=true){
  const persisted=(await saved()).session;
  const visibleId=(await page.locator('.question-id').innerText()).replace(/^ID\s*/, '').trim();
  const q=bank.find(q=>q.questionId===visibleId);assert(q,'Visible question must match the bank');
  if(persisted.questionIds[persisted.index]!==q.id){report.inputTimingMismatches??=[];report.inputTimingMismatches.push({persisted:persisted.questionIds[persisted.index],visible:q.id});}
  const a=correct?q.acceptedAnswers[0]:q.questionType==='numeric'?'-987654321':q.choices.find(c=>c.label!==q.correctAnswer).label;
  if(q.questionType==='numeric')await page.getByRole('textbox',{name:'Your answer',exact:true}).fill(a);
  else await page.locator('.choice').filter({has:page.locator('.choice-letter',{hasText:a})}).click();
  for(let i=0;i<100;i++){if((await saved()).session.drafts[q.id]===a)break;await delay(10);}
  assert.equal((await saved()).session.drafts[q.id],a,'The visible answer must finish saving before the harness navigates');
  return q;
}
async function finish(){await page.locator('.navigator-button').click();await page.getByRole('button',{name:'Finish session',exact:true}).click();await page.getByRole('button',{name:'View results',exact:true}).click();}
async function snapshot(name){await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});}
async function persistReport(){await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
async function startMode(button){
  await home();await page.getByRole('button',{name:/^Practice Modules Timed/}).click();await page.getByRole('button',{name:button,exact:true}).click();
  if(await page.getByRole('button',{name:'Start new session',exact:true}).count())await page.getByRole('button',{name:'Start new session',exact:true}).click();
}
async function completeModule(){
  const s=(await saved()).session;
  for(let i=0;i<s.questionIds.length;i++){await select(true);assert.equal(await page.locator('.feedback').count(),0);if(i<s.questionIds.length-1)await page.getByRole('button',{name:'Next',exact:true}).click();}
  await finish();
}
async function remainingWorkflows(){
  // Exercise actual production controls; no seeded result/session shortcuts.
  await startMode('Start Reading & Writing module');await completeModule();
  await page.getByRole('heading',{name:'Module results',exact:true}).waitFor();assert.equal((await study()).modules.at(-1).score,27);await snapshot('reading-module-results');
  check('Installed Reading & Writing module completes all 27 answers with deferred feedback and persisted raw results');
  for(const subject of ['Math','Reading & Writing']){
    await startMode(`Full ${subject} section`);const first=(await saved()).session;await completeModule();
    await page.getByRole('heading',{name:'Module 1 complete.',exact:true}).waitFor();await page.getByRole('button',{name:'Start Module 2',exact:true}).click();
    const second=(await saved()).session;assert.equal(second.module.route,'harder');assert(!second.questionIds.some(id=>first.questionIds.includes(id)));
    await completeModule();await page.getByRole('heading',{name:'Section results',exact:true}).waitFor();const finished=(await saved()).session;
    assert.equal(finished.questionIds.length,subject==='Math'?44:54);assert.equal(Object.values(finished.answers).filter(a=>a.correct).length,finished.questionIds.length);
    check(`Installed full ${subject} section completes both balanced modules, routes Module 2, and saves combined results`);
  }
  await home();await page.getByRole('button',{name:/^Reading & Writing Read closely/}).click();
  await page.getByLabel('Number of questions').fill('3');await page.getByLabel('Randomized order').uncheck();await page.getByLabel('Timing',{exact:true}).selectOption('question');await page.getByRole('button',{name:'Begin practice →',exact:true}).click();
  await page.getByRole('button',{name:'Cross out B',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Restore B',exact:true}).getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:'Restore B',exact:true}).click();
  await page.getByRole('button',{name:'Mark for Review',exact:true}).click();await page.getByRole('button',{name:'Highlights & Notes',exact:true}).click();await page.getByRole('textbox',{name:'Question note'}).fill('Temporary installed custom-practice note');
  await page.getByRole('button',{name:'Highlight selected text',exact:true}).click();
  const text=page.locator('.question-text').first();await text.evaluate(element=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),node=walker.nextNode();const range=document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(20,node.textContent.length));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await text.dispatchEvent('mouseup');assert((await page.locator('mark').count())>0);
  await select(false);assert.equal(await page.locator('.feedback').count(),0);await page.getByRole('button',{name:'Submit Answer',exact:true}).click();await page.locator('.feedback h2').filter({hasText:'Incorrect'}).waitFor();
  const custom=(await saved()).session,cp=(await saved()).progress[custom.questionIds[0]];assert(cp.notes);assert(cp.highlights.length);assert((await study()).reviews[custom.questionIds[0]]);
  await snapshot('custom-reading');check('Installed custom practice preserves explicit feedback, cross-out, notes, selected-text highlighting, review flag and timed mistake scheduling');
  await home();await page.locator('.progress-link').click();await page.getByRole('button',{name:'Practice Reading & Writing misses',exact:true}).click();assert.equal(await page.getByLabel('Question history').inputValue(),'incorrect');await home();
}

if(mode==='--restore'){
  const preparation=JSON.parse(await readFile(path.join(root,'preparation.json'),'utf8'));
  execFileSync(python,['scripts/sqlite-snapshot.py','restore',preparation.dataLocation,preparation.restoreSnapshot??path.join(root,'original.sqlite3')],{stdio:'inherit',windowsHide:true});
  process.exit(0);
}
try{
  await launch();
  report.dataLocation=await invoke('data_location');
  if(mode==='--diagnose'){
    const m=(await study()).modules.find(m=>m.subject==='Reading and Writing'&&m.score===25)??(await study()).modules.at(-1);
    console.log(JSON.stringify(m.session.questionIds.filter(id=>!m.session.answers[id]?.correct).map(id=>({id,answer:m.session.answers[id]?.answer,expected:bank.find(q=>q.id===id).correctAnswer,previousExpected:bank.find(q=>q.id===m.session.questionIds[m.session.questionIds.indexOf(id)-1])?.correctAnswer})),null,2));
  }else if(mode==='--verify-baseline'){
    const preparation=JSON.parse(await readFile(path.join(root,'preparation.json'),'utf8'));
    assert.deepEqual((await saved()).progress,preparation.original.progress);
    assert.deepEqual((await saved()).session,preparation.original.session);
    await invoke('save_progress',{questionId:preparation.fixtureId,progress:preparation.fixture});
    assert.deepEqual((await saved()).progress,{...preparation.original.progress,[preparation.fixtureId]:preparation.fixture});
    check('Verified restoration of all 19 original records and session through installed v1; upgrade fixture reapplied');
  }else if(mode==='--refresh-backup'){
    const filename=path.join(root,'preparation.json');
    const preparation=JSON.parse(await readFile(filename,'utf8')),current=await saved();
    assert(Object.keys(current.progress).length>=Object.keys(preparation.original.progress).length,'Unexpectedly smaller database: preserve both backups and investigate before upgrade');
    const expected={...preparation.original.progress,[preparation.fixtureId]:preparation.fixture};
    if(JSON.stringify(Object.entries(current.progress).sort())!==JSON.stringify(Object.entries(expected).sort())||JSON.stringify(current.session)!==JSON.stringify(preparation.original.session)){
      const fixtureUnchanged=JSON.stringify(current.progress[preparation.fixtureId])===JSON.stringify(preparation.fixture);
      if(fixtureUnchanged)delete current.progress[preparation.fixtureId];
      await stop();
      const backup=path.join(root,`original-${Date.now()}.sqlite3`);
      execFileSync(python,['scripts/sqlite-snapshot.py','backup',preparation.dataLocation,backup],{stdio:'inherit',windowsHide:true});
      if(fixtureUnchanged)execFileSync(python,['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("DELETE FROM question_progress WHERE question_id=?",(sys.argv[2],)); c.commit(); c.close()',backup,preparation.fixtureId],{stdio:'inherit',windowsHide:true});
      preparation.original=current;preparation.restoreSnapshot=backup;
      await writeFile(filename,JSON.stringify(preparation,null,2));
      check(`Fresh pre-upgrade snapshot preserves ${Object.keys(current.progress).length} real question records added since earlier backup`);
    }else check('Existing recovery snapshot still matches current installed user data');
  }else if(mode==='--reconcile-clean'){
    const preparation=JSON.parse(await readFile(path.join(root,'preparation.json'),'utf8'));
    const current=await saved(),learning=await study();
    for(const [id,p] of Object.entries(preparation.original.progress))assert.deepEqual(current.progress[id],p);
    assert.equal(learning.modules.length,0,'Temporary module history must already have been removed by restore');
    const fixture=current.progress[preparation.fixtureId];assert.deepEqual(fixture,preparation.fixture);
    delete current.progress[preparation.fixtureId];
    if(learning.credits[preparation.fixtureId]?.base)learning.xp-={Easy:8,Medium:15,Hard:25}[bank.find(q=>q.id===preparation.fixtureId).difficulty];
    delete learning.credits[preparation.fixtureId];delete learning.evidence[preparation.fixtureId];delete learning.reviews[preparation.fixtureId];
    const engine=await import(pathToFileURL(path.join(root,'engine.mjs')).href);
    learning.skills=engine.calculateMastery(bank,current.progress,learning.evidence,Date.now());learning.revision++;
    await invoke('commit_study',{eventId:`qa-clean-${Date.now()}`,expectedRevision:learning.revision-1,study:learning,updates:{},session:current.session,removed:[preparation.fixtureId]});
    preparation.original=current;await writeFile(path.join(root,'preparation.json'),JSON.stringify(preparation,null,2));
    await writeFile(path.join(root,'clean-state.json'),JSON.stringify({state:await saved(),study:await study()}));
    await stop();const backup=path.join(root,'real-progress-clean.sqlite3');
    execFileSync(python,['scripts/sqlite-snapshot.py','backup',preparation.dataLocation,backup],{stdio:'inherit',windowsHide:true});
    preparation.restoreSnapshot=backup;await writeFile(path.join(root,'preparation.json'),JSON.stringify(preparation,null,2));
    check(`Clean database preserves ${Object.keys(current.progress).length} real question records, including newer study, and removes the identified fixture`);
  }else if(mode==='--clean-check'){
    const preparation=JSON.parse(await readFile(path.join(root,'preparation.json'),'utf8'));
    assert.deepEqual((await saved()).progress,preparation.original.progress);
    assert.deepEqual((await saved()).session,preparation.original.session);
    const learning=await study();assert.equal(learning.version,2);assert.equal(learning.modules.length,0);
    await writeFile(path.join(root,'clean-state.json'),JSON.stringify({state:await saved(),study:learning}));
    await snapshot('clean-restored-home');check('Clean original user progress and interrupted session restored exactly; real study XP initialized; temporary modules absent');
  }else if(mode==='--prepare'){
    assert(!existsSync(path.join(root,'preparation.json')),'Do not overwrite an existing QA recovery snapshot');
    const original=await saved();
    const q=bank.find(q=>q.test==='Reading and Writing'&&!original.progress[q.id]);
    assert(q,'A spare question is required for the upgrade fixture');
    await stop();
    execFileSync(python,['scripts/sqlite-snapshot.py','backup',report.dataLocation,path.join(root,'original.sqlite3')],{stdio:'inherit',windowsHide:true});
    await launch();
    const fixture={attempts:3,correctAttempts:2,incorrectAttempts:1,lastAnswer:q.correctAnswer,lastResult:true,totalTimeSpent:213,lastAttemptDate:'2026-09-01T00:00:00Z',bookmark:true,notes:'Upgrade verification fixture; removed after QA.',highlights:[{field:'passage',start:0,end:8,color:'yellow'}]};
    await invoke('save_progress',{questionId:q.id,progress:fixture});
    assert.deepEqual((await saved()).progress[q.id],fixture);
    await writeFile(path.join(root,'preparation.json'),JSON.stringify({original,dataLocation:report.dataLocation,fixtureId:q.id,fixture},null,2));
    check('Known v1 progress fixture committed through the installed 1.0 application; original database safely backed up');
  }else{
    const preparation=JSON.parse(await readFile(path.join(root,'preparation.json'),'utf8'));
    if(mode!=='--resume'){
    if(mode==='--final'){
      await invoke('save_progress',{questionId:preparation.fixtureId,progress:preparation.fixture});
      await page.reload();await page.getByRole('heading',{name:'Make every question count.'}).waitFor();
    }
    assert.deepEqual((await saved()).progress[preparation.fixtureId],preparation.fixture);
    for(const [id,p] of Object.entries(preparation.original.progress))assert.deepEqual((await saved()).progress[id],p);
    const learning=await study();assert.equal(learning.version,2);assert(learning.xp>0);
    check('Installed upgrade preserves every original record and v1 fixture; study schema and one-time XP initialization work');
    const bankText=await page.evaluate(async()=>(await fetch('/bank/questions.json')).text());
    const digest=s=>createHash('sha256').update(s).digest('hex');
    assert.equal(digest(bankText),digest(await readFile('public/bank/questions.json','utf8')));report.bankSha256=digest(bankText);
    check('Installed immutable bank exactly matches all 3,770 validated source questions');
    report.display=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));await snapshot('home');
    await page.getByRole('button',{name:/^Practice Modules Timed/}).click();await page.getByRole('button',{name:'Start Math module',exact:true}).click();
    if(await page.getByRole('button',{name:'Start new session',exact:true}).count())await page.getByRole('button',{name:'Start new session',exact:true}).click();
    const initial=(await saved()).session;assert.equal(initial.questionIds.length,22);assert.equal(initial.timerSeconds,2100);
    await page.getByRole('button',{name:'Hide Timer',exact:true}).click();assert.match(await page.locator('.timer').innerText(),/Timer running/);await page.getByRole('button',{name:'Show Timer',exact:true}).click();
    for(let i=0;i<22;i++){
      await select(i!==0);assert.equal(await page.locator('.feedback').count(),0);assert.equal(await page.locator('.choice.correct').count(),0);assert.equal(await page.getByRole('button',{name:'Submit Answer',exact:true}).count(),0);
      if(i===0){await select(true);await select(false);await page.getByRole('button',{name:'Mark for Review',exact:true}).click();await page.getByRole('button',{name:'Highlights & Notes',exact:true}).click();await page.getByRole('textbox',{name:'Question note'}).fill('Installed module verification note');await page.keyboard.press('Escape');}
      if(i<21)await page.getByRole('button',{name:'Next',exact:true}).click();
    }
    assert.deepEqual((await saved()).session.answers,{});await snapshot('module-active');await finish();await page.getByRole('heading',{name:'Module results',exact:true}).waitFor();
    const completed=await study(),record=completed.modules.at(-1);assert.equal(record.score,21);assert.equal(record.answered,22);assert(completed.achievements['modules-1']);assert(completed.xp>learning.xp);assert(completed.reviews[initial.questionIds[0]]);assert.notDeepEqual(completed.skills,learning.skills);
    const level=xp=>Math.floor((1+Math.sqrt(1+4*xp/25))/2);assert(level(completed.xp)>level(learning.xp));assert(Date.parse(completed.reviews[initial.questionIds[0]].dueAt)>Date.now());
    report.module={id:record.id,score:record.score,total:22,xp:completed.xp,level:level(completed.xp),achievements:Object.keys(completed.achievements)};await snapshot('module-results');
    check('Real installed Math module completed through all 22 UI responses, including five numeric entries; no premature feedback; results, XP, mastery, review schedule and achievements saved');
    await home();const afterModule=await saved();await stop();await launch();assert.deepEqual(await study(),completed);assert.deepEqual((await saved()).progress,afterModule.progress);check('Real restart 1 preserves the completed module, XP, derived level, achievements, mastery, schedules and legacy progress');
    await page.getByRole('button',{name:'Module History',exact:true}).click();await page.getByRole('button',{name:'Review module',exact:true}).first().click();await page.locator('.feedback h2').filter({hasText:'Incorrect'}).waitFor();await page.getByRole('heading',{name:'College Board explanation'}).waitFor();
    }
    if(!report.checks.some(c=>c.startsWith('Installed custom practice')))await remainingWorkflows();
    await page.getByRole('button',{name:/^Adaptive Practice Practice/}).click();await page.getByRole('button',{name:'Begin adaptive practice',exact:true}).click();
    if(await page.getByRole('button',{name:'Start new session',exact:true}).count())await page.getByRole('button',{name:'Start new session',exact:true}).click();
    for(let i=0;i<3;i++){await select(true);await page.getByRole('button',{name:'Submit Answer',exact:true}).click();await page.locator('.feedback h2').filter({hasText:'Correct'}).waitFor();if(i<2)await page.getByRole('button',{name:'Next',exact:true}).click();}
    const adaptive=(await saved()).session;assert.equal(adaptive.adaptive.level,'Hard');assert.equal((await study()).adaptive.Math.level,'Hard');await snapshot('adaptive');
    check('Installed Adaptive Practice grades normally and raises difficulty gradually after three successes');
    await page.getByRole('button',{name:'Next',exact:true}).click();await select(false);
    const calculatorBefore=(await saved()).session;
    await page.getByRole('button',{name:'Calculator',exact:true}).click();
    let calculator;
    for(let i=0;i<100;i++){calculator=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('desmos.com'));if(calculator&&await calculator.locator('canvas').count())break;await delay(500);}
    assert(calculator,'Official in-app Desmos window opens');await calculator.locator('canvas').first().waitFor({state:'attached',timeout:60000});
    report.calculator={url:calculator.url(),title:await calculator.title()};await calculator.screenshot({path:path.join(output,'desmos.png')});
    await writeFile(path.join(root,'calculator-ready.json'),JSON.stringify({phase:'close-and-reopen-with-native-window-controls',questionId:calculatorBefore.questionIds[calculatorBefore.index]}));
    console.log('NATIVE CHECKPOINT: close calculator with its native title-bar control; reopen it from main Calculator button; create work/native-study/calculator-reopened.json after observing it.');
    for(let i=0;i<1200&&!existsSync(calculatorMarker);i++)await delay(500);
    assert(existsSync(calculatorMarker),'Native calculator close/reopen checkpoint not completed');
    const calculatorAfter=(await saved()).session;assert.deepEqual(calculatorAfter.drafts,calculatorBefore.drafts);assert.deepEqual(calculatorAfter.answers,calculatorBefore.answers);assert.equal(calculatorAfter.id,calculatorBefore.id);assert.equal(calculatorAfter.deadline,calculatorBefore.deadline);
    check('Official Desmos was closed/reopened with native window controls without losing question drafts, answers or timer state');
    await home();const finalState=await saved(),finalStudy=await study();await stop();await launch();assert.deepEqual(await study(),finalStudy);assert.deepEqual((await saved()).progress,finalState.progress);assert.deepEqual((await saved()).session,finalState.session);
    await page.getByRole('button',{name:'Resume',exact:true}).click();assert.deepEqual((await saved()).session.drafts,finalState.session.drafts);
    check('Real restart 2 preserves adaptive difficulty, current draft/session, module history, all study fields and original progress');
    await home();await snapshot('restart-home');
    assert.deepEqual(report.errors,[]);report.status='passed';
  }
}catch(error){report.status='failed';report.failure=String(error.stack??error);console.error(error);process.exitCode=1;try{await snapshot('failure');}catch{}}
finally{await stop();report.finishedAt=new Date().toISOString();await persistReport();}
