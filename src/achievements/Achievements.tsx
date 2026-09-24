import { useMemo, useState } from "react";
import type { ProgressMap, Question } from "../types";
import type { StudyState } from "../study/types";
import { Modal } from "../components/Modal";
import {
  ACHIEVEMENTS,
  CATEGORIES,
  CORE,
  visibleAchievement,
  type AchievementDefinition,
  type Rarity,
} from "./catalog";
import { achievementMetrics, completion } from "./engine";
import { Badge } from "./Badge";
import "./achievements.css";

const tiers: Rarity[] = ["Bronze", "Silver", "Gold", "Diamond", "Platinum"];
export function PlatinumMark({ study }: { study: StudyState }) {
  const at = study.achievements.platinum;
  return at ? (
    <span className="platinum-mark">
      <Badge art="platinum" rarity="Platinum" size={34} />
      <span>
        SAT Practice Platinum
        <small>Earned {new Date(at).toLocaleDateString()}</small>
      </span>
    </span>
  ) : null;
}
export function AchievementToast({
  id,
  onClose,
  additional = 0,
}: {
  id: string;
  onClose: () => void;
  additional?: number;
}) {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return null;
  return (
    <aside
      key={id}
      className={`achievement-toast trophy-toast tier-${a.rarity.toLowerCase()}`}
      role="status"
    >
      <Badge art={a.badge} rarity={a.rarity} size={66} />
      <div>
        <small>{a.rarity} · Achievement unlocked</small>
        <strong>{a.name}</strong>
        <p>{a.description}</p>
        {a.xpReward > 0 && <small>+{a.xpReward} XP</small>}
        {additional > 0 && <small> · {additional} more earned</small>}
      </div>
      <button onClick={onClose} aria-label="Dismiss achievement">
        ×
      </button>
    </aside>
  );
}
export function Achievements({
  study,
  questions,
  progress,
  onBack,
}: {
  study: StudyState;
  questions: Question[];
  progress: ProgressMap;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState("All"),
    [category, setCategory] = useState("All"),
    [tier, setTier] = useState("All"),
    [selected, setSelected] = useState<AchievementDefinition | null>(null);
  const stats = completion(study),
    metrics = useMemo(
      () => achievementMetrics(study, questions, progress, Date.now()),
      [study, questions, progress],
    );
  const visible = ACHIEVEMENTS.filter((a) => {
    const unlocked = !!study.achievements[a.id],
      hidden = a.secret && !unlocked;
    return (
      (filter === "All" ||
        (filter === "Secret" && a.secret) ||
        (filter === "Unlocked" && unlocked) ||
        (filter === "Locked" && !unlocked)) &&
      (category === "All" || (!hidden && a.category === category)) &&
      (tier === "All" || (!hidden && a.rarity === tier))
    );
  });
  const detail =
    selected && visibleAchievement(selected, !!study.achievements[selected.id]);
  const value = (a: AchievementDefinition) =>
    Math.min(
      a.goal,
      study.achievements[a.id] ? a.goal : (metrics[a.metric] ?? 0),
    );
  return (
    <main className="page trophy-page">
      <button className="text-button back" onClick={onBack}>
        ← Home
      </button>
      <h1>Achievements</h1>
      <p className="muted">
        A record of practice, understanding, and lessons learned.
      </p>
      <div className="trophy-summary">
        <section>
          <strong>
            {stats.core} / {stats.total}
          </strong>
          <span>Core achievements · {stats.percent}%</span>
        </section>
        <section>
          <strong>
            {stats.secrets} / {stats.secretTotal}
          </strong>
          <span>Secrets found</span>
        </section>
        <section>
          <strong>{stats.platinum}%</strong>
          <span>Platinum progress</span>
          <progress
            aria-label="Platinum progress"
            max={100}
            value={stats.platinum}
          />
        </section>
      </div>
      <PlatinumMark study={study} />
      <p className="muted">
        Platinum requires all {stats.total - 1} other core achievements. Secrets
        are optional discoveries.
      </p>
      <details className="category-completion">
        <summary>Completion by category</summary>
        <div>
          {CATEGORIES.map((c) => {
            const group = CORE.filter((a) => a.category === c);
            return (
              <button
                key={c}
                onClick={() => {
                  setCategory(c);
                  setFilter("All");
                  setTier("All");
                }}
              >
                {c}
                <span>
                  {group.filter((a) => study.achievements[a.id]).length} /{" "}
                  {group.length}
                </span>
              </button>
            );
          })}
        </div>
      </details>
      <div className="trophy-filters">
        <label>
          Show
          <select
            aria-label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["All", "Unlocked", "Locked", "Secret"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>All</option>
            {CATEGORIES.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Prestige
          <select
            aria-label="Prestige"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            <option>All</option>
            {tiers.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="trophy-grid">
        {visible.map((a) => {
          const at = study.achievements[a.id],
            hidden = a.secret && !at,
            v = visibleAchievement(a, !!at);
          return (
            <button
              key={a.id}
              className={`trophy-card ${at ? "earned" : ""}`}
              onClick={() => setSelected(a)}
            >
              <Badge
                art={v.badge}
                rarity={hidden ? undefined : a.rarity}
                locked={!at}
              />
              <span className="trophy-copy">
                <small>
                  {hidden
                    ? "Secret Achievement"
                    : `${a.rarity} · ${a.category}`}
                </small>
                <h2>{v.name}</h2>
                <span>{v.description}</span>
                <small>
                  {at
                    ? `Unlocked ${new Date(at).toLocaleDateString()}`
                    : hidden
                      ? "Undiscovered"
                      : `${value(a).toLocaleString()} / ${a.goal.toLocaleString()}`}
                </small>
                {!hidden && (
                  <progress
                    aria-label={`${a.name} progress`}
                    max={a.goal}
                    value={value(a)}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
      {!visible.length && <p>No achievements match these filters.</p>}
      {selected && detail && (
        <Modal title={detail.name} onClose={() => setSelected(null)}>
          <div className="trophy-detail">
            <Badge
              art={detail.badge}
              rarity={
                selected.secret && !study.achievements[selected.id]
                  ? undefined
                  : selected.rarity
              }
              size={136}
              locked={!study.achievements[selected.id]}
            />
            <h3>{detail.description}</h3>
            {(!selected.secret || study.achievements[selected.id]) && (
              <>
                <p>
                  {selected.rarity} · {selected.category}
                </p>
                <p>{selected.requirement}</p>
                <p>
                  {value(selected).toLocaleString()} /{" "}
                  {selected.goal.toLocaleString()}
                </p>
                {selected.stages && (
                  <ul>
                    {selected.stages.map((s) => (
                      <li key={s.metric}>
                        {s.label}: {Math.min(s.target, metrics[s.metric] ?? 0)}{" "}
                        / {s.target}
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  {study.achievements[selected.id]
                    ? `Earned ${new Date(study.achievements[selected.id]).toLocaleString()}`
                    : "Locked"}
                  {study.trophies?.backfilled[selected.id]
                    ? " · Historical backfill"
                    : ""}
                </p>
                {selected.xpReward > 0 && (
                  <p>{selected.xpReward} XP · awarded once</p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
