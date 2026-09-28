# Full SAT Mock and Challenge Ladder (1.2.0)

The mock reuses the existing four official-length modules: Reading & Writing
27 questions / 32 minutes twice, then Math 22 questions / 35 minutes twice.
Existing Module 2 routing (70% threshold) and balanced domain/skill/type generation
are unchanged. This is a practice approximation, not College Board's proprietary
routing. The optional two-minute break between subjects is shortened for practice.
Each completed module is saved in Module History. The final combined result and
interrupted mock are saved in the existing resumable session. Starting another
session replaces that resumable summary; individual module history remains.

## Estimated SAT Score

`src/study/scoreEstimate.ts` is a replaceable, deterministic orientation estimator.
It uses seven raw-score/range anchors per subject from the official
[paper Practice Test 8 conversion](https://satsuite.collegeboard.org/media/pdf/scoring-sat-practice-test-8-digital.pdf).
Our 54/44 section accuracy is percentage-mapped to that paper's 66/54 counts,
linearly interpolated, widened by 60 points on each side, rounded to tens and
clamped to 200–800. The total sums the two ranges and midpoints.

This generated bank has not been equated or calibrated to that paper. The added
60-point allowance is a transparent heuristic, not an empirically measured error
bound. Neither the range nor midpoint is a validated prediction or confidence
interval. Actual digital scoring uses
[question characteristics and IRT](https://satsuite.collegeboard.org/scores/what-scores-mean/how-scores-calculated).
No routing bonus, official-score claim, or fake psychometric precision is applied.
Use Bluebook practice tests for a more reliable score indication.

## Challenge Ladder

`src/study/ladder.ts` centralizes 14 stable levels, alternating subjects in seven
tiers. Counts grow from 12 to 22/27; accuracy grows from 75% to 95%; the difficulty
mix moves from Easy/Medium to Medium/Hard. Later levels require specified Hard
correct counts, every question answered, and approximately SAT-paced completion.
All objectives are displayed before starting. The existing deferred-feedback
module renderer/timer/grader is reused; these short challenges do not count as
full Practice Modules or award module-completion XP.

Selection excludes all IDs from the last three completed ladder attempts,
penalizes questions practiced within a day, balances skill repetition, and
favors weaker skills. A new seed produces a fresh set for each retry. If the bank
cannot meet the fresh-set constraints, generation fails explicitly. Passing
unlocks only the next level. Failed attempts remain replayable. Best time is the
fastest completed attempt (including failures), separately labeled from best
accuracy. Completion date is the first successful date and is never overwritten.

The optional `StudyState.ladder` field uses the existing transactionally persisted
SQLite profile JSON. Existing profiles need no destructive schema migration;
absence means level 1 unlocked and no attempts. XP, mastery keys, achievements,
unlock dates and progress records are preserved. Mock metadata lives in the
existing session JSON. Presentation reuses the current motion/reduced-motion CSS.
