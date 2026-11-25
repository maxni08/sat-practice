import { describe,it,expect,vi } from "vitest";
import { focusSections,loadBluebook } from "./StudyPlan";
describe("single-section Bluebook results",()=>{
 it("does not treat an untested section as 200",()=>{
  expect(focusSections({rw:700,math:null})).toEqual(["Reading and Writing"]);
  expect(focusSections({rw:null,math:730})).toEqual(["Math"]);
 });
 it("preserves full historical scores and accepts partial records without inventing totals",()=>{
  vi.stubGlobal("localStorage",{getItem:()=>JSON.stringify([{date:"2026-11-20",test:"1",rw:700,math:null},{date:"2026-11-19",test:"2",rw:640,math:730}])});
  const rows=loadBluebook();expect(rows).toHaveLength(2);expect(rows[0].math).toBeNull();expect(rows[1].math).toBe(730);
  vi.unstubAllGlobals();
 });
});
