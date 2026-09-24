import type { Rarity } from "./catalog";

// Original geometric artwork. The frame, motif, crown and cut facets compose a
// coherent collection without raster downloads or external icon dependencies.
export function Badge({
  art,
  rarity = "Bronze",
  size = 64,
  locked = false,
}: {
  art: string;
  rarity?: Rarity;
  size?: number;
  locked?: boolean;
}) {
  const base = art.split("-")[0],
    crown = art.includes("crown"),
    shield = art.includes("shield");
  return (
    <svg
      className={`trophy-badge tier-${rarity.toLowerCase()} ${locked ? "badge-locked" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="badge-frame"
        d={
          art === "platinum"
            ? "M40 3 67 16 77 40 65 66 40 77 15 66 3 40 13 16Z"
            : "M40 5 66 19 70 49 55 69 25 69 10 49 14 19Z"
        }
      />
      <path
        className="badge-inset"
        d="M40 11 61 23 64 47 51 62 29 62 16 47 19 23Z"
      />
      <g
        className="badge-lines"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.3"
      >
        {art === "secret" ? (
          <>
            <path
              d="M25 35V25l15-8 15 8v10l-15 23-15-23Z"
              fill="currentColor"
              opacity=".16"
            />
            <path d="M33 31a7 7 0 1 1 10 6c-3 2-3 4-3 7M40 50h.01" />
          </>
        ) : base === "target" ? (
          <>
            <circle cx="40" cy="39" r="17" />
            <circle cx="40" cy="39" r="9" />
            <path d="m40 39 16-17m-1-6v7h7" />
          </>
        ) : base === "bolt" ? (
          <>
            <path d="m43 18-18 25h13l-2 18 19-28H42l1-15Z" />
            <path d="m21 29-4 8m42 10 4-8" />
          </>
        ) : base === "neural" ? (
          <>
            <path d="m25 31 15-9 15 9v17l-15 9-15-9V31Zm0 0 15 9 15-9M40 22v35M25 48l15-8 15 8" />
            {[
              [25, 31],
              [40, 22],
              [55, 31],
              [25, 48],
              [40, 40],
              [55, 48],
            ].map(([cx, cy]) => (
              <circle
                key={`${cx}${cy}`}
                cx={cx}
                cy={cy}
                r="3"
                className="badge-node"
              />
            ))}
          </>
        ) : base === "repair" ? (
          <>
            <path d="M23 43a18 18 0 0 1 29-19l6 6M58 19v11H47M57 39a18 18 0 0 1-29 16l-6-6M22 60V49h11m-1-9 6 6 11-13" />
          </>
        ) : base === "clock" ? (
          <>
            <circle cx="40" cy="40" r="19" />
            <path d="M40 27v14l10 6M40 17v-4m-5 0h10M25 22l-4-4" />
          </>
        ) : base === "graph" ? (
          <>
            <path d="M24 23v33h34M29 48l9-14 8 7 11-17M30 56v-3m10 3v-3m10 3v-3" />
            <circle cx="38" cy="34" r="2" />
          </>
        ) : base === "book" ? (
          <>
            <path d="M40 28c-7-5-14-5-20-2v28c7-3 14-3 20 2 6-5 13-5 20-2V26c-6-3-13-3-20 2v28M26 33l8 1m-8 6 8 1m12-7 8-1m-8 8 8-1" />
          </>
        ) : base === "branch" ? (
          <>
            <path d="M40 59V40m0 0L25 28V19m15 21 15-12v-9M25 19l-5 6m5-6 5 6m25-6-5 6m5-6 5 6" />
            <circle cx="40" cy="43" r="5" />
          </>
        ) : base === "shield" ? (
          <>
            <path d="m40 20 18 7v15c0 10-9 17-18 20-9-3-18-10-18-20V27l18-7Z" />
            <path d="m30 40 7 7 14-16" />
          </>
        ) : base === "compass" ? (
          <>
            <circle cx="40" cy="40" r="20" />
            <path d="m49 28-5 16-13 8 5-16 13-8Zm-9-8v-4m20 24h4M40 60v4M20 40h-4" />
          </>
        ) : base === "steps" ? (
          <>
            <path d="M22 57V45h12V34h12V23h12v34H22m4-30 9-9 7 7 13-11m-7 0h7v7" />
          </>
        ) : base === "crown" ? (
          <>
            <path d="m20 28 10 8 10-15 10 15 10-8-5 24H25l-5-24Zm7 30h26M30 43h20" />
            <circle cx="40" cy="21" r="2" />
          </>
        ) : art === "platinum" ? (
          <>
            <path d="m40 18 18 14-6 20-12 13-12-13-6-20 18-14Zm-18 14h36M40 18 32 32l8 33 8-33-8-14M22 32l18 33 18-33M15 17l3 6m47-6-3 6M10 40h5m50 0h5" />
          </>
        ) : (
          <>
            <path d="m25 40 10 10 21-23" />
            <circle cx="40" cy="39" r="21" strokeDasharray="4 4" />
          </>
        )}
        {crown && (
          <path
            d="m29 13 4 4 7-8 7 8 4-4-2 10H31l-2-10Z"
            className="badge-node"
          />
        )}
        {shield && (
          <path
            d="m40 9 24 11v25c0 12-12 22-24 27-12-5-24-15-24-27V20L40 9Z"
            opacity=".4"
          />
        )}
      </g>
      {(rarity === "Diamond" || rarity === "Platinum") && (
        <path
          className="badge-facets"
          d="m40 5 4 6-4 6-4-6 4-6Zm-26 42 6 3-2 7-6-3 2-7Zm52 0 2 7-6 3-2-7 6-3Z"
        />
      )}
    </svg>
  );
}
