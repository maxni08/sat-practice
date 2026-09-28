import { test, expect } from "@playwright/test";

test("library entry and Escape dismiss only the top layer", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button", {name:/Question Library & Sources/}).click();
  await expect(page.getByRole("heading", {name:"Question Sources"})).toBeVisible();
  await expect(page.getByText("Built-in SAT Bank").first()).toBeVisible();
  await page.getByRole("button", {name:"← Home"}).click();
  await page.getByRole("button", {name:"About & storage"}).click();
  await expect(page.locator("dialog.modal")).toBeVisible();
  await expect(page.getByRole("heading", {name:"About SAT Practice"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.modal")).toHaveCount(0);
  await expect(page.getByRole("heading", {name:"Make every question count."})).toBeVisible();
});

test("returning home from a library question clears its Finder selection", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button", {name:/Question Library & Sources/}).click();
  await page.getByRole("button", {name:/ac472881/}).first().click();
  await page.getByRole("button", {name:"Practice this question"}).click();
  await page.getByRole("button", {name:"Save and return home"}).click();
  await page.getByRole("button", {name:/Question Finder & Study Tools/}).click();
  await expect(page.getByLabel("Find question")).toBeVisible();
});
