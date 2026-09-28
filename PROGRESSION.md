# SAT Practice 1.3 progression rules

All progression lives in the existing atomic SQLite study-profile JSON, under `progression.version = 1`. Existing question records, evidence, XP, achievement IDs/dates and Challenge Ladder remain unchanged. Migration adds only proven history: dated evidence, valid modules and eligible sessions. Historical quest rewards are zero; existing XP/levels are retained. Backfilled record/rank dates are the migration date, not invented historical dates.

## SAT Rank
Twenty permanent ranks: Bronze, Silver, Gold, Platinum, Diamond and Elite (III, II, I), then Master and Grandmaster. `src/progression/rank.ts` is the centralized configuration. All gates must pass, sequentially. Progress is the mean of capped gate-completion fractions, not an estimated SAT score. Recent form may fall; earned rank never falls. The exact remaining gates are visible on Home and Progress.

Distinct evidence needs at least three recorded seconds. Accuracy uses each distinct question's latest recorded meaningful answer: last 100 overall/Medium-Hard, last 60 Hard. Unpracticed skills count as zero mastery; capitalization aliases are pooled without changing stored keys. Higher ranks require both subjects' mastery, valid official-sized modules, linked full sections (including mock sections), and campaign stars. Easy-only work cannot reach Bronze II. Grandmaster requires 2,600 distinct questions, 730 Medium/Hard, 180 Hard, 93% recent and Medium/Hard accuracy, 88% Hard accuracy, 85 mastery in each subject, 16 valid modules with 93% recent accuracy, six full sections with 92.3% recent accuracy, and 264 campaign stars. XP never determines rank.

## Campaign, bosses and ghosts
Eight domains × twelve stages = 96 stages including eight bosses, 288 permanent stars. The original fourteen Challenge Ladder levels remain available with their old progress. `campaign.ts` defines counts, timing, difficulty and star gates. Sets reuse the existing skill-balanced, weakness-aware ladder selector; last two regional sets are excluded, with further recent-question penalties. No immutable bank changes.

One star requires stage accuracy, at least 65% of Hard questions correct, and the time limit. Two require accuracy +8 percentage points (cap 96%), all answered, 85% of Hard correct, and 95% of the time limit. Three require 95% in introductory stages or perfection later, all Hard correct, and 90% of the time limit. At least 80% of responses need three seconds of work, and wall time must be at least three seconds per question. Later stages require bonus stars; each boss requires eighteen regional stars. Stars cannot be lost. Each attempt stores IDs, result, timing, date and its best ghost. Ghost feedback during testing shows only the previous result; current answers stay secret until completion. Campaigns never count as official-sized Practice Modules.

## Quests, streaks, records
Two daily and two weekly objectives are fixed when each local-calendar period starts. Daily: 15 distinct learning questions plus two due repairs if available, otherwise five Hard correct. Weekly: 100 distinct learning questions plus one proven Weak→Strong improvement when meaningful weak skills exist, otherwise two valid modules. XP rewards are 15/20/50/50, once per quest. Six-hour learning intervals, three-second work minimums, distinct IDs, and exclusion of previously credited Easy answers prevent trivial repeat farming. Historical current-period evidence is offset on migration. Timezone is fixed to the user's migration timezone; weeks start Monday.

A streak day requires 15 qualifying distinct questions, one valid module, or a fully answered 15+ session with ≥50% accuracy and ≥60% new-credit meaningful answers. Milestones: 3, 7, 14, 30, 60, 100 days. A streak remains active until the end of the next day. No freeze or login rewards.

Records use proven trophy streaks, valid modules, complete four-module mocks, daily distinct work, weekly distinct repairs and campaign clears/stars. Fastest accurate module requires ≥90%, all answered and meaningful recorded time. New records/ranks receive compact nonblocking notifications. Reduced motion disables movement.

## Ascension
All 96 stages must be cleared. Six sequential mixed-domain tiers alternate Math and Reading & Writing, using official module-sized counts/times. Hard share rises from 60% to 100%; accuracy rises 85%, 88%, 90%, 92%, 95%, 95%. Tier VI remains replayable. Difficulty is capped instead of becoming mathematically impossible. All 102 generated configurations are tested against the real bank.
