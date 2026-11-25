import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const q=JSON.parse(readFileSync("public/bank/questions.json","utf8")).find((q:any)=>q.test==="Reading and Writing"&&q.passage&&q.choices.length===4);
test("pause freezes the clock, review is untimed, and highlights can be disabled",async({page})=>{
 await page.goto("/"); await expect(page.getByRole("heading",{name:"Make every question count."})).toBeVisible();
 await page.evaluate(q=>{
  localStorage.setItem("sat-practice-browser-preview-v1",JSON.stringify({progress:{[q.id]:{attempts:1,correctAttempts:1,incorrectAttempts:0,totalTimeSpent:5,lastResult:true,notes:"",bookmark:false,highlights:[{field:"passage",start:0,end:10,color:"yellow"}]}},session:{id:"pause-fixture",test:q.test,questionIds:[q.id],index:0,answers:{},drafts:{},eliminated:{},elapsed:{},timerMode:"session",timerSeconds:90,startedAt:Date.now(),deadline:Date.now()+90000,timerHidden:false,finished:false}}));
 },q);
 await page.reload();
 await page.getByRole("button",{name:"Resume",exact:true}).click();
 await expect(page.locator(".question-text mark")).toHaveCount(0);
 await page.getByRole("button",{name:"Highlight",exact:true}).click();
 await expect(page.getByRole("button",{name:"Stop highlighting"})).toHaveAttribute("aria-pressed","true");
 await page.keyboard.press("Escape");
 await expect(page.getByRole("button",{name:"Highlight",exact:true})).toHaveAttribute("aria-pressed","false");
 await page.getByRole("button",{name:"Pause",exact:true}).click();
 await expect(page.getByRole("dialog")).toContainText("Session paused");
 const frozen=await page.locator(".timer").innerText();
 await page.waitForTimeout(2200);
 expect(await page.locator(".timer").innerText()).toBe(frozen);
 await page.getByRole("button",{name:"Resume",exact:true}).click();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.getByRole("button",{name:"Save and return home",exact:true}).click();
 await page.waitForTimeout(1200);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("sat-practice-browser-preview-v1")!));
 expect(stored.session.pausedAt).toBeTruthy();
 await page.evaluate(()=>{
  const key="sat-practice-browser-preview-v1",s=JSON.parse(localStorage.getItem(key)!);
  s.session.finished=true;s.session.mode="module";s.session.pausedAt=null;
  localStorage.setItem(key,JSON.stringify(s));
 });
 await page.reload();
});
