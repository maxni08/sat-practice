import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  emptyProgress,
  type AppState,
  type Question,
  type Session,
} from "../src/types";
import type { StudyState } from "../src/study/types";
import { generateModule } from "../src/study/modules";
import { initializeStudy } from "../src/study/rewards";

const KEY = "sat-practice-browser-preview-v1";
const bank = JSON.parse(
  readFileSync("public/bank/questions.json", "utf8"),
) as Question[];
const legacy = bank.find((q) => q.test === "Reading and Writing")!;
const legacyProgress = {
  ...emptyProgress(),
  attempts: 3,
  correctAttempts: 2,
  incorrectAttempts: 1,
  lastAnswer: legacy.correctAnswer,
  lastResult: true,
  totalTimeSpent: 213,
  lastAttemptDate: "2026-09-01T00:00:00Z",
  bookmark: true,
  notes: "Preserve this pre-upgrade note.",
  highlights: [
    { field: "passage" as const, start: 0, end: 8, color: "yellow" },
  ],
};
const state = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  ) as Promise<AppState & { study: StudyState }>;
async function home(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Make every question count." }),
  ).toBeVisible();
}
async function seed(page: Page, session: Session | null = null) {
  await home(page);
  await page.evaluate(
    ({ key, progress, session }) =>
      localStorage.setItem(key, JSON.stringify({ progress, session })),
    { key: KEY, progress: { [legacy.id]: legacyProgress }, session },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Make every question count." }),
  ).toBeVisible();
}
async function selectAnswer(page: Page, isCorrect = true) {
  const s = (await state(page)).session!,
    q = bank.find((q) => q.id === s.questionIds[s.index])!;
  const answer = isCorrect
    ? q.acceptedAnswers[0]
    : q.questionType === "numeric"
      ? "-987654321"
      : q.choices.find((c) => c.label !== q.correctAnswer)!.label;
  if (q.questionType === "numeric")
    await page
      .getByRole("textbox", { name: "Your answer", exact: true })
      .fill(answer);
  else
    await page
      .locator(".choice")
      .filter({ has: page.locator(".choice-letter", { hasText: answer }) })
      .click();
  return q;
}
async function finish(page: Page) {
  await page.locator(".navigator-button").click();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("button", { name: "View results", exact: true }).click();
}
async function modules(page: Page) {
  await page.getByRole("button", { name: /^Practice Modules Timed/ }).click();
}

test("an existing profile upgrades without losing notes, bookmarks, highlights, answers or history", async ({
  page,
}) => {
  await seed(page);
  const saved = await state(page);
  expect(saved.progress[legacy.id]).toEqual(legacyProgress);
  expect(saved.study.version).toBe(2);
  expect(saved.study.xp).toBeGreaterThan(0);
  await page.reload();
  expect((await state(page)).progress[legacy.id]).toEqual(legacyProgress);
  await page.getByRole("button", { name: "Achievements", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "First Question", exact: true }),
  ).toBeVisible();
  await expect(page.locator('.trophy-card.earned').getByText(/Unlocked/).first()).toBeVisible();
  await page.screenshot({
    path: "outputs/study-screenshots/achievements.png",
    fullPage: true,
  });
});

test("a complete Math module keeps answers secret until finishing, then persists its score, XP and history", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await seed(page);
  await modules(page);
  await page
    .getByRole("button", { name: "Start Math module", exact: true })
    .click();
  const initial = (await state(page)).session!;
  expect(initial.questionIds).toHaveLength(22);
  expect(initial.timerSeconds).toBe(2100);
  await page.getByRole("button", { name: "Hide Timer", exact: true }).click();
  await expect(page.locator(".timer")).toContainText("Timer running");
  await page.getByRole("button", { name: "Show Timer", exact: true }).click();
  for (let i = 0; i < 22; i++) {
    await selectAnswer(page, i !== 0);
    await expect(page.locator(".feedback")).toHaveCount(0);
    await expect(page.locator(".choice.correct")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Submit Answer", exact: true }),
    ).toHaveCount(0);
    if (i === 0) {
      await page
        .getByRole("button", { name: "Mark for Review", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Highlights & Notes", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Question note" })
        .fill("Module note stays with this question.");
      await page.keyboard.press("Escape");
    }
    if (i < 21)
      await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  const ungraded = await state(page);
  expect(ungraded.session!.answers).toEqual({});
  expect(ungraded.study.modules).toHaveLength(0);
  expect(ungraded.progress[initial.questionIds[0]].attempts).toBe(0);
  await page.screenshot({
    path: "outputs/study-screenshots/module-active.png",
  });
  await finish(page);
  await expect(
    page.getByRole("heading", { name: "Module results", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".metric")
      .filter({ hasText: "Correct answers" })
      .locator("strong"),
  ).toHaveText("21 / 22");
  await expect(
    page.getByRole("heading", { name: "Accuracy by difficulty", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All module questions", exact: true }),
  ).toBeVisible();
  const completed = await state(page);
  expect(completed.study.modules).toHaveLength(1);
  expect(completed.study.modules[0].score).toBe(21);
  expect(completed.study.achievements["modules-1"]).toBeTruthy();
  expect(completed.study.xp).toBeGreaterThan(ungraded.study.xp);
  expect(completed.progress[legacy.id]).toEqual(legacyProgress);
  await page.screenshot({
    path: "outputs/study-screenshots/module-results.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  await page.reload();
  expect((await state(page)).study).toEqual(completed.study);
  await page
    .getByRole("button", { name: "Module History", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review module", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review all questions", exact: true })
    .count();
  await expect(page.locator(".feedback h2")).toHaveText("Incorrect");
  await expect(
    page.getByRole("heading", {
      name: "College Board explanation",
      exact: true,
    }),
  ).toBeVisible();
});

test("module answers can be changed freely and expiry grades the final saved draft", async ({
  page,
}) => {
  await page.clock.install();
  const now = Date.now(),
    session = generateModule(
      bank,
      "Reading and Writing",
      {},
      initializeStudy(bank, {}, now),
      { seed: "expiry-module", now },
    );
  session.deadline = now + 5000;
  await seed(page, session);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await selectAnswer(page, false);
  await selectAnswer(page, true);
  await expect(page.locator(".feedback")).toHaveCount(0);
  await page.clock.fastForward(6000);
  await expect(
    page.getByRole("heading", { name: "Module results", exact: true }),
  ).toBeVisible();
  const saved = await state(page);
  expect(saved.study.modules[0].score).toBe(1);
  expect(saved.study.modules[0].answered).toBe(1);
  expect(saved.session?.finished).toBe(true);
});

test("an expired closed module completes on reopen without exposing or accepting new drafts", async ({
  page,
}) => {
  const now = Date.now(),
    session = generateModule(bank, "Math", {}, initializeStudy(bank, {}, now), {
      seed: "closed-expiry",
      now,
    });
  session.deadline = now - 1000;
  await seed(page, session);
  await expect(
    page.getByRole("heading", { name: "Module results", exact: true }),
  ).toBeVisible();
  expect((await state(page)).study.modules[0].answered).toBe(0);
  await page
    .getByRole("button", { name: "Review all questions", exact: true })
    .click();
  await expect(page.locator(".feedback h2")).toHaveText("Unanswered");
  await expect(
    page.getByRole("heading", {
      name: "College Board explanation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit Answer", exact: true }),
  ).toHaveCount(0);
});

test("full sections retain the transition across reload, generate a distinct Module 2 and combine final results", async ({
  page,
}) => {
  await seed(page);
  await modules(page);
  await page
    .getByRole("button", { name: "Full Math section", exact: true })
    .click();
  const first = (await state(page)).session!;
  await selectAnswer(page, true);
  await finish(page);
  await expect(
    page.getByRole("heading", { name: "Module 1 complete.", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Continue section", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start Module 2", exact: true })
    .click();
  const second = (await state(page)).session!;
  expect(second.module?.route).toBe("easier");
  expect(second.questionIds.some((id) => first.questionIds.includes(id))).toBe(
    false,
  );
  expect(second.timerSeconds).toBe(2100);
  await selectAnswer(page, false);
  await finish(page);
  await expect(
    page.getByRole("heading", { name: "Section results", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".metric")
      .filter({ hasText: "Correct answers" })
      .locator("strong"),
  ).toHaveText("1 / 44");
  expect((await state(page)).study.modules).toHaveLength(2);
});

test("adaptive practice progresses after three successes and persists its difficulty and achievements", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: /^Adaptive Practice Practice/ })
    .click();
  await page
    .getByRole("button", { name: "Begin adaptive practice", exact: true })
    .click();
  const original = (await state(page)).session!;
  for (let i = 0; i < 3; i++) {
    await selectAnswer(page, true);
    await page
      .getByRole("button", { name: "Submit Answer", exact: true })
      .click();
    await expect(page.locator(".feedback h2")).toHaveText("Correct");
    if (i < 2)
      await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  const saved = await state(page);
  expect(saved.session?.adaptive?.level).toBe("Hard");
  expect(saved.study.adaptive.Math.level).toBe("Hard");
  expect(saved.session!.questionIds.slice(3)).not.toEqual(
    original.questionIds.slice(3),
  );
  await page
    .getByRole("button", { name: "Save and return home", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  expect((await state(page)).study.adaptive.Math.level).toBe("Hard");
  await page.screenshot({
    path: "outputs/study-screenshots/adaptive-practice.png",
  });
});

test("recommendations launch due review and the extended Progress screen remains usable", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: /1 mistakes due for review/ }).click();
  expect((await state(page)).session!.questionIds).toContain(legacy.id);
  await page
    .getByRole("button", { name: "Save and return home", exact: true })
    .click();
  await page.locator(".progress-link").click();
  await expect(
    page.getByRole("heading", { name: "Weakest skills", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recommended next", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "outputs/study-screenshots/progress.png",
    fullPage: true,
  });
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 910, height: 512 },
  { width: 800, height: 400 },
])
  test(`new study screens fit a ${viewport.width}x${viewport.height} viewport`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seed(page);
    for (const name of ["Achievements", "Module History"] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
      ).toBe(false);
      await page.getByRole("button", { name: "← Home", exact: true }).click();
    }
    await modules(page);
    await expect(
      page.getByRole("button", { name: "Start Math module", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `outputs/study-screenshots/module-setup-${viewport.width}.png`,
      fullPage: true,
    });
  });
