# SAT Practice 1.1 study rules

The original bank, importer, source-rendering assets and calculator remain unchanged. Study rules live in `src/study`; constants and module blueprints live in `src/study/config.ts`. Rules are deterministic for a given bank, progress, time and random seed. These are learning heuristics, not official SAT scoring or a validated prediction of a 1600.

## XP and levels

First eligible correct answers earn Easy 8, Medium 15, Hard 25 XP. Incorrect answers earn zero. Each individual question can earn its base reward only once. A previously missed question can earn one additional 20 XP correction bonus; the correct attempt must follow the last attempt by at least six hours. Looking at an explanation and immediately repeating that question earns no XP. A first-credit answer in an established weak skill (at least three distinct questions, score below 45) adds 5 XP.

A skill earns a one-time 25 XP improvement award when it crosses 70 from below with sufficient evidence, and a one-time 60 XP mastery award. Completing a custom/adaptive session earns 20 XP when all questions are answered, there are at least ten questions, and at least 60% of its answers earned first-question credit. A module earns 60 completion XP when at least 80% is answered and at least half its questions have never appeared in previous module history. At least 90% accuracy adds 40 XP. Every completed module remains in history even if it earns no completion reward. Repeated modules and empty submissions cannot supply unlimited XP.

Level L starts at `25 × (L−1) × L` cumulative XP. Level 1 starts at zero; the next level costs `50 × L` additional XP. The interface shows total XP, level, XP still needed and a progress bar. Achievements have no additional XP multiplier. Question reset retains award-credit records and unlocked achievements, preventing reset/replay farming.

The 24 achievements cover distinct correct and Hard questions, delayed corrections, meaningful complete/perfect modules, perfect sessions of at least 5/10/25 questions, skill mastery and level milestones. Locked achievements show their measurable progress; unlocked ones retain their unlock date. Notifications are small, dismissible and disappear after six seconds.

On first upgrade only, existing correct questions receive their one-time base XP. Existing aggregate progress can establish count achievements, but past individual attempt times, module completions and correction bonuses are never invented.

## Skill mastery

Skills are derived from the imported metadata and separated by subject. Each has a persisted score and evidence state. A high score from very few questions does not imply mastery.

Difficulty weights are Easy 1, Medium 1.5, Hard 2. Historical accuracy uses up to five effective attempts per distinct question, weighted by difficulty; each question's historical correct fraction is retained. Recent accuracy uses the latest outcome on the 20 most recently practiced distinct questions, weighted by difficulty and `max(0.25, exp(−ageDays/60))`. Both estimates have a 1.5-correct/3-attempt prior to avoid overconfidence from tiny samples.

The rounded score is clamped to 0–100:

`100 × (0.65 × recent estimate + 0.35 × historical estimate)`

- Add 2 per recently corrected question, capped at 6, using recorded wrong-then-correct evidence.
- Subtract 2 per question whose two latest recorded attempts were both wrong, capped at 10.
- With eight distinct recent questions, compare the latest four with the previous four: the percentage-point trend divided by 25 adds/subtracts at most 4.
- After 14 days away from a skill, subtract 0.25 per additional day, capped at 15.
- With at least five recent questions, successful responses taking more than twice the nominal per-question time incur a small proportional penalty capped at 3. There is no bonus for rushing. Time is advisory, not a requirement to answer quickly.

States: **Mastered** requires score ≥85, at least 12 distinct questions, at least 3 Hard and 4 Medium questions ever correct, at least 85% recent accuracy and practice within 14 days. **Strong** requires score ≥70 and at least 6 distinct questions. **Developing** requires score ≥45 and at least 3. Otherwise **Weak**. Unpracticed skills begin at zero with no evidence. Mastery recalculates on answers and on a later-day app launch; eight latest attempt records per question support corrections and repeat-mistake evidence. Progress shows improving/declining trends and the strongest/weakest sampled skills.

## Adaptive practice and spaced review

The default adaptive mix is 60% weak material, 25% developing and 15% retention, using largest-remainder rounding and reallocating when a bucket lacks candidates. Selection buckets use scores below 45, 45–74 and 75+, while displayed mastery states also require enough evidence. Ranking favors due reviews, repeated mistakes, lower mastery, skills not practiced recently and the current difficulty target, while spreading questions across skills. Exact question repeats within 24 hours are excluded when enough alternatives exist, except scheduled due reviews. If a narrow pool runs out, oldest available questions are used. A session never includes duplicate question IDs.

The initial subject difficulty is Medium unless saved adaptive state exists, or at least five observed Easy/Medium questions justify a lower/higher starting target. Easy accuracy below 55% starts Easy; Medium accuracy at least 80% permits Hard unless established Hard accuracy is below 55%. Three consecutive correct answers raise difficulty one step. Three wrong answers among the latest four lower it one step. A single error never lowers difficulty. Changing difficulty replaces only future unseen, undrafted questions and preserves their skills. It never changes the question currently being solved or an already visited question.

A first miss is due after one day. Repeated misses return after six hours. A correct response when due advances intervals to 3, 7, 14, 30 and 60 days; a premature repeat cannot advance its schedule. A new miss resets the correction streak. Previously missed legacy questions begin due one day after the last recorded attempt. Review is integrated into recommendations and adaptive selection, with a direct due-review session available; it is not an immediate repetition loop.

Home and Progress recommend overdue mistakes first and the weakest sampled skill next, with buttons that create the session immediately. With no evidence, a varied 12-question adaptive session establishes a starting point.

## Module blueprint and full sections

Official timing/count sources checked September 8, 2026: College Board's [SAT structure](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure), [Math alignment](https://satsuite.collegeboard.org/k12-educators/about/alignment/math) and [Reading and Writing alignment](https://satsuite.collegeboard.org/k12-educators/about/alignment/reading).

| Subject | Questions/module | Minutes/module | Domain weights |
|---|---:|---:|---|
| Reading & Writing | 27 | 32 | Information and Ideas 26%; Craft and Structure 28%; Expression of Ideas 20%; Standard English Conventions 26% |
| Math | 22 | 35 | Algebra 35%; Advanced Math 35%; Problem-Solving and Data Analysis 15%; Geometry and Trigonometry 15% |

Integer domain and difficulty quotas use largest remainders. Math normally contains 8 Algebra, 8 Advanced Math, 3 Problem-Solving/Data Analysis and 3 Geometry/Trigonometry questions. Reading & Writing contains 7, 8, 5 and 7 in the domain order above. Skill diversity limits concentration within a domain; question type is also considered. Math uses five numeric responses and seventeen multiple-choice questions. Repeated module exposure within 30 days and recent custom-practice exposure incur selection penalties; new questions are preferred. Numeric-quota adjustments preserve domain/difficulty counts. Module 2 excludes all Module 1 IDs.

**Practice approximations:** the five-numeric quota, Easy/Medium/Hard mixtures, per-module domain rounding and 70% routing threshold are this application's choices. Balanced modules target 30/40/30% Easy/Medium/Hard; easier Module 2 targets 45/40/15%; harder Module 2 targets 15/40/45%. At least 70% raw Module 1 accuracy routes to the harder mix, otherwise easier. College Board's proprietary routing, equating and undisclosed pretest items are not reproduced. Every question here counts toward the raw result; no official scaled score is produced.

Modules save editable drafts without grading individual answers. Correctness and explanations appear only after explicit completion or timer expiry. A fixed deadline continues while hidden, on Home, or while the application is closed. Expired interrupted modules finish on reopen. Invalid/blank numeric drafts count as unanswered; after completion, even unanswered questions have a read-only correct answer and rationale. Time per question records active practice and may sum to less than the wall-clock deadline when away from the solving screen.

Full sections run Module 1 → untimed transition → Module 2 → combined 44-question Math or 54-question Reading & Writing results. Each module also has its own immutable history entry. History stores question IDs, final responses, correctness, elapsed time, domain/skill/difficulty breakdowns and completion-time review flags. Review opens every question and its original explanation without awarding a new attempt.

## Safe storage upgrade

The stable baseline is Git tag `stable-1.0.0`, commit `029fd62`. All study data uses the same writable Tauri app-data database: `%APPDATA%\com.local.satpractice\progress.sqlite3`. The separate immutable 3,770-question bank is never altered by a migration or practice attempt.

Schema version 2 is additive. Before upgrading version 1, SQLite creates a consistent `progress-before-v2.sqlite3` backup if absent. The migration adds profile/XP/derived level, achievement, skill, evidence, review, module-history, module-answer and commit-ledger tables. Legacy question progress and the active session remain intact. Each answer/module commit writes its legacy updates, XP, evidence, schedules, achievements, history and session together in one transaction. Revision checks reject stale writes; unique event IDs prevent duplicate rewards after retries. Newer unsupported database versions are rejected instead of silently downgraded. Original data is also backed up in `work/stable-1.0.0` before development.

Question reset clears that question's legacy progress, notes, highlights, evidence and review schedule. Award credits, XP, achievements and completed module history remain as a record of earlier study; resetting cannot regenerate rewards. SQLite and the immutable bank remain separate. Close the application before copying backups; for a live database use SQLite's backup API.

### Catalog 2 feasibility correction

Capitalization aliases share mastery evidence but retain their persisted keys and cannot duplicate mastery XP. Medium-evidence requirements are capped at the available count (at least one required); the source's statistical-claims skill has only three Medium questions. Twelve distinct questions and three Hard successes are still required. See ACHIEVEMENTS.md for the actual-bank feasibility regression.

