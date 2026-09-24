import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const bank = JSON.parse(readFileSync("public/bank/questions.json", "utf8"));
const key = "sat-practice-browser-preview-v1";
test("campaign status, objectives, grading, ghost, stars and restart persistence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Player status" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bronze III", exact: true }),
  ).toBeVisible();
  await page
    .getByText("Exact requirements for the next rank", { exact: true })
    .click();
  await expect(page.getByText("Distinct questions: 0 / 25")).toBeVisible();
  await page.getByRole("button", { name: "Open Campaign & Records" }).click();
  await expect(
    page.getByRole("heading", { name: "SAT Campaign", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start stage", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Daily & Weekly Quests" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Personal Records", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start stage", exact: true }).click();
  await page.evaluate(
    ({ key, bank }) => {
      const state = JSON.parse(localStorage.getItem(key)!);
      state.session.startedAt = Date.now() - 300000;
      state.session.deadline =
        state.session.startedAt + state.session.timerSeconds * 1000;
      for (const id of state.session.questionIds) {
        state.session.drafts[id] = bank.find(
          (q: any) => q.id === id,
        ).acceptedAnswers[0];
        state.session.elapsed[id] = 35;
      }
      localStorage.setItem(key, JSON.stringify(state));
    },
    { key, bank },
  );
  await page.reload();
  await page.getByRole("button", { name: /^Resume/ }).click();
  await expect(page.locator(".feedback")).toHaveCount(0);
  await page.locator(".navigator-button").click();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("button", { name: "View results", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Algebra — Stage 1: Cleared" }),
  ).toBeVisible();
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(before.study.progression.stages["0-0-1"].stars).toBe(3);
  expect(before.study.modules).toHaveLength(0);
  await page.reload();
  await expect(page.getByText("3 / 288 Stars", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Campaign & Records" }).click();
  await page
    .getByRole("button", { name: "Replay with fresh questions", exact: true })
    .click();
  await expect(page.getByText(/Personal ghost: 8\/8/)).toBeVisible();
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(
    after.session.questionIds.some((id: string) =>
      before.session.questionIds.includes(id),
    ),
  ).toBe(false);
});
test("campaign region navigation, locked Ascension and small-window reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 910, height: 512 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Campaign & Records" }).click();
  await page.getByLabel("Region").selectOption("1-3");
  await expect(
    page.getByRole("heading", {
      name: "Standard English Conventions — Stage 1",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Region").selectOption("ascension");
  await expect(
    page.getByRole("button", { name: "Locked", exact: true }),
  ).toHaveCount(6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
