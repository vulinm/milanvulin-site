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
        <span className="muted tele-window">Window: last 60 minutes</span>
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
          {gpu && (gpu.gpu || gpu.model) && (
            <>
              <h3 className="sub">GPU</h3>
              <GpuPanel data={gpu} />
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
  const total = a.requests.reduce((x, y) => x + y, 0);
  return (
    <>
      <div className="tiles">
        <Tile label="Requests per minute" value={a.requestsPerMinute}>
          <Spark values={a.requests} cls="run" label="Requests per minute over the last hour" />
        </Tile>
        <Tile label="Latency p95" value={a.p95Ms === null ? "–" : `${fmtMs(a.p95Ms)} ms`}>
          <Spark values={a.p95} cls="ship" label="95th percentile latency over the last hour" />
        </Tile>
        <Tile label="Server errors" value={`${a.errorPercent.toFixed(1)} %`} tone={a.errorPercent > 0 ? "warn" : "ok"}>
          <Spark values={a.errors} cls={a.errorPercent > 0 ? "warn" : "ok"} label="Server errors over the last hour" />
        </Tile>
        <Tile label="Uptime" value={fmtUptime(data.uptimeSeconds)} hint="since the API last started" />
      </div>
      <ResponseChart p50={a.p50} p95={a.p95} empty={total === 0} />
    </>
  );
}

function ChatPanel({ data }: { data: TelemetryData }) {
  const c = data.chat;
  return (
    <>
      <div className="tiles">
        <Tile label="First token, median" value={c.ttftMedianMs === null ? "–" : `${(c.ttftMedianMs / 1000).toFixed(2)} s`} hint="last 20 answers" />
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
        <Tile label="Turned away" value={c.turnedAway} tone={c.turnedAway > 0 ? "warn" : undefined} hint="busy or over the limit, last hour" />
      </div>
      <SpeedBars answers={c.answers} median={c.tpsMedian} />
    </>
  );
}

function GpuPanel({ data }: { data: GpuData }) {
  const { gpu, model } = data;
  const gb = (mb: number) => (mb / 1024).toFixed(1);
  const hasHistory = data.utilization.some((v) => v !== null);
  return (
    <>
      {gpu && (
        <div className="tiles">
          <>
            <Tile label="GPU load" value={`${gpu.utilizationPercent} %`}>
              <Spark values={data.utilization} cls="run" label="GPU load over the last hour, highest value per minute" max={100} />
            </Tile>
            <Tile
              label="Video memory"
              value={`${gb(gpu.memoryUsedMb)} GB`}
              hint={gpu.memoryTotalMb ? `of ${gb(gpu.memoryTotalMb)} GB` : undefined}
            />
            {gpu.temperatureC !== null && <Tile label="Temperature" value={`${gpu.temperatureC} °C`} />}
            {gpu.powerW !== null && <Tile label="Power draw" value={`${gpu.powerW} W`} />}
          </>
        </div>
      )}
      {model && (
        <div className="tiles">
          <>
            <Tile label="Model in video memory" value={`${gb(model.vramMb)} GB`} hint={model.name} />
            <Tile
              label="Running on the GPU"
              value={`${model.onGpuPercent} %`}
              tone={model.onGpuPercent >= 100 ? "ok" : "warn"}
              hint={model.onGpuPercent >= 100 ? "all of the model" : "the rest runs on the CPU"}
            />
          </>
        </div>
      )}
      {gpu && hasHistory && <UtilChart values={data.utilization} name={gpu.name} />}
    </>
  );
}

function UtilChart({ values, name }: { values: Series; name: string | null }) {
  const X0 = 40;
  const X1 = 790;
  const Y0 = 10;
  const Y1 = 110;
  const grid = [0, 50, 100];
  const y = (v: number) => Y1 - ((Y1 - Y0) * v) / 100;
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>GPU load</strong>
        <span className="muted tele-sub">highest value in each minute{name ? `, ${name}` : ""}</span>
      </div>
      <svg className="timeline" viewBox="0 0 800 120" role="img" aria-label="GPU load over the last 60 minutes, highest value in each minute, from 0 to 100 percent">
        {grid.map((v) => (
          <g key={v}>
            <line className="tele-grid" x1={X0} x2={X1} y1={y(v)} y2={y(v)} />
            <text className="tele-ytext" x={X0 - 8} y={y(v) + 3} textAnchor="end">{v} %</text>
          </g>
        ))}
        <path className="chart-line run" d={pathOf(values, X0, X1, Y0, Y1, 0, 100)} />
      </svg>
      <div className="tele-axis mono"><span>−60 min</span><span>0 to 100 %</span><span>now</span></div>
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
    </svg>
  );
}

function ResponseChart({ p50, p95, empty }: { p50: Series; p95: Series; empty: boolean }) {
  const X0 = 40;
  const X1 = 790;
  const Y0 = 10;
  const Y1 = 120;
  const top = niceMax(Math.max(1, ...p95.map((v) => v ?? 0), ...p50.map((v) => v ?? 0)));
  const grid = [0, 1, 2, 3, 4].map((i) => ({ y: Y1 - ((Y1 - Y0) * i) / 4, v: (top * i) / 4 }));
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Response time</strong>
        <ul className="legend tele-legend">
          <li><span className="swatch run" />median</li>
          <li><span className="swatch ship" />95th percentile</li>
        </ul>
      </div>
      {empty ? (
        <p className="note">No requests in the last hour yet.</p>
      ) : (
        <>
          <svg className="timeline" viewBox="0 0 800 130" role="img" aria-label={`Response time over the last 60 minutes, scaled up to ${top} milliseconds`}>
            {grid.map((g) => (
              <g key={g.y}>
                <line className="tele-grid" x1={X0} x2={X1} y1={g.y} y2={g.y} />
                <text className="tele-ytext" x={X0 - 8} y={g.y + 3} textAnchor="end">{g.v}</text>
              </g>
            ))}
            <path className="chart-line ship" d={pathOf(p95, X0, X1, Y0, Y1, 0, top)} />
            <path className="chart-line run" d={pathOf(p50, X0, X1, Y0, Y1, 0, top)} />
          </svg>
          <div className="tele-axis mono"><span>−60 min</span><span>scale to {top} ms</span><span>now</span></div>
        </>
      )}
    </div>
  );
}

function SpeedBars({ answers, median }: { answers: { ttftMs: number; tps: number }[]; median: number | null }) {
  if (answers.length === 0) {
    return (
      <div className="panel">
        <strong>Speed of the last answers</strong>
        <p className="note">No answers since the API last started.</p>
      </div>
    );
  }
  const values = answers.map((a) => a.tps);
  const base = Math.max(0, Math.floor((Math.min(...values) * 0.9) / 10) * 10);
  const top = Math.max(...values);
  const slot = 28;
  const H = 56;
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Speed of the last {answers.length} answers</strong>
        <span className="muted tele-sub">tokens per second, axis starts at {base}</span>
      </div>
      <svg className="timeline" viewBox={`0 0 ${slot * 20 - 8} ${H}`} role="img" aria-label={`Tokens per second for the last ${answers.length} answers, between ${Math.round(Math.min(...values))} and ${Math.round(top)}`}>
        {values.map((v, i) => {
          const h = 6 + ((v - base) / (top - base || 1)) * (H - 12);
          const slow = median !== null && v < median * 0.85;
          return <rect key={i} className={slow ? "bar slow" : "bar"} x={(20 - values.length + i) * slot} y={H - h} width={20} height={h} rx={2} />;
        })}
      </svg>
    </div>
  );
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

function niceMax(v: number): number {
  for (const step of [4, 8, 20, 40, 80, 200, 400, 800, 2000, 4000, 8000]) if (v * 1.1 <= step) return step;
  return Math.ceil(v / 1000) * 1000;
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
