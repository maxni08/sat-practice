import type { SfxSettings as Settings } from "../lib/sfx";

export function SfxSettings({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (value: Settings) => void;
}) {
  return (
    <section className="sfx-settings" aria-labelledby="sound-settings-title">
      <h3 id="sound-settings-title">Sound effects</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) =>
            onChange({ ...value, enabled: event.currentTarget.checked })
          }
        />
        SFX {value.enabled ? "On" : "Off"}
      </label>
      <label className="field-label">
        <span>SFX volume: {value.volume}%</span>
        <input
          aria-label="SFX volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={value.volume}
          disabled={!value.enabled}
          onChange={(event) =>
            onChange({ ...value, volume: Number(event.currentTarget.value) })
          }
        />
      </label>
      <label className="field-label">
        <span>Sound mode</span>
        <select
          aria-label="Sound mode"
          value={value.mode}
          disabled={!value.enabled}
          onChange={(event) =>
            onChange({
              ...value,
              mode: event.currentTarget.value as Settings["mode"],
            })
          }
        >
          <option value="all">All feedback</option>
          <option value="important">Important events only</option>
        </select>
      </label>
      <p className="muted">
        Important events only keeps progression sounds and silences routine
        correct and incorrect feedback.
      </p>
    </section>
  );
}
