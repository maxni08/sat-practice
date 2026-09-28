import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Question } from "../types";

export interface QuestionSource {
  id: string;
  name: string;
  sourceType: "pack" | "personal" | "structured" | "builtin" | "invalid";
  version: string;
  enabled: boolean;
  present: boolean;
  count: number;
  status: string;
  report: ImportReport | Record<string, never>;
}
export interface ImportReport {
  sourceId: string;
  valid: number;
  skipped: number;
  duplicates: number;
  invalid: number;
  missingAssets: number;
  unsupported: number;
  issues: string[];
}
export interface LibrarySnapshot { sources: QuestionSource[]; questions: Question[] }
const empty = (): LibrarySnapshot => ({ sources: [], questions: [] });

export const sourceId = (q: Question) => q.sourceId ?? "builtin";
export const sourceName = (q: Question) => q.sourceName ?? "Built-in SAT Bank";
export function mergeLibrary(builtin: Question[], snapshot: LibrarySnapshot): Question[] {
  const seen = new Set(builtin.map(q => q.id));
  return [...builtin, ...snapshot.questions.filter(q => !seen.has(q.id))];
}
export function listSources(builtin: Question[], snapshot: LibrarySnapshot): QuestionSource[] {
  return [{ id: "builtin", name: "Built-in SAT Bank", sourceType: "builtin", version: "1", enabled: true, present: true, count: builtin.length, status: "Ready", report: {} }, ...snapshot.sources];
}
export async function loadQuestionLibrary(): Promise<LibrarySnapshot> {
  return isTauri() ? invoke<LibrarySnapshot>("load_question_library") : empty();
}
export async function scanQuestionPacks(): Promise<boolean> {
  return isTauri() ? invoke<boolean>("scan_question_packs") : false;
}
export async function chooseAndImport(): Promise<ImportReport | null> {
  if (!isTauri()) throw Error("Question imports are available in the desktop application.");
  const path = await open({ multiple: false, directory: false, filters: [{ name: "SAT question data", extensions: ["satpack", "json", "csv"] }] });
  return path ? invoke<ImportReport>("import_question_file", { path }) : null;
}
export const setSourceEnabled = (sourceId: string, enabled: boolean) => invoke<void>("set_question_source", { sourceId, enabled });
export const removeSource = (sourceId: string) => invoke<void>("remove_question_source", { sourceId });
export const openPacksFolder = () => invoke<void>("open_question_packs_folder");
export const savePersonal = (question: Partial<Question>, priorId?: string) => invoke<Question>("save_personal_question", { question, priorId });
export const deactivatePersonal = (questionId: string) => invoke<void>("deactivate_personal_question", { questionId });
export const savePersonalImage = (dataUrl: string) => invoke<string>("save_personal_image", { dataUrl });
export const readQuestionAsset = (uri: string) => invoke<string>("read_question_asset", { uri });
