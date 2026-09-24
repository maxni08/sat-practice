import { useState } from "react";
import type { Question, ProgressMap, Session } from "../types";
import type { StudyState } from "../study/types";
import {
  CAMPAIGN,
  ASCENSION,
  STAGES,
  campaignComplete,
  stageLock,
  starsEarned,
} from "./campaign";
import { calculateRank, rankMetrics, RANKS } from "./rank";
import { dayKey, weekKey, streak, RECORD_LABELS } from "./engine";
import { ACHIEVEMENTS } from "../achievements/catalog";
import { formatPlaytime, type PlaytimeState } from "../playtime/playtime";
import "./progression.css";
const percent = (n: number) => `${Math.round(n * 100)}%`;
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
export function ProgressionSummary({
  study,
  questions,
  progress,
  playtime,
  onOpen,
}: {
  study: StudyState;
  questions: Question[];
  progress: ProgressMap;
  playtime?: PlaytimeState | null;
  onOpen?: () => void;
}) {
  const p = study.progression;
  if (!p) return null;
  const rank = calculateRank(
    rankMetrics(questions, progress, study),
    p.rank.highest,
  );
  const next = CAMPAIGN.find((s) => !p.stages[s.id]?.stars && !stageLock(s, p));
  const core = ACHIEVEMENTS.filter((a) => !a.secret).filter(
    (a) => study.achievements[a.id],
  ).length;
  return (
    <section className="progression-summary" aria-label="Player status">
      <div>
        <span className="eyebrow">CURRENT SAT RANK</span>
        <h2>{RANKS[rank.current]}</h2>
        <p>
          {rank.next === null
            ? "Highest rank reached"
            : `${rank.percent}% toward ${RANKS[rank.next]}`}
        </p>
        <progress aria-label="Next SAT Rank" max={100} value={rank.percent} />
        <small>
          Highest reached{" "}
          {new Date(p.rank.history.at(-1)!.at).toLocaleDateString()} · Previous:{" "}
          {RANKS[p.rank.previous]}
        </small>
      </div>
      <div>
        <strong>{starsEarned(p)} / 288 Stars</strong>
        <p>Campaign: {next?.name ?? "Complete — Ascension available"}</p>
        <p>Platinum: {core} / 64 core achievements</p>
        {playtime && <p><strong>Total Playtime: {formatPlaytime(playtime.totalSeconds)}</strong></p>}
        <p>
          Next objective:{" "}
          {next
            ? `Clear ${next.name}`
            : "Continue Ascension or improve your stars."}
        </p>
        {onOpen && <button onClick={onOpen}>Open Campaign & Records</button>}
      </div>
      <details>
        <summary>Exact requirements for the next rank</summary>
        {rank.missing.length ? (
          <ul>
            {rank.missing.map((r) => (
              <li key={r.key}>
                {r.label}: {Math.round(r.value * 10) / 10} /{" "}
                {Math.round(r.target * 10) / 10}
              </li>
            ))}
          </ul>
        ) : (
          <p>All rank requirements met.</p>
        )}
        <p>
          Current form: {RANKS[rank.form]}. Your highest rank is permanent. XP
          level is separate.
        </p>
      </details>
    </section>
  );
}
const questNames = {
  questions: "distinct learning questions",
  hard: "distinct Hard questions correct",
  repairs: "due mistakes repaired",
  modules: "valid Practice Modules",
  improved: "Weak skills improved to Strong",
};
export function CampaignPanel({
  study,
  onStart,
  onBack,
}: {
  study: StudyState;
  onStart: (id: string) => void;
  onBack: () => void;
}) {
  const [region, setRegion] = useState(CAMPAIGN[0].region),
    p = study.progression;
  if (!p) return null;
  const now = Date.now(),
    day = dayKey(now, p.timeZone),
    week = weekKey(day),
    activity = streak(p, now);
  const stages =
    region === "ascension"
      ? ASCENSION
      : CAMPAIGN.filter((s) => s.region === region);
  return (
    <main className="page campaign-page">
      <button onClick={onBack}>← Home</button>
      <h1>SAT Campaign</h1>
      <p>{starsEarned(p)} / 288 stars · 96 stages · 8 domain bosses</p>
      <p>
        Fresh sets, your own best as a ghost, and feedback after finishing. Earn
        one star to pass, then pursue the advanced and elite objectives.
      </p>
      <label>
        Region{" "}
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          {CAMPAIGN.filter((s) => s.index === 1).map((s) => (
            <option key={s.region} value={s.region}>
              {s.test} · {s.domain}
            </option>
          ))}
          <option value="ascension">
            Ascension {campaignComplete(p) ? "— unlocked" : "— locked"}
          </option>
        </select>
      </label>
      <div className="campaign-grid">
        {stages.map((s) => {
          const done = p.stages[s.id],
            lock = stageLock(s, p);
          return (
            <article key={s.id} className={s.boss ? "campaign-boss" : ""}>
              <span className="eyebrow">
                {s.boss
                  ? "BOSS CHALLENGE"
                  : s.ascension
                    ? "ENDGAME"
                    : `STAGE ${s.index}`}
              </span>
              <h2>{s.name}</h2>
              <span
                className="stage-stars"
                aria-label={`${done?.stars ?? 0} of 3 stars`}
              >
                {"★".repeat(done?.stars ?? 0)}
                {"☆".repeat(3 - (done?.stars ?? 0))}
              </span>
              <p>
                {s.count} questions · {time(s.seconds)} · {s.mix.Easy} Easy /{" "}
                {s.mix.Medium} Medium / {s.mix.Hard} Hard
              </p>
              <p>
                ★ {percent(s.accuracy)} accuracy
                {s.mix.Hard > 0
                  ? `, ${Math.ceil(s.mix.Hard * 0.65)} Hard correct`
                  : ""}{" "}
                within the time limit.
              </p>
              <details>
                <summary>Advanced & elite objectives</summary>
                <p>
                  ★★ {percent(Math.min(0.96, s.accuracy + 0.08))}, every
                  question answered, {Math.ceil(s.mix.Hard * 0.85)} Hard
                  correct, within {time(s.seconds * 0.95)}.
                </p>
                <p>
                  ★★★ {s.index < 5 && !s.ascension ? "95%" : "100%"}, all Hard
                  correct, within {time(s.seconds * 0.9)}.
                </p>
                <p>
                  At least 80% of questions need 3 seconds of active work.
                  Review is available only after finishing.
                </p>
              </details>
              {done && (
                <p>
                  Best: {done.best.correct}/{done.best.total} ·{" "}
                  {time(done.best.seconds)} · {done.attempts} attempts
                  {done.completedAt
                    ? ` · Cleared ${new Date(done.completedAt).toLocaleDateString()}`
                    : ""}
                </p>
              )}
              {lock && <p className="muted">{lock}</p>}
              <button disabled={!!lock} onClick={() => onStart(s.id)}>
                {lock
                  ? "Locked"
                  : done
                    ? "Replay with fresh questions"
                    : "Start stage"}
              </button>
            </article>
          );
        })}
      </div>
      <section>
        <h2>Daily & Weekly Quests</h2>
        <p>
          Rewards apply once. Previously credited Easy questions do not advance
          daily question quests. Migration never grants quest XP.
        </p>
        <div className="quest-grid">
          {Object.values(p.quests)
            .filter((q) =>
              q.id.startsWith("day:") ? q.period === day : q.period === week,
            )
            .map((q) => (
              <article key={q.id}>
                <strong>
                  {q.id.startsWith("day:") ? "Daily" : "Weekly"} · {q.target}{" "}
                  {questNames[q.kind]}
                </strong>
                <p>
                  {q.progress}/{q.target} · {q.xp} XP{" "}
                  {q.paidAt ? "· Complete" : ""}
                </p>
                <progress max={q.target} value={q.progress} />
              </article>
            ))}
        </div>
      </section>
      <section>
        <h2>Study streak</h2>
        <p>
          {activity.current} days · Best {activity.longest} days
        </p>
        <p>
          Milestones:{" "}
          {activity.milestones
            .map((n) => `${activity.longest >= n ? "✓ " : ""}${n}`)
            .join(" · ")}
        </p>
        <p>
          A day needs 15 distinct learning questions, a valid module, or a
          completed session of 15+ with ≥50% accuracy and ≥60% first-credit
          answers.
        </p>
      </section>
      <section>
        <h2>Personal Records</h2>
        <dl className="record-grid">
          {Object.entries(RECORD_LABELS).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {p.records[key]
                  ? `${Math.round(p.records[key].value * 10) / 10} · ${new Date(p.records[key].at).toLocaleDateString()}`
                  : "Not established yet"}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
export function CampaignResults({ session }: { session: Session }) {
  if (!session.campaign && !session.ghost) return null;
  const rule = STAGES.find((s) => s.id === session.campaign?.stage),
    correct = Object.values(session.answers).filter((a) => a.correct).length;
  const seconds =
    (Date.parse(session.module?.completedAt ?? "") - session.startedAt) / 1000;
  return (
    <aside className="page campaign-result" role="status">
      {rule && (
        <>
          <h2>
            {rule.name}:{" "}
            {(session.campaign?.stars ?? 0) > 0 ? "Cleared" : "Keep practicing"}
          </h2>
          <p className="stage-stars">
            {"★".repeat(session.campaign?.stars ?? 0)}
            {"☆".repeat(3 - (session.campaign?.stars ?? 0))}
          </p>
          <p>
            Your permanent stars and best attempt are saved. Replay with a
            different set.
          </p>
        </>
      )}
      {session.ghost && (
        <p>
          Personal ghost — Previous: {session.ghost.correct}/
          {session.ghost.total}, {time(session.ghost.seconds)} · Current:{" "}
          {correct}/{session.questionIds.length}, {time(seconds)}
        </p>
      )}
    </aside>
  );
}
