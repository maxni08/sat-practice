import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Question } from '../src/types';
const bank = JSON.parse(readFileSync('public/bank/questions.json','utf8')) as Question[];
const key = 'sat-practice-browser-preview-v1';
async function prefill(page: import('@playwright/test').Page) {
  // Isolated browser fixture only. Exercise final grading and UI transitions through real controls.
  await page.evaluate(({key,bank}) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    for(const id of state.session.questionIds) { state.session.drafts[id] = bank.find(q=>q.id===id)!.acceptedAnswers[0]; state.session.elapsed[id] = 40; }
    localStorage.setItem(key,JSON.stringify(state));
  },{key,bank});
  await page.reload(); await page.getByRole('button',{name:/^Resume/}).click();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.locator('.navigator-button').click(); await page.getByRole('button',{name:'Finish session',exact:true}).click(); await page.getByRole('button',{name:'View results',exact:true}).click();
}
test('challenge pass, unlock, fresh replay and persistent ladder UI', async ({page}) => {
  await page.goto('/'); await page.getByRole('button',{name:/^Challenge Ladder/}).click();
  await expect(page.getByRole('heading',{name:'Challenge Ladder',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Locked',exact:true})).toHaveCount(13);
  await page.getByRole('button',{name:'Start challenge',exact:true}).click();
  await prefill(page); await expect(page.getByRole('heading',{name:'Challenge 1: Passed'})).toBeVisible();
  await page.screenshot({path:'outputs/screenshots/challenge-results.png'});
  const before = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
  await page.reload(); await page.getByRole('button',{name:/^Challenge Ladder/}).click();
  await expect(page.getByRole('button',{name:'Locked',exact:true})).toHaveCount(12);
  await page.screenshot({path:'outputs/screenshots/challenge-ladder.png',fullPage:true});
  await page.getByRole('button',{name:'Replay with new questions',exact:true}).click();
  const after = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
  expect(after.study.ladder).toEqual(before.study.ladder);
  expect(after.session.questionIds.some((id:string)=>before.session.questionIds.includes(id))).toBe(false);
});
test('four-module mock transitions, break, estimated results and review survive reload', async ({page}) => {
  test.setTimeout(90000);
  await page.goto('/'); await page.getByRole('button',{name:/^Full SAT Mock/}).click();
  for(let stage=0; stage<4; stage++) {
    await expect(page.getByText(`Full SAT Mock · Module ${stage+1} of 4`,{exact:true})).toBeVisible();
    await prefill(page);
    if(stage<3) {
      await expect(page.getByRole('heading',{name:stage===1?'Reading & Writing complete':'Module 1 complete',exact:true})).toBeVisible();
      if(stage===1) await page.screenshot({path:'outputs/screenshots/mock-break.png'});
      await page.getByRole('button',{name:stage===1?'Continue to Math':'Start Module 2',exact:true}).click();
    }
  }
  await expect(page.getByRole('heading',{name:'Estimated SAT Score',exact:true})).toBeVisible();
  await expect(page.getByText(/Reading & Writing: 54\/54/)).toBeVisible(); await expect(page.getByText(/Math: 44\/44/)).toBeVisible();
  await page.screenshot({path:'outputs/screenshots/mock-results.png',fullPage:true});
  await page.reload(); await page.getByRole('button',{name:/View last session results/}).click();
  await expect(page.getByRole('heading',{name:'Estimated SAT Score',exact:true})).toBeVisible();
});
