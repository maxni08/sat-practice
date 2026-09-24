import {
  formatPlaytime,
  PLAYTIME_MODES,
  playtimeStats,
  type PlaytimeState,
} from "./playtime";

export function PlaytimeSummary({
  playtime,
  currentSession,
}: {
  playtime: PlaytimeState;
  currentSession: number;
}) {
  const stats = playtimeStats(playtime, currentSession, Date.now());
  return (
    <section className="playtime-summary" aria-label="Active study playtime">
      <div className="playtime-heading">
        <div>
          <p className="eyebrow">ACTIVE STUDY TIME</p>
          <h2>Total Playtime: {formatPlaytime(stats.total)}</h2>
        </div>
        <p>
          Current Session <strong>{formatPlaytime(stats.current)}</strong>
        </p>
      </div>
      <div className="playtime-metrics">
        <p><strong>{formatPlaytime(stats.today)}</strong><span>Today</span></p>
        <p><strong>{formatPlaytime(stats.week)}</strong><span>This Week</span></p>
        <p><strong>{formatPlaytime(stats.averageDay)}</strong><span>Average active day</span></p>
        <p><strong>{formatPlaytime(stats.longestDay)}</strong><span>Longest study day</span></p>
      </div>
      <div className="playtime-breakdown">
        {PLAYTIME_MODES.filter((mode) => (playtime.byMode[mode] ?? 0) > 0).map(
          (mode) => (
            <p key={mode}>
              <span>{mode}</span>
              <strong>{formatPlaytime(playtime.byMode[mode] ?? 0)}</strong>
            </p>
          ),
        )}
      </div>
      <small className="muted">
        Accurate active tracking since {new Date(playtime.trackingSince).toLocaleDateString()}.
        {playtime.historicalSeconds > 0 &&
          " Earlier totals include only time proven by saved question history."}
      </small>
    </section>
  );
}
