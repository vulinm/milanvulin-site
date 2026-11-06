import { useEffect, useState } from "react";

const WINDOW = 60;
const EVERY_MS = 1000;
const TIMEOUT_MS = 3000;

type Run = {
  samples: (number | null)[]; // the last 60 pings, null = no reply
  total: number;
  lost: number;
  sum: number;
  min: number;
  max: number;
  last: number | null;
};

const EMPTY: Run = { samples: [], total: 0, lost: 0, sum: 0, min: Infinity, max: 0, last: null };

function add(run: Run, ms: number | null): Run {
  const samples = [...run.samples, ms].slice(-WINDOW);
  if (ms === null) return { ...run, samples, total: run.total + 1, lost: run.lost + 1 };
  return { samples, total: run.total + 1, lost: run.lost, sum: run.sum + ms, min: Math.min(run.min, ms), max: Math.max(run.max, ms), last: ms };
}

const fmt = (ms: number) => (ms >= 10 ? String(Math.round(ms)) : ms.toFixed(1));

// Pings the API from the visitor's own browser once a second, from the moment the page opens, until switched off.
// It pauses while the tab is hidden. Nothing is stored and a ping carries no data.
export function PingCard() {
  const [on, setOn] = useState(true);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [run, setRun] = useState<Run>(EMPTY);

  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  useEffect(() => {
    if (!on || hidden) return;
    let cancelled = false;
    let busy = false;
    const ping = async () => {
      if (busy) return;
      busy = true;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
      const started = performance.now();
      let ms: number | null = null;
      try {
        const r = await fetch("/api/ping", { cache: "no-store", signal: controller.signal });
        if (r.ok) ms = performance.now() - started;
      } catch {
        /* no reply in time, or the network is down: counts as lost */
      }
      window.clearTimeout(timer);
      busy = false;
      if (!cancelled) setRun((prev) => add(prev, ms));
    };
    void ping();
    const id = window.setInterval(ping, EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [on, hidden]);

  const toggle = () => {
    // Switching it back on starts a fresh count.
    if (!on) setRun(EMPTY);
    setOn(!on);
  };

  const replies = run.total - run.lost;
  const running = on && !hidden;
  const status = running ? "every second" : on ? "tab hidden" : "stopped";
  const lostPercent = run.total > 0 ? ((100 * run.lost) / run.total).toFixed(1) : "0.0";

  return (
    <div className={`ping${running ? "" : " off"}`}>
      <div className="ping-head">
        <div>
          <h3 className="ping-title">Ping the API from your browser</h3>
          <p className="ping-lead">
            Your browser sends a tiny request to the API container every second and times the reply. It starts when you
            open the page; use the switch to stop it.
          </p>
        </div>
        <div className="ping-controls">
          <span className="pill">
            <span className={`dot ${running ? "ok" : ""}`} aria-hidden="true" />
            {running ? "live" : "paused"}
            <span className="mono muted"> {status}</span>
          </span>
          <button type="button" role="switch" aria-checked={on} className={`switch${on ? " on" : ""}`} onClick={toggle}>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
            {on ? "Pinging" : "Paused"}
          </button>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Round trip, now</div>
          <div className="tile-value mono">{run.last === null ? "–" : `${fmt(run.last)} ms`}</div>
          <div className="tile-label">last reply</div>
        </div>
        <div className="tile">
          <div className="tile-label">Average</div>
          <div className="tile-value mono">{replies > 0 ? `${fmt(run.sum / replies)} ms` : "–"}</div>
          <div className="tile-label">of {run.total} pings</div>
        </div>
        <div className="tile">
          <div className="tile-label">Fastest / slowest</div>
          <div className="tile-value mono">{replies > 0 ? `${fmt(run.min)}/${fmt(run.max)} ms` : "–"}</div>
          <div className="tile-label">since you opened the page</div>
        </div>
        <div className="tile">
          <div className="tile-label">Lost</div>
          <div className={`tile-value mono${run.lost > 0 ? " tone-warn" : ""}`}>
            {run.lost} <span className="muted tele-of">of {run.total}</span>
          </div>
          <div className="tile-label">{lostPercent} %, no reply in 3 s</div>
        </div>
      </div>

      <PingChart samples={run.samples} />

      <p className="note ping-note">
        This is the whole trip from your device through Cloudflare to the API and back, so it includes your own
        connection. Nothing is stored and a ping carries no data about you. It pauses by itself while the tab is hidden.
      </p>
    </div>
  );
}

function PingChart({ samples }: { samples: (number | null)[] }) {
  const X0 = 40;
  const X1 = 790;
  const Y0 = 10;
  const Y1 = 100;
  const slot = (X1 - X0) / WINDOW;
  const replies = samples.filter((v): v is number => v !== null);
  const sorted = [...replies].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  const slowAbove = Math.max(20, median * 2);
  const peak = replies.length > 0 ? Math.max(...replies) : 0;
  const top = [20, 40, 80, 160, 320, 640, 1280, 3000].find((v) => peak * 1.1 <= v) ?? 3000;
  const y = (v: number) => Y1 - ((Y1 - Y0) * v) / top;
  const first = WINDOW - samples.length; // newest ping at the right edge

  return (
    <>
      <svg className="timeline ping-chart" viewBox="0 0 800 130" role="img" aria-label={`Round-trip time of the last ${samples.length} pings${replies.length > 0 ? `, median ${Math.round(median)} milliseconds` : ""}`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line className="tele-grid" x1={X0} x2={X1} y1={y((top * i) / 4)} y2={y((top * i) / 4)} />
            <text className="tele-ytext" x={X0 - 8} y={y((top * i) / 4) + 3} textAnchor="end">{(top * i) / 4}</text>
          </g>
        ))}
        {samples.map((v, i) => {
          const x = X0 + slot * (first + i) + 1;
          if (v === null) {
            return (
              <rect key={i} className="ping-lost" x={x} y={Y1 - 6} width={slot - 2} height={6} rx={1} />
            );
          }
          return <rect key={i} className={v > slowAbove ? "ping-bar slow" : "ping-bar"} x={x} y={y(v)} width={slot - 2} height={Y1 - y(v)} rx={1.5} />;
        })}
      </svg>
      <div className="tele-axis mono"><span>−60 s</span><span>ms per ping</span><span>now</span></div>
      <ul className="legend tele-legend ping-legend">
        <li><span className="swatch run" />reply</li>
        <li><span className="swatch slow-sw" />slow, over twice the median</li>
        <li><span className="swatch bad-outline" />lost</li>
      </ul>
    </>
  );
}
