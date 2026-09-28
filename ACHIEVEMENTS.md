# Achievement rules — catalog 2 / application 1.2.0

The collection contains **64 core achievements including Platinum, plus 10 optional secrets**. All 24 original IDs, requirements, existing unlocks and dates are retained. Definitions live in `src/achievements/catalog.ts`; deterministic evaluation and event recording live in `engine.ts`. React only presents the resulting state.

Platinum requires the other 63 core unlocks, never itself or a secret. It is a comprehensive practice challenge, not an official SAT score. The tiers are Bronze, Silver, Gold, Diamond, and Platinum; only the final core achievement has Platinum rarity. The twelve categories cover accuracy, distinct correct questions, Hard difficulty, mastery, recovery, adaptive practice, modules, sections, timing, consistency, exploration, and levels.

Related intermediate milestones are displayed inside a badge's detail view rather than creating dozens of near-duplicate trophies: 25/50 modules, 25/50/75/100% bank exploration, full-section completion/90/95%, and 90%/80% timer use. Supplemental detail milestones track recommendation-led recovery, seven study days and repeated Hard-question recovery. The main requirement controls the unlock; supplemental milestones do not secretly add requirements. Module consistency explicitly requires all three stated milestones.

## Migration, XP and permanence

The existing SQLite schema 2 remains intact. Its extensible `study_profile.profile_json` gains a versioned `trophies` ledger in the same atomic `commit_study` transaction as the existing achievement table. No immutable question or legacy progress row is rewritten by catalog migration. Existing schema-1 installations still use the already-tested additive schema-2 migration first.

**Catalog backfill never adds XP or changes the existing level.** It acknowledges only what saved evidence proves. Saved module dates establish specific module milestone dates; otherwise the upgrade time is used and the unlock is labeled “Historical backfill.” Aggregate attempts cannot prove past streaks, exact review intervals, or old Weak→Mastered transitions, so those are not invented. The stored unlock permanently consumes reward eligibility even if backfilled without a bonus.

New live unlocks award deterministic bonus XP once: Bronze 10, Silver 25, Gold 50, Diamond 100, Platinum 200. Legacy achievements continue awarding no achievement bonus, preserving their original behavior. The unlock map and `awardedXp` ledger prevent repeat payments across refreshes, retries and restarts. Base answer/correction/session/mastery XP is unchanged. The existing curve remains `25 × (level − 1) × level` total XP at a level boundary.

## Evidence and validity

* Question counts and exploration use distinct bank IDs, including exactly 3,770 for full exploration. Repeated attempts cannot inflate those counts.
* Streaks retain distinct IDs. Incorrect answers break runs. A repeated question can contribute eligible evidence only at least six hours after its latest attempt. Non-Hard eligible answers break a Hard-only run.
* Recovery requires the six-hour learning interval. Due-review achievements additionally require that the saved review schedule is due; immediate corrections cannot advance these accomplishments. First-review achievements require observed history since this ledger began, avoiding assumptions about earlier reviews.
* Weak transitions require a real mastery-engine state, at least six practiced questions and three distinct mistakes. The ledger records the weak state, recommendation candidate, lowest-ranked meaningful skill, and subsequent Strong/Mastered transition dates. Whole-domain/subject/bank mastery uses the mastery engine, not lifetime accuracy.
* New qualifying custom/adaptive sessions need at least ten questions, every question answered, at least 50% correct, and at least 60% first-time answer credits. Individual achievements can require 15, 20 or 25 questions and stricter accuracy. Session IDs prevent double counting. Legacy perfect-session semantics remain unchanged.
* Valid modules preserve the original 80%-answered and 50%-new-to-module-history rules. New trophy evaluation also checks the official count, unique questions and completed state. Full sections require linked sequential modules of the same subject and section ID without overlapping question IDs.
* Time trophies require all questions answered, at least 90% accuracy, at least ten active seconds per question on average, active time consistent with wall time (70% or more), and a finish within the configured limit. They do not reward idle waiting or instant answer entry. Final-question timing uses persisted draft timestamps. Calendar achievements use the profile's recorded time zone.

The local database is not a competitive anti-cheat service. These rules discourage ordinary replay farming; someone deliberately editing their own files can falsify data. No account, telemetry or remote enforcement is introduced.

## Presentation

Original SVG geometry composes twelve principal motifs and distinct crown/shield/gem compositions. Locked secrets expose only a neutral silhouette, “???”, and “Secret Achievement”; their real category, tier, rule and progress are omitted from card and detail markup until earned. Secret discovery and core completion remain separate. Earned Platinum is permanently shown beside the level summary.

Motion uses CSS only: brief page/panel entry, answer and button feedback, XP bar/value updates, mastery/recommendation/result entry, and compact queued achievement notices. Badge animations last 1.2 seconds (Platinum 1.4), while solving remains available. Reduced motion removes transforms and stroke drawing and preserves accessible text.

## Developer-only secret catalog

The normal UI never shows these requirements while locked. Automated fixtures, not real study progress, test secrets and Platinum.

| Name | Evidence rule |
| --- | --- |
| The Long Return | Three legitimate misses followed by three spaced, due successful reviews of that question. |
| Down to the Wire | A valid strong fully answered module finishes with at most 30 seconds left. |
| A Different Ending | A qualifying 25+ set with five fresh Hard successes: two opening-five misses, perfect final ten, at least 90% overall. |
| From the Ground Up | The recorded lowest-ranked meaningful Weak skill reaches Mastered. |
| Two Perfect Halves | Perfect valid modules in both subjects on the same recorded calendar day. |
| A Complete Day | Full valid sections in both subjects on one day, each at least 90%. |
| First Principles | At least 15 first-attempt Hard successes in a qualifying 20+ set at 95% accuracy. |
| Reconstruction | Three recorded evidence-backed Weak skills reach Strong or Mastered. |
| Steady to the Finish | Valid fully answered 90% module with meaningful final-quarter effort and no extreme time spike. |
| Last Five | At least three correct final-five drafts entered in the final tenth of a valid, fully answered 90% module. |

Tests cover catalog consistency, preserved legacy state/XP/dates, deterministic backfill, repeat-payment prevention, distinct evidence, recovery, mastery, modules, sections, timing, adaptive practice, hidden/revealed secrets, Platinum and SQLite reopen. Browser tests use separate preview storage and controlled fixtures.

## Source taxonomy feasibility

The source bank has two capitalization variants of Cross-Text Connections (59 and 2 questions). The mastery engine pools their evidence case-insensitively while preserving both original stored keys. Mastery/improvement XP checks all aliases so one skill cannot pay twice. One Math skill has only three Medium questions: its requirement is three, while skills with four or more still require four. The 12-distinct and three-Hard thresholds remain unchanged. An actual-bank regression proves that every tracked skill can reach Mastered with successful varied evidence. Existing earned XP and unlock dates are never recalculated or removed.

