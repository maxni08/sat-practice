import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { initializeStudy } from "../src/study/rewards";
import { ACHIEVEMENTS, SECRETS } from "../src/achievements/catalog";
import type { Question } from "../src/types";
const bank = JSON.parse(
    readFileSync("public/bank/questions.json", "utf8"),
  ) as Question[],
  KEY = "sat-practice-browser-preview-v1";
async function open(page: Page, all = false) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Make every question count." }),
  ).toBeVisible();
  const study = initializeStudy(bank, {}, Date.now());
  study.xp = 1234;
  if (all)
    study.achievements = Object.fromEntries(
      ACHIEVEMENTS.map((a) => [a.id, "2026-09-01T12:00:00Z"]),
    );
  await page.evaluate(
    ({ KEY, study }) =>
      localStorage.setItem(
        KEY,
        JSON.stringify({ progress: {}, session: null, study }),
      ),
    { KEY, study },
  );
  await page.reload();
  await page.getByRole("button", { name: "Achievements", exact: true }).click();
}
test("core/secret counters, hidden details and category/rarity filters", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".trophy-summary")).toContainText("0 / 64");
  await expect(page.locator(".trophy-summary")).toContainText("0 / 10");
  await expect(page.locator(".trophy-card")).toHaveCount(74);
  await page.getByLabel("Show", { exact: true }).selectOption("Secret");
  await expect(page.locator(".trophy-card")).toHaveCount(10);
  for (const secret of SECRETS)
    await expect(page.locator(".trophy-grid")).not.toContainText(secret.name);
  await page.locator(".trophy-card").first().click();
  await expect(page.getByRole("dialog")).toContainText("Secret Achievement");
  await expect(page.getByRole("dialog")).not.toContainText("XP");
  await page.keyboard.press("Escape");
  await page.getByLabel("Prestige").selectOption("Diamond");
  await expect(page.locator(".trophy-card")).toHaveCount(0);
  await page.getByLabel("Show", { exact: true }).selectOption("All");
  await expect(page.locator(".trophy-card").first()).toContainText("Diamond");
  await page.getByLabel("Prestige").selectOption("All");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption("Error Recovery");
  await expect(page.locator(".trophy-card").first()).toContainText(
    "Error Recovery",
  );
  await page.screenshot({animations: "disabled",
    path: "work/achievement-visuals/locked-and-filters.png",
    fullPage: true,
  });
});
test("all badge tiers, revealed secrets, details, Platinum and responsive scaling", async ({
  page,
}) => {
  await open(page, true);
  await expect(page.locator(".trophy-summary")).toContainText("64 / 64");
  await expect(page.locator(".platinum-mark")).toContainText("Earned");
  for (const rarity of ["Bronze", "Silver", "Gold", "Diamond", "Platinum"]) {
    await page.getByLabel("Prestige").selectOption(rarity);
    await page.locator(".trophy-card").first().click();
    await expect(page.getByRole("dialog")).toContainText(rarity);
    await page.screenshot({animations: "disabled", path: `work/achievement-visuals/${rarity}.png` });
    await page.keyboard.press("Escape");
  }
  await page.getByLabel("Prestige").selectOption("All");
  await page.getByLabel("Show", { exact: true }).selectOption("Secret");
  await expect(page.locator(".trophy-card").first()).toContainText(
    SECRETS[0].name,
  );
  for (const [width, height] of [
    [1366, 768],
    [1093, 614],
    [911, 512],
    [1920, 1080],
    [1536, 864],
    [1280, 720],
    [800, 400],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator(".trophy-card").first().click();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
  }
});
test("catalog migration keeps XP, unlock dates and persisted legacy history on reload", async ({
  page,
}) => {
  await open(page);
  await page.evaluate((KEY) => {
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    delete saved.study.trophies;
    saved.study.achievements = { "first-question": "2026-01-01T00:00:00Z" };
    saved.study.credits = { known: { base: true, correction: true } };
    localStorage.setItem(KEY, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Make every question count.'})).toBeVisible();
  const saved = await page.evaluate(
    (KEY) => JSON.parse(localStorage.getItem(KEY)!),
    KEY,
  );
  expect(saved.study.xp).toBe(1234);
  expect(saved.study.achievements["first-question"]).toBe(
    "2026-01-01T00:00:00Z",
  );
  expect(saved.study.achievements["recovery-first"]).toBeDefined();
  expect(saved.study.trophies.awardedXp).toEqual({});
  await page.reload();
  await expect(page.getByRole('heading',{name:'Make every question count.'})).toBeVisible();
  expect(
    (await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)!), KEY))
      .study,
  ).toEqual(saved.study);
});
test("normal and controlled Secret unlocks show compact notifications and persist once", async ({
  page,
}) => {
  await open(page);
  await page.evaluate((KEY) => {
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    saved.study.trophies.counters.longReturn = 1;
    localStorage.setItem(KEY, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  await page
    .getByRole("button", { name: /^Reading & Writing Read closely/ })
    .click();
  await page.getByLabel("Number of questions").fill("1");
  await page
    .getByRole("button", { name: "Begin practice →", exact: true })
    .click();
  await page.locator(".choice").first().click();
  await page
    .getByRole("button", { name: "Submit Answer", exact: true })
    .click();
  await expect(page.locator(".trophy-toast")).toContainText("First Question");
  await page.getByRole("button", { name: "Dismiss achievement" }).click();
  await expect(page.locator(".trophy-toast")).toContainText("The Long Return");
  await expect(page.locator(".trophy-toast")).toContainText("+100 XP");
  await page.screenshot({animations: "disabled", path: "work/achievement-visuals/secret-unlock.png" });
  const saved = await page.evaluate(
    (KEY) => JSON.parse(localStorage.getItem(KEY)!),
    KEY,
  );
  expect(saved.study.trophies.awardedXp["secret-return"]).toBe(100);
  await page.reload();
  const after = await page.evaluate(
    (KEY) => JSON.parse(localStorage.getItem(KEY)!),
    KEY,
  );
  expect(after.study.xp).toBe(saved.study.xp);
  expect(after.study.achievements).toEqual(saved.study.achievements);
});
test("reduced motion preserves information and disables movement", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, true);
  await page.getByLabel("Prestige").selectOption("Platinum");
  await page.locator(".trophy-card").click();
  await expect(page.getByRole("dialog")).toContainText("SAT Practice Platinum");
  const motion = await page
    .getByRole("dialog")
    .evaluate((e) => getComputedStyle(e).animationDuration);
  expect(parseFloat(motion)).toBeLessThan(0.02);
});

