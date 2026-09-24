import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppState, Question, Session } from '../src/types';

const KEY = 'sat-practice-browser-preview-v1';
const bank = JSON.parse(readFileSync(resolve('public/bank/questions.json'), 'utf8')) as Question[];
const reading = bank.find(q => q.test === 'Reading and Writing' && q.passage && !q.assets.length && q.choices.length === 4)!;
const math = bank.find(q => q.test === 'Math' && q.questionType === 'multiple-choice' && q.assets.length && q.choices.length === 4)!;
const numeric = bank.find(q => q.questionType === 'numeric' && q.acceptedAnswers.some(answer => /^-\d+$/.test(answer)))
  ?? bank.find(q => q.questionType === 'numeric' && q.acceptedAnswers.some(answer => /^-?\d+$/.test(answer)))!;

function sessionFor(questions: Question[], timing: Session['timerMode'] = 'none'): Session {
  return {
    id: `ui-test-${questions[0].id}`, test: questions[0].test, questionIds: questions.map(q => q.id), index: 0,
    answers: {}, drafts: {}, eliminated: {}, elapsed: {}, timerMode: timing, timerSeconds: timing === 'none' ? 0 : 90,
    startedAt: Date.now(), deadline: timing === 'session' ? Date.now() + 90_000 : null,
    timerHidden: false, finished: false,
  };
}

async function home(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make every question count.' })).toBeVisible();
}

async function seedSession(page: Page, questions: Question[], timing: Session['timerMode'] = 'none') {
  await home(page);
  await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify({ progress: {}, session })), { key: KEY, session: sessionFor(questions, timing) });
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: false }).click();
  await expect(page.locator('.question-heading')).toBeVisible();
}

async function savedState(page: Page): Promise<AppState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
}

async function assertImagesLoaded(page: Page) {
  await expect.poll(async () => page.locator('.answer-pane img,.passage-pane img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
}

test('source-format fallbacks preserve unsplit passages and repaired graph choices', async ({page})=>{
  const unsplit=bank.find(q=>q.test==='Reading and Writing'&&!q.passage&&q.requiresOriginalFormat)!;
  expect(unsplit).toBeTruthy();
  await seedSession(page,[unsplit]);
  await expect(page.getByRole('button',{name:'Show selectable text',exact:true})).toBeVisible();
  await assertImagesLoaded(page);
  await page.getByRole('button',{name:'Show selectable text',exact:true}).click();
  await expect(page.locator('.stem .question-text')).toContainText(unsplit.stem);
  const graphs=bank.find(q=>q.id==='e9aed539')!;
  await seedSession(page,[graphs]);
  await assertImagesLoaded(page);
  for(const choice of graphs.choices) expect(choice.assets?.length).toBeGreaterThan(0);
  await expect(page.locator('.choice-content img')).toHaveCount(4);
  await page.locator('.choice').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:'outputs/screenshots/repaired-graph-choice.png'});
});

test('the full imported bank drives metadata filters, multiple difficulty choices and source order', async ({ page }) => {
  expect(bank.length).toBeGreaterThan(3000);
  await home(page);
  await page.locator('.subject').filter({ has: page.getByRole('heading', { name: 'Math', exact: true }) }).click();
  const mathBank = bank.filter(q => q.test === 'Math');
  const domains = [...new Set(mathBank.map(q => q.domain))].sort().slice(0, 2);
  for (const domain of domains) await page.getByRole('checkbox', { name: domain, exact: true }).check();
  await page.getByRole('button', { name: 'Easy', exact: true }).click();
  await page.getByRole('button', { name: 'Hard', exact: true }).click();
  const expected = mathBank.filter(q => domains.includes(q.domain) && ['Easy', 'Hard'].includes(q.difficulty));
  await expect(page.locator('.start-set strong')).toHaveText(`${expected.length.toLocaleString()} matching questions`);
  await page.getByRole('checkbox', { name: 'Randomized order' }).uncheck();
  await page.getByRole('spinbutton', { name: 'Number of questions' }).fill('3');
  await page.getByRole('button', { name: 'Begin practice' }).click();
  await expect(page.locator('.question-id')).toHaveText(`ID ${expected[0].questionId}`);
  expect((await savedState(page)).session?.questionIds).toEqual(expected.slice(0, 3).map(q => q.id));
  await expect(page.locator('.feedback')).toHaveCount(0);
});

test('reading answers, elimination, bookmarks, notes, highlighting, navigation and history survive reload', async ({ page }) => {
  const second = bank.find(q => q.test === reading.test && q.id !== reading.id && q.passage && !q.assets.length)!;
  await seedSession(page, [reading, second], 'question');
  await expect(page.getByRole('region', { name: 'Passage', exact: true })).toBeVisible();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cross out B', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await savedState(page)).session?.drafts[reading.id]).toBeUndefined();
  await page.getByRole('button', { name: 'Restore B', exact: true }).click();
  await page.getByRole('button', { name: 'Mark for Review', exact: true }).click();
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  const note = page.getByRole('textbox', { name: 'Question note' });
  await note.fill('Review the transition: ABCD.');
  await note.press('ArrowRight');
  await expect(page.locator('.navigator-button')).toContainText('Question 1 of 2');
  await page.getByRole('button', { name: 'Highlight selected text' }).click();
  await page.locator('.passage-pane .question-text').evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(24, node.textContent!.length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator('.passage-pane .question-text').dispatchEvent('mouseup');
  await expect(page.locator('.passage-pane mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Hide Timer', exact: true }).click();
  await expect(page.locator('.timer strong')).toHaveText('Timer running');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Show Timer', exact: true }).click();
  await expect(page.locator('.timer strong')).not.toHaveText('1:30');
  const wrong = reading.choices.find(choice => choice.label !== reading.correctAnswer)!.label;
  await page.locator('.answer-pane').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press(wrong.toLowerCase());
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
  await expect(page.locator('.feedback h2')).toHaveText('Incorrect');
  await expect(page.locator('.feedback')).toContainText('College Board explanation');
  await page.locator('.navigator-button').click();
  await expect(page.getByRole('button', { name: 'Question 1, answered, marked for review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Question 2, unanswered', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.navigator-button')).toContainText('Question 2 of 2');
  await page.getByRole('button', { name: 'Previous question' }).click();
  await expect(page.locator('.feedback h2')).toHaveText('Incorrect');
  await expect(page.locator('.passage-pane mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  await expect(note).toHaveValue('Review the transition: ABCD.');
  await page.keyboard.press('Escape');
  const saved = await savedState(page);
  expect(saved.progress[reading.id]).toMatchObject({ attempts: 1, incorrectAttempts: 1, bookmark: true });
  expect(saved.progress[reading.id].totalTimeSpent).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Save and return home' }).click();
  await page.locator('.progress-link').click();
  await page.getByRole('button', { name: 'Practice Reading & Writing misses', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Question history' })).toHaveValue('incorrect');
  await expect(page.locator('.start-set strong')).toHaveText('1 matching questions');
});

test('numeric negative fractional equivalents grade correctly, images load, and calculator preserves the session', async ({ page }) => {
  expect(numeric).toBeTruthy();
  await seedSession(page, [numeric, math]);
  await assertImagesLoaded(page);
  const accepted = numeric.acceptedAnswers.find(answer => /^-?\d+$/.test(answer))!;
  const equivalent = `${BigInt(accepted) * 2n}/2`;
  await page.getByRole('textbox', { name: 'Your answer', exact: true }).fill(equivalent);
  await expect(page.locator('.feedback')).toHaveCount(0);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Calculator', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/desmos\.com\/calculator/);
  await popup.close();
  await expect(page.getByRole('textbox', { name: 'Your answer', exact: true })).toHaveValue(equivalent);
  await expect(page.locator('.navigator-button')).toContainText('Question 1 of 2');
  await page.getByRole('textbox', { name: 'Your answer', exact: true }).press('Enter');
  await expect(page.locator('.feedback h2')).toHaveText('Correct');
  await assertImagesLoaded(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.stem img')).not.toHaveCount(0);
  await assertImagesLoaded(page);
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'View results', exact: true }).click();
  await expect(page.locator('.metric').filter({ hasText: 'Correct answers' }).locator('strong')).toHaveText('1 / 2');
  await expect(page.locator('.metric').filter({ hasText: 'Accuracy' }).locator('strong')).toHaveText('50%');
  expect((await savedState(page)).progress[numeric.id].attempts).toBe(1);
});

test('progress review reveals the stored answer without a new attempt and reset is scoped to one question', async ({ page }) => {
  await seedSession(page, [reading]);
  const wrong = reading.choices.find(choice => choice.label !== reading.correctAnswer)!.label;
  await page.locator('.choice').filter({ has: page.locator('.choice-letter', { hasText: wrong }) }).click();
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
  await expect(page.locator('.feedback')).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'View results', exact: true }).click();
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await page.locator('.progress-link').click();
  await page.locator('.question-list button').filter({ hasText: reading.questionId }).click();
  await expect(page.locator('.feedback h2')).toHaveText('Incorrect');
  await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toHaveCount(0);
  expect((await savedState(page)).progress[reading.id].attempts).toBe(1);
  await page.getByRole('button', { name: 'Reset progress for this question', exact: true }).click();
  await page.getByRole('button', { name: 'Reset question', exact: true }).click();
  await expect.poll(async () => (await savedState(page)).progress[reading.id]).toBeUndefined();
  await expect(page.locator('.feedback h2')).toHaveText('Incorrect');
});

test('keyboard selection and Enter submit once, continue, and respect text inputs', async ({ page }) => {
  const second = bank.find(q => q.test === reading.test && q.id !== reading.id && q.passage && !q.assets.length)!;
  await seedSession(page, [reading, second]);
  await page.keyboard.press(reading.correctAnswer.toLowerCase());
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.feedback h2')).toHaveText('Correct');
  await page.keyboard.press('Enter');
  await expect(page.locator('.navigator-button')).toContainText('Question 2 of 2');
  expect((await savedState(page)).progress[reading.id].attempts).toBe(1);
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  const note = page.getByRole('textbox', { name: 'Question note' });
  await note.fill('ABCD');
  await note.press('Enter');
  await note.press('ArrowLeft');
  await note.press('c');
  expect((await savedState(page)).session?.drafts[second.id]).toBeUndefined();
  await expect(page.locator('.navigator-button')).toContainText('Question 2 of 2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.navigator-button')).toContainText('Question 1 of 2');
});

test('per-question timers retain independent elapsed time and submitted answers stop accruing time', async ({ page }) => {
  await page.clock.install();
  const second = bank.find(q => q.test === reading.test && q.id !== reading.id && q.passage && !q.assets.length)!;
  await seedSession(page, [reading, second], 'question');
  await page.clock.runFor(4000);
  await page.getByRole('button', { name: 'Hide Timer', exact: true }).click();
  await page.clock.runFor(4000);
  await page.getByRole('button', { name: 'Show Timer', exact: true }).click();
  await expect(page.locator('.timer strong')).toHaveText('1:22');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.timer strong')).toHaveText('1:30');
  await page.clock.runFor(2000);
  await page.getByRole('button', { name: 'Previous question' }).click();
  await expect(page.locator('.timer strong')).toHaveText('1:22');
  await page.locator('.choice').filter({ has: page.locator('.choice-letter', { hasText: reading.correctAnswer }) }).click();
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
  await expect(page.locator('.feedback h2')).toHaveText('Correct');
  const time = (await savedState(page)).progress[reading.id].totalTimeSpent;
  await page.clock.runFor(10000);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect((await savedState(page)).progress[reading.id].totalTimeSpent).toBe(time);
  await expect(page.locator('.timer strong')).toHaveText('1:28');
  await page.clock.fastForward(90_000);
  await expect(page.locator('.timer strong')).toHaveText('0:00');
  await expect(page.locator('.timer')).toContainText('Time is up');
  await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toBeVisible();
});

test('session timer continues on the home screen and after an interrupted-session reload', async ({ page }) => {
  await page.clock.install();
  await seedSession(page, [reading], 'session');
  await page.getByRole('button', { name: 'Save and return home' }).click();
  await page.clock.fastForward(100_000);
  await page.reload();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.timer strong')).toHaveText('0:00');
  expect((await savedState(page)).session?.answers).toEqual({});
});

for (const display of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  for (const scale of [1, 1.25, 1.5]) {
    test(`reading and math remain usable at ${display.width}×${display.height}, ${scale * 100}% scaling`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:1421',
        viewport: { width: Math.floor(display.width / scale), height: Math.floor(display.height / scale) },
        deviceScaleFactor: scale,
      });
      const page = await context.newPage();
      for (const question of [reading, math]) {
        await seedSession(page, [question]);
        await assertImagesLoaded(page);
        const images = await page.locator('.choice-content img').evaluateAll(elements => elements.map(element => {
          const image = element as HTMLImageElement;
          return { displayed: image.getBoundingClientRect().width, intrinsic: image.naturalWidth };
        }));
        for (const image of images) expect(image.displayed).toBeLessThanOrEqual(image.intrinsic * 144 / (question.assetDpi ?? 180) + 1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        expect(overflow).toBe(false);
        await expect(page.locator('.navigator-button')).toBeInViewport();
        await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeInViewport();
        await page.screenshot({ path: `outputs/screenshots/${question.test === 'Math' ? 'math' : 'reading'}-${display.width}x${display.height}-${scale * 100}-top.png` });
        const choice = page.locator('.choice').first();
        await choice.scrollIntoViewIfNeeded();
        await expect(choice).toBeInViewport();
        await choice.click();
        await page.getByRole('button', { name: 'Submit Answer', exact: true }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toBeInViewport();
        await page.screenshot({ path: `outputs/screenshots/${question.test === 'Math' ? 'math' : 'reading'}-${display.width}x${display.height}-${scale * 100}.png` });
      }
      await context.close();
    });
  }
}

for (const viewport of [{ width: 900, height: 420 }, { width: 800, height: 400 }]) {
  test(`the minimum window remains usable at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:1421', viewport });
    const page = await context.newPage();
    for (const question of [reading, math]) {
      await seedSession(page, [question]);
      await assertImagesLoaded(page);
      await expect(page.locator('.navigator-button')).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Save and return home' })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeInViewport();
      await page.locator('.choice').first().click();
      await page.getByRole('button', { name: 'Submit Answer', exact: true }).click();
      await expect(page.locator('.feedback')).toBeVisible();
      await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
      await page.getByRole('textbox', { name: 'Question note' }).fill('A note in the smallest window.');
      await page.keyboard.press('Escape');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
      await page.screenshot({ path: `outputs/screenshots/${question.test === 'Math' ? 'math' : 'reading'}-${viewport.width}x${viewport.height}-minimum.png` });
    }
    await context.close();
  });
}
