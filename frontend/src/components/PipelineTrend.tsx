import { fmtSeconds, type Run } from "../api";

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;

type Point = { sha: string; build: number; ok: boolean; pickup: number | null; failure: boolean };

// Build time of the last finished runs of main. GitHub only reports the build, so the server's pickup time is
// known for the version running right now and is stacked on that one bar; older deploys show the build alone.
export function PipelineTrend({ runs, liveSha, pickup }: { runs: Run[]; liveSha: string; pickup: number | null }) {
  const points: Point[] = runs
    .filter((r) => r.status === "completed")
    .map((r) => ({
      sha: r.sha.slice(0, 7),
      build: Math.max(0, seconds(r.started, r.updated)),
      ok: r.conclusion === "success",
      pickup: r.sha === liveSha ? pickup : null,
      failure: r.conclusion !== "success",
    }))
    .reverse(); // the API lists the newest first; the chart reads left to right in time
  if (points.length < 2) return null;

  const good = points.filter((p) => p.ok).map((p) => p.build).sort((a, b) => a - b);
  const median = good.length > 0 ? good[Math.floor(good.length / 2)] : null;
  const slowest = good.length > 0 ? good[good.length - 1] : null;
  const failed = points.length - good.length;

  const X0 = 40;
  const X1 = 790;
  const Y0 = 20;
  const Y1 = 140;
  const top = niceMax(Math.max(...points.map((p) => p.build + (p.pickup ?? 0))));
  const y = (v: number) => Y1 - ((Y1 - Y0) * v) / top;
  const slot = (X1 - X0) / points.length;
  const barW = Math.min(52, slot * 0.7);
  const grid = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);

  return (
    <>
      <h3 className="sub">Build time of the last {points.length} deploys</h3>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Build, median</div>
          <div className="tile-value mono">{median === null ? "–" : fmtSeconds(median)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Slowest build</div>
          <div className="tile-value mono">{slowest === null ? "–" : fmtSeconds(slowest)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Succeeded</div>
          <div className={`tile-value mono${failed > 0 ? " tone-warn" : ""}`}>
            {good.length} <span className="muted tele-of">of {points.length}</span>
          </div>
        </div>
      </div>
      <div className="panel">
        <ul className="legend tele-legend">
          <li><span className="swatch ship" />build</li>
          <li><span className="swatch run" />pickup (running version only)</li>
          {failed > 0 && <li><span className="swatch bad" />failed</li>}
        </ul>
        <svg
          className="timeline"
          viewBox="0 0 800 166"
          role="img"
          aria-label={`Build time of the last ${points.length} deploys, oldest to newest${median === null ? "" : `, median ${fmtSeconds(median)}`}${failed > 0 ? `, ${failed} failed` : ""}`}
        >
          {grid.map((v) => (
            <g key={v}>
              <line className="tele-grid" x1={X0} x2={X1} y1={y(v)} y2={y(v)} />
              <text className="tele-ytext" x={X0 - 8} y={y(v) + 3} textAnchor="end">{fmtSeconds(v)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = X0 + slot * i + (slot - barW) / 2;
            const buildTop = y(p.build);
            const pickupTop = y(p.build + (p.pickup ?? 0));
            return (
              <g key={p.sha + i}>
                <rect className={p.ok ? "trend-bar build" : "trend-bar bad"} x={x} y={buildTop} width={barW} height={Math.max(1, Y1 - buildTop)} rx={2} />
                {p.pickup !== null && p.pickup > 0 && (
                  <rect className="trend-bar pickup" x={x} y={pickupTop} width={barW} height={Math.max(1, buildTop - pickupTop)} rx={2} />
                )}
                <text className="trend-val" x={x + barW / 2} y={pickupTop - 5} textAnchor="middle">{fmtSeconds(p.build + (p.pickup ?? 0))}</text>
                <text className={p.ok ? "trend-sha" : "trend-sha bad"} x={x + barW / 2} y={158} textAnchor="middle">{p.sha.slice(0, 5)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

function niceMax(v: number): number {
  for (const step of [60, 120, 180, 240, 300, 600, 900, 1800, 3600]) if (v * 1.15 <= step) return step;
  return Math.ceil(v / 3600) * 3600;
}
