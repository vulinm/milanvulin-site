import { useEffect, useRef, useState } from "react";
import { ago, fmtSeconds, getRuns, getVersion, type Run, type Version } from "../api";

type Loaded = { version: Version; runs: Run[] };

const BAR_WIDTH = 600;
const REPLAY_SPEED = 6;
// If the API came up much later than its build finished, it was restarted for another reason.
const MAX_PICKUP_SECONDS = 900;

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;

export function ShipIt() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState<number | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    Promise.all([getVersion(), getRuns()])
      .then(([version, runs]) => setData({ version, runs }))
      .catch((e: unknown) => setError(String(e)));
    return () => cancelAnimationFrame(frame.current);
  }, []);

  if (error) return <p className="note">Could not load deploy data ({error}).</p>;
  if (!data) return <p className="note">Loading deploy data…</p>;

  const { version, runs } = data;
  const live = runs.find((r) => r.sha === version.sha && r.status === "completed");
  const ci = live ? seconds(live.started, live.updated) : null;
  const pickupRaw = live ? seconds(live.updated, version.startedAt) : null;
  const pickup = pickupRaw !== null && pickupRaw >= 0 && pickupRaw <= MAX_PICKUP_SECONDS ? pickupRaw : null;
  const total = ci !== null && pickup !== null ? ci + pickup : null;

  function replay() {
    if (total === null) return;
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    const tick = (now: number) => {
      const s = ((now - start) / 1000) * REPLAY_SPEED;
      if (s >= total) {
        setT(total);
        return;
      }
      setT(s);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  return (
    <div>
      {total !== null && ci !== null && pickup !== null ? (
        <>
          <div className="tiles">
            <Tile label="Push to live" value={fmtSeconds(total)} />
            <Tile label="Build and publish" value={fmtSeconds(ci)} />
            <Tile label="Server picks it up" value={fmtSeconds(pickup)} />
          </div>
          <Timeline ci={ci} pickup={pickup} total={total} t={t} />
          <div className="row">
            <button type="button" onClick={replay}>
              {t === null ? "Replay this deploy" : "Replay again"}
            </button>
            <span className="muted mono">{t === null ? "" : `${fmtSeconds(t)} elapsed`}</span>
          </div>
          <p className="note">
            Live now: commit <code>{version.sha.slice(0, 7)}</code>. Both durations are measured: the build time comes
            from the GitHub Actions run, and the pickup time is the gap between that run finishing and this API
            container starting. Replay runs {REPLAY_SPEED}x faster than real time.
          </p>
        </>
      ) : (
        <p className="note">
          {version.sha === "dev"
            ? "This is a local build, so there is no CI run to match. The timeline appears on the deployed site."
            : "The commit running here does not match a finished build in the last ten runs, so there is nothing to measure yet. Check the list below."}
        </p>
      )}

      <h3 className="sub">Recent builds of main</h3>
      <ul className="runs">
        {runs.map((r) => (
          <li key={r.sha + r.started}>
            <span className={`dot ${statusClass(r)}`} title={r.conclusion ?? r.status} />
            <a className="mono" href={r.url}>
              {r.sha.slice(0, 7)}
            </a>
            <span className="msg">{r.message}</span>
            <span className="muted mono">
              {r.status === "completed" ? fmtSeconds(seconds(r.started, r.updated)) : "running"}
            </span>
            <span className="muted when">{ago(r.started)}</span>
          </li>
        ))}
        {runs.length === 0 && <li className="muted">No runs returned by GitHub yet.</li>}
      </ul>
    </div>
  );
}

function statusClass(r: Run): string {
  if (r.status !== "completed") return "run";
  return r.conclusion === "success" ? "ok" : "bad";
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value mono">{value}</div>
    </div>
  );
}

function Timeline({ ci, pickup, total, t }: { ci: number; pickup: number; total: number; t: number | null }) {
  // Widths are proportional, with a floor so a short stage stays visible.
  const floor = total * 0.15;
  const shown = [Math.max(ci, floor), Math.max(pickup, floor)];
  const sum = shown[0] + shown[1];
  const w = shown.map((x) => (BAR_WIDTH * x) / sum);
  const stages = [
    { label: "Build and publish", x: 0, w: w[0], start: 0, dur: ci, cls: "ship" },
    { label: "Server pulls and restarts", x: w[0], w: w[1], start: ci, dur: pickup, cls: "run" },
  ];
  const fill = (start: number, dur: number) => {
    if (t === null || dur <= 0) return 0;
    return Math.min(1, Math.max(0, (t - start) / dur));
  };

  // Labels live in a legend below the bar, so a narrow segment can never make them overlap.
  return (
    <div className="timeline-wrap">
      <svg className="timeline" viewBox="0 0 640 40" role="img" aria-label="Deploy timeline: build and publish, then server pulls and restarts">
        {stages.map((s) => (
          <g key={s.label} transform={`translate(${20 + s.x} 0)`}>
            <rect className={`seg ${s.cls}`} x={0} y={8} width={s.w - 2} height={26} rx={4} />
            <rect className={`fill ${s.cls}`} x={0} y={8} width={Math.max(0, (s.w - 2) * fill(s.start, s.dur))} height={26} rx={4} />
          </g>
        ))}
      </svg>
      <ul className="legend">
        {stages.map((s) => (
          <li key={s.label}>
            <span className={`swatch ${s.cls}`} />
            <span>{s.label}</span>
            <span className="muted mono">{fmtSeconds(s.dur)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
