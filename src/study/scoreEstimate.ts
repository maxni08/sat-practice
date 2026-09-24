import type { TestSection } from '../types';

// Paper practice test 8 anchors, percentage-mapped to the digital module counts.
// These are NOT an equating table for this question bank. See MOCK-AND-LADDER.md.
export const SCORE_ESTIMATOR = {
  version: 'paper-8-orientation-v1',
  uncertainty: 60,
  'Reading and Writing': [[0,200,200],[11,230,290],[22,340,380],[33,420,460],[44,520,580],[55,660,700],[66,800,800]],
  Math: [[0,200,200],[9,260,310],[18,370,410],[27,440,480],[36,530,590],[45,640,700],[54,800,800]],
} as const;
export function estimateSection(test: TestSection, correct: number, total: number) {
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total)
    throw new Error('A score estimate requires valid completed raw results.');
  const anchors = SCORE_ESTIMATOR[test];
  const raw = correct / total * anchors[anchors.length - 1][0];
  const i = Math.max(1, anchors.findIndex(a => a[0] >= raw));
  const a = anchors[i - 1], b = anchors[i];
  const t = (raw - a[0]) / (b[0] - a[0]);
  const clamp = (n: number) => Math.min(800, Math.max(200, Math.round(n / 10) * 10));
  const low = clamp(a[1] + t * (b[1] - a[1]) - SCORE_ESTIMATOR.uncertainty);
  const high = clamp(a[2] + t * (b[2] - a[2]) + SCORE_ESTIMATOR.uncertainty);
  return { low, high, midpoint: clamp((low + high) / 2) };
}
export function estimateSAT(readingCorrect: number, mathCorrect: number) {
  const reading = estimateSection('Reading and Writing', readingCorrect, 54);
  const math = estimateSection('Math', mathCorrect, 44);
  return { reading, math, total: { low: reading.low + math.low, high: reading.high + math.high, midpoint: reading.midpoint + math.midpoint } };
}
