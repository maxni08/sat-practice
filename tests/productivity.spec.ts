import { test, expect } from "@playwright/test";

const STATE="sat-practice-browser-preview-v1";
test("Study/View isolation, persistent queue, line reader and image zoom",async({page})=>{
  await page.goto("/"); await page.getByRole("button",{name:/Question Finder & Study Tools/}).click();
  const before=await page.evaluate(key=>localStorage.getItem(key),STATE);
  await page.getByLabel("Find question").fill("f1bfbed3");
  await page.getByRole("button",{name:/f1bfbed3/}).click();
  await expect(page.getByText("STUDY / VIEW · NO PROGRESS RECORDED")).toBeVisible();
  await page.getByRole("button",{name:"Add to Study Queue"}).click();
  expect(await page.evaluate(key=>localStorage.getItem(key),STATE)).toBe(before);
  await page.reload(); await page.getByRole("button",{name:/Question Finder & Study Tools/}).click(); await page.getByRole("button",{name:/Queue \(1\)/}).click();
  await expect(page.getByText(/f1bfbed3/)).toBeVisible();
  await page.getByText(/f1bfbed3/).click(); await page.getByRole("button",{name:"Practice this question"}).click();
  await page.getByRole("button",{name:"Line Reader"}).click(); await expect(page.getByLabel("Line reader band")).toBeVisible();
  await page.getByLabel("Save and return home").click(); await page.getByRole("button",{name:/Question Finder & Study Tools/}).click();
  await page.getByLabel("Find question").fill("ac472881"); await page.getByRole("button",{name:/ac472881/}).click();
  await page.locator(".zoom-source").first().click(); await expect(page.getByRole("dialog",{name:/Enlarged/})).toBeVisible();
  await page.getByRole("button",{name:"Zoom in"}).click(); await page.getByRole("button",{name:"Close"}).click();
});
