import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Question } from '../types';
import { answerMatches, parseNumericAnswer } from './answers';

const bank = JSON.parse(readFileSync(resolve('public/bank/questions.json'), 'utf8')) as Question[];
const manifest = JSON.parse(readFileSync(resolve('public/bank/manifest.json'), 'utf8')) as {
  totalQuestions: number;
  quarantined: number;
  sources: { questionStarts: number; imported: number }[];
};

describe('complete imported question bank', () => {
  it('accounts for every detected source question without silent omissions', () => {
    expect(bank.length).toBeGreaterThan(3000);
    expect(bank.length).toBe(manifest.totalQuestions);
    expect(bank.length).toBe(manifest.sources.reduce((total, source) => total + source.imported, 0));
    expect(bank.length + manifest.quarantined).toBe(manifest.sources.reduce((total, source) => total + source.questionStarts, 0));
    expect(new Set(bank.map(question => question.id)).size).toBe(bank.length);
  });

  it('has complete metadata, question content, grading keys and explanations', () => {
    for (const question of bank) {
      const identity = `Question ${question.questionId}`;
      expect(question.questionId, identity).toBeTruthy();
      expect(['Math', 'Reading and Writing'], identity).toContain(question.test);
      expect(['Easy', 'Medium', 'Hard'], identity).toContain(question.difficulty);
      expect(question.domain.trim(), identity).not.toBe('');
      expect(question.skill.trim(), identity).not.toBe('');
      expect(question.stem.trim().length > 0 || question.assets.length > 0, `${identity}: missing stem`).toBe(true);
      expect(question.rationale.trim().length > 0 || question.rationaleAssets.length > 0, `${identity}: missing explanation`).toBe(true);
      expect(question.sourcePages.length, identity).toBeGreaterThan(0);
      expect(question.acceptedAnswers.length, identity).toBeGreaterThan(0);
      if (question.questionType === 'multiple-choice') {
        expect(question.choices.map(choice => choice.label), identity).toEqual(['A', 'B', 'C', 'D']);
        expect(question.choices.every(choice => choice.text.trim() || choice.assets?.length), `${identity}: empty choice`).toBe(true);
        expect(answerMatches(question, question.correctAnswer), `${identity}: invalid correct label`).toBe(true);
      } else {
        expect(question.choices, identity).toEqual([]);
        for (const accepted of question.acceptedAnswers) {
          expect(parseNumericAnswer(accepted), `${identity}: unsupported numeric key ${accepted}`).not.toBeNull();
          expect(answerMatches(question, accepted), `${identity}: rejects own key ${accepted}`).toBe(true);
        }
      }
    }
  });

  it('keeps all referenced visual assets inside the bundled bank and present on disk', () => {
    const publicDirectory = resolve('public');
    const visited = new Set<string>();
    for (const question of bank) {
      const assets = [
        ...question.assets, ...question.rationaleAssets, ...(question.passageAssets ?? []),
        ...(question.sourceAssets ?? []), ...question.choices.flatMap(choice => choice.assets ?? []),
      ];
      if (question.test === 'Math') expect(question.assets.length, `Math ${question.id} needs faithful source render`).toBeGreaterThan(0);
      for (const asset of assets) {
        if (visited.has(asset)) continue;
        visited.add(asset);
        expect(asset.startsWith('/bank/assets/'), asset).toBe(true);
        const path = resolve(publicDirectory, asset.replace(/^\//, ''));
        expect(path.startsWith(publicDirectory + sep), asset).toBe(true);
        expect(existsSync(path), `Missing visual asset: ${asset}`).toBe(true);
      }
    }
    expect(visited.size).toBeGreaterThan(bank.length);
  });
});
