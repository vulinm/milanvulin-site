import { useEffect, useRef, useState } from "react";
import { getGpu, getTelemetry, type GpuData, type TelemetryData } from "../api";

const POLL_MS = 5000;
const STALE_MS = 15000;

type Series = (number | null)[];

// Polls only while the section is on screen and the tab is visible, so an idle page costs the API nothing.
function useTelemetry(target: React.RefObject<HTMLElement | null>, withGpu: boolean) {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [gpu, setGpu] = useState<GpuData | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let inView = false;
    let timer: number | undefined;
    let tick: number | undefined;
    let cancelled = false;

    const load = () => {
      // The GPU panel is optional: if its sources are missing it just stays empty.
      if (withGpu) {
        getGpu()
          .then((g) => !cancelled && setGpu(g))
          .catch(() => !cancelled && setGpu(null));
      }
      getTelemetry()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setFetchedAt(Date.now());
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    const stop = () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
      timer = tick = undefined;
    };
    const sync = () => {
      const active = inView && document.visibilityState === "visible";
      if (active && timer === undefined) {
        load();
        timer = window.setInterval(load, POLL_MS);
        tick = window.setInterval(() => setNow(Date.now()), 1000);
      } else if (!active) {
        stop();
      }
    };

    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      sync();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [target, withGpu]);

  return { data, gpu, failed, ageMs: fetchedAt ? now - fetchedAt : null };
}

export function Telemetry() {
  const ref = useRef<HTMLDivElement>(null);
  const { data, failed, ageMs } = useTelemetry(ref, false);
  const live = data !== null && !failed && ageMs !== null && ageMs < STALE_MS;

  return (
    <div ref={ref} className="tele">
      <div className="tele-head">
        <span className="pill">
          <span className={`dot ${live ? "ok" : data ? "run" : ""}`} aria-hidden="true" />
          {live ? "live" : data ? "stale" : failed ? "unavailable" : "loading"}
          {data && ageMs !== null && <span className="mono muted"> updated {Math.max(0, Math.round(ageMs / 1000))} s ago</span>}
        </span>
        <span className="muted tele-window">Window: last {data?.windowMinutes ?? 10} minutes</span>
      </div>

      {!data && (
        <p className="note">{failed ? "The API did not answer, so there is nothing to show yet." : "Waiting for the first reading."}</p>
      )}

      {data && (
        <>
          <h3 className="sub">API</h3>
          <ApiPanel data={data} />
          <p className="note">Kept in memory and reset when the API restarts. Nothing here records who asked or what they asked.</p>
        </>
      )}
    </div>
  );
}

// Shown right under the chat window: how the model behind it is doing. Polls on its own, only while on screen.
export function ChatTelemetry() {
  const ref = useRef<HTMLDivElement>(null);
  const { data, gpu } = useTelemetry(ref, true);
  return (
    <div ref={ref} className="tele">
      {data?.chat.enabled && (
        <>
          <h3 className="sub">Live numbers</h3>
          <ChatPanel data={data} />
          {gpu?.gpu && gpu.utilization.some((v) => v !== null) && (
            <>
              <h3 className="sub">GPU</h3>
              <UtilChart data={gpu} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tile(props: { label: string; value: React.ReactNode; hint?: string; tone?: "ok" | "warn"; children?: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{props.label}</div>
      <div className={`tile-value mono${props.tone ? ` tone-${props.tone}` : ""}`}>{props.value}</div>
      {props.children ?? (props.hint && <div className="tile-label">{props.hint}</div>)}
    </div>
  );
}

function ApiPanel({ data }: { data: TelemetryData }) {
  const a = data.api;
  return (
    <div className="tiles">
      <Tile label="Requests per minute" value={a.requestsPerMinute}>
        <Spark values={a.requests} cls="run" label={`Requests per minute over the last ${data.windowMinutes} minutes`} />
      </Tile>
      <Tile label="Avg latency" value={a.avgMs === null ? "–" : `${fmtMs(a.avgMs)} ms`}>
        <Spark values={a.avg} cls="ship" label={`Average latency per minute over the last ${data.windowMinutes} minutes`} />
      </Tile>
      <Tile label="Server errors" value={`${a.errorPercent.toFixed(1)} %`} tone={a.errorPercent > 0 ? "warn" : "ok"}>
        <Spark values={a.errors} cls={a.errorPercent > 0 ? "warn" : "ok"} label={`Server errors over the last ${data.windowMinutes} minutes`} />
      </Tile>
      <Tile label="Uptime" value={fmtUptime(data.uptimeSeconds)} hint="since the API last started" />
    </div>
  );
}

function ChatPanel({ data }: { data: TelemetryData }) {
  const c = data.chat;
  return (
    <>
      <div className="tiles">
        <Tile label="First token, median" value={c.ttftMedianMs === null ? "–" : `${(c.ttftMedianMs / 1000).toFixed(2)} s`} hint={`last ${data.windowMinutes} min`} />
        <Tile label="Speed, median" value={c.tpsMedian === null ? "–" : `${Math.round(c.tpsMedian)} tok/s`} hint="on the GPU" />
        <Tile
          label="Answering now"
          value={
            <>
              {c.slotsInUse} <span className="muted tele-of">of {c.slotsTotal}</span>
            </>
          }
          hint="slots in use"
        />
        <Tile label="Turned away" value={c.turnedAway} tone={c.turnedAway > 0 ? "warn" : undefined} hint={`busy or over the limit, last ${data.windowMinutes} min`} />
      </div>
      <SpeedChart answers={c.answers} median={c.tpsMedian} now={Date.parse(data.generatedAt)} windowMinutes={data.windowMinutes} />
    </>
  );
}

function UtilChart({ data }: { data: GpuData }) {
  const X0 = 40;
  const X1 = 790;
  const Y0 = 10;
  const Y1 = 110;
  const values = data.utilization;
  const y = (v: number) => Y1 - ((Y1 - Y0) * v) / 100;
  const known = values.filter((v): v is number => v !== null);
  const peak = Math.max(...known);
  const line = pathOf(values, X0, X1, Y0, Y1, 0, 100);
  // Fill under the line only where the line is continuous: one closed shape per run of minutes with data.
  const areas: string[] = [];
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) {
      areas.push(`M${run[0].x.toFixed(1)} ${Y1}` + run.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + `L${run[run.length - 1].x.toFixed(1)} ${Y1}Z`);
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (v === null) return flush();
    run.push({ x: X0 + ((X1 - X0) * i) / (values.length - 1), y: y(v) });
  });
  flush();
  const last = data.gpu?.utilizationPercent;
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>GPU load</strong>
        <span className="muted tele-sub">
          {last !== undefined && <>now <span className="mono">{last} %</span> · </>}peak <span className="mono">{Math.round(peak)} %</span>
          {data.gpu?.name ? ` · ${data.gpu.name}` : ""}
        </span>
      </div>
      <svg className="timeline" viewBox="0 0 800 120" role="img" aria-label={`GPU load over the last ${values.length} minutes, highest value in each minute, from 0 to 100 percent. Peak ${Math.round(peak)} percent.`}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line className="tele-grid" x1={X0} x2={X1} y1={y(v)} y2={y(v)} />
            <text className="tele-ytext" x={X0 - 8} y={y(v) + 3} textAnchor="end">{v} %</text>
          </g>
        ))}
        {areas.map((d) => (
          <path key={d} className="area" d={d} />
        ))}
        <path className="chart-line run" d={line} />
        {loneDots(values, X0, X1, Y0, Y1, 0, 100).map((p) => (
          <circle key={p.x} className="chart-dot run" cx={p.x} cy={p.y} r={3.5} />
        ))}
      </svg>
      <div className="tele-axis mono"><span>−{values.length} min</span><span>highest in each minute</span><span>now</span></div>
    </div>
  );
}

// Small line under a tile value. A minute with no data (null) breaks the line instead of dropping to zero.
function Spark({ values, cls, label, max: fixedMax }: { values: Series; cls: string; label: string; max?: number }) {
  const W = 120;
  const H = 28;
  const max = fixedMax ?? Math.max(1, ...values.map((v) => v ?? 0));
  const d = pathOf(values, 0, W, 2, H - 2, 0, max);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={d || `M0 ${H - 2}H${W}`} className={`spark-line ${cls}`} />
      {loneDots(values, 0, W, 2, H - 2, 0, max).map((p) => (
        <circle key={p.x} className={`spark-dot ${cls}`} cx={p.x} cy={p.y} r={2} />
      ))}
    </svg>
  );
}

// One dot per answer, placed where it finished. The dashed line is the median; a dot below it turns amber.
function SpeedChart({ answers, median, now, windowMinutes }: { answers: TelemetryData["chat"]["answers"]; median: number | null; now: number; windowMinutes: number }) {
  const X0 = 40;
  const X1 = 790;
  const Y0 = 10;
  const Y1 = 120;
  const top = Math.max(40, Math.ceil((Math.max(0, ...answers.map((a) => a.tps)) * 1.1) / 40) * 40);
  const y = (v: number) => Y1 - ((Y1 - Y0) * v) / top;
  const pts = answers.map((a) => {
    const minutesAgo = Math.min(windowMinutes, Math.max(0, (now - Date.parse(a.at)) / 60000));
    return { ...a, minutesAgo, x: X1 - ((X1 - X0) * minutesAgo) / windowMinutes, slow: median !== null && a.tps < median };
  });
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Answer speed</strong>
        <ul className="legend tele-legend">
          <li><span className="swatch dot run" />one answer</li>
          <li><span className="swatch dot slow" />below the median</li>
          <li><span className="swatch dash" />median</li>
        </ul>
      </div>
      {pts.length === 0 ? (
        <p className="note">No answers in the last {windowMinutes} minutes.</p>
      ) : (
        <>
          <svg className="timeline" viewBox="0 0 800 130" role="img" aria-label={`Tokens per second of each chat answer over the last ${windowMinutes} minutes: ${pts.length} answers, between ${Math.round(Math.min(...pts.map((p) => p.tps)))} and ${Math.round(Math.max(...pts.map((p) => p.tps)))}`}>
            {[0, 1, 2, 3, 4].map((i) => {
              const v = (top * i) / 4;
              return (
                <g key={i}>
                  <line className="tele-grid" x1={X0} x2={X1} y1={y(v)} y2={y(v)} />
                  <text className="tele-ytext" x={X0 - 8} y={y(v) + 3} textAnchor="end">{v}</text>
                </g>
              );
            })}
            {median !== null && <line className="median" x1={X0} x2={X1} y1={y(median)} y2={y(median)} />}
            {pts.length > 1 && <path className="chart-line run faint" d={pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${y(p.tps).toFixed(1)}`).join("")} />}
            {pts.map((p) => (
              <circle key={p.at} className={p.slow ? "pt slow" : "pt"} cx={p.x} cy={y(p.tps)} r={p.slow ? 5 : 4}>
                <title>{`${p.tps} tok/s, first token ${(p.ttftMs / 1000).toFixed(2)} s, ${Math.round(p.minutesAgo)} min ago`}</title>
              </circle>
            ))}
          </svg>
          <div className="tele-axis mono"><span>−{windowMinutes} min</span><span>tokens per second, from 0</span><span>now</span></div>
        </>
      )}
    </div>
  );
}

// A minute with data and an empty minute on both sides draws no line segment, so it would be invisible.
// These are the points that need a dot instead.
function loneDots(values: Series, x0: number, x1: number, y0: number, y1: number, min: number, max: number): { x: number; y: number }[] {
  const n = values.length;
  const dots: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null || values[i - 1] != null || values[i + 1] != null) return;
    dots.push({
      x: x0 + ((x1 - x0) * i) / Math.max(1, n - 1),
      y: y1 - ((y1 - y0) * (v - min)) / (max - min || 1),
    });
  });
  return dots;
}

// Builds an SVG path through the points, starting a new segment after every gap.
function pathOf(values: Series, x0: number, x1: number, y0: number, y1: number, min: number, max: number): string {
  const n = values.length;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = x0 + ((x1 - x0) * i) / Math.max(1, n - 1);
    const y = y1 - ((y1 - y0) * (v - min)) / (max - min || 1);
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

const fmtMs = (ms: number) => (ms >= 100 ? String(Math.round(ms)) : ms.toFixed(1));

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
