import { test, expect } from "@playwright/test";

const STATE = "sat-practice-browser-preview-v1";
const HISTORY = "sat-practice-duel-history-preview-v1";

test("Local 1v1 keeps answers isolated, scores synchronously, and persists only duel history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Local 1v1/ }).waitFor();
  const before = await page.evaluate((key) => localStorage.getItem(key), STATE);
  await page.getByRole("button", { name: /^Local 1v1/ }).click();
  await page.getByLabel("1v1 questions").selectOption("5");
  await page.getByLabel("1v1 timer").selectOption("0");
  await page.getByLabel("Player 1 name").fill("Nicol\u00e1s");
  await page.getByLabel("Player 2 name").fill("Agust\u00edn");
  await page.getByRole("button", { name: "Start Local 1v1" }).click();
  await expect(page.locator(".duel-scoreboard")).toContainText("NICOL\u00c1S  0 — 0  AGUST\u00cdN");
  await expect(page.getByRole("region", { name: "Shared question" })).toHaveCount(1);
  const p1 = page.getByRole("region", { name: "Nicol\u00e1s" });
  const p2 = page.getByRole("region", { name: "Agust\u00edn" });
  await page.keyboard.press("a");
  await expect(p1.getByText("Answer selected")).toBeVisible();
  await expect(p2.getByText("Choose an answer")).toBeVisible();
  await page.keyboard.press("j");
  await expect(p2.getByText("Answer selected")).toBeVisible();
  for (let index = 0; index < 5; index++) {
    if (index) { await page.keyboard.press("a"); await page.keyboard.press("j"); }
    await p1.getByRole("button", { name: "Lock in" }).click();
    await expect(p2.getByText("Answer selected")).toBeVisible();
    await p2.getByRole("button", { name: "Lock in" }).click();
    await expect(page.getByText(/Correct answer:/)).toBeVisible();
    await page.getByRole("button", { name: index === 4 ? "Finish match" : "Next question" }).click();
  }
  await expect(page.getByText("FINAL SCORE")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), STATE)).toBe(before);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).matches.length, HISTORY)).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: /^Local 1v1/ }).click();
  await expect(page.getByRole("heading", { name: "Match history" })).toBeVisible();
  await expect(page.locator(".duel-history li")).toHaveCount(1);
  await expect(page.locator(".duel-history li")).toContainText("Nicol\u00e1s");
});
