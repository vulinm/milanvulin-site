import { useCallback, useEffect, useState } from "react";
import { getTrace, type TraceData } from "../api";

const COLOS: Record<string, string> = {
  FRA: "Frankfurt", VIE: "Vienna", BEG: "Belgrade", BUD: "Budapest", SOF: "Sofia", AMS: "Amsterdam",
  LHR: "London", CDG: "Paris", MAD: "Madrid", MXP: "Milan", ZAG: "Zagreb", WAW: "Warsaw", PRG: "Prague",
  ATH: "Athens", IST: "Istanbul", OTP: "Bucharest", ARN: "Stockholm", HEL: "Helsinki", DUB: "Dublin",
  JFK: "New York", EWR: "Newark", LAX: "Los Angeles", SFO: "San Francisco", ORD: "Chicago", SIN: "Singapore",
  NRT: "Tokyo", SYD: "Sydney",
};

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type Hop = { name: string; detail: string; tag: "observed" | "by design" };

export function Trace() {
  const [data, setData] = useState<TraceData | null>(null);
  const [rtt, setRtt] = useState<{ min: number; med: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIp, setShowIp] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await getTrace());
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await getTrace();
        samples.push(performance.now() - start);
      }
      setRtt({ min: Math.min(...samples), med: median(samples) });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const hops: Hop[] = data ? buildHops(data, showIp) : [];

  return (
    <div>
      <div className="row">
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? "Tracing…" : "Trace again"}
        </button>
        {rtt && (
          <span className="muted mono">
            round trip to the API container: {Math.round(rtt.med)} ms median, {Math.round(rtt.min)} ms best of 5
          </span>
        )}
      </div>
      {error && <p className="note">Trace failed ({error}).</p>}
      {data && !data.viaCloudflare && (
        <p className="note">No Cloudflare headers on this request, so you are probably running the site locally.</p>
      )}
      <ol className="hops">
        {hops.map((h, i) => (
          <li key={h.name}>
            <span className="num mono">{i + 1}</span>
            <div>
              <div className="hop-name">
                {h.name} <span className={`tag ${h.tag === "observed" ? "obs" : "des"}`}>{h.tag}</span>
              </div>
              <div className="muted small">{h.detail}</div>
            </div>
          </li>
        ))}
      </ol>
      {data?.visitorIp && (
        <p className="note">
          <button type="button" className="link" onClick={() => setShowIp((v) => !v)}>
            {showIp ? "Hide my IP" : "Show my IP"}
          </button>{" "}
          Your address is read from a Cloudflare header, returned only to you, and never stored or logged.
        </p>
      )}
      <p className="note">
        Observed means read from this response: request headers or the API itself. By design means it follows from the
        architecture but is not visible to the API.
      </p>
    </div>
  );
}

function buildHops(d: TraceData, showIp: boolean): Hop[] {
  const where = countryName(d.country);
  const city = d.colo ? COLOS[d.colo] : undefined;
  return [
    {
      name: "Your browser",
      tag: "observed",
      detail: [where ?? "location unknown", d.visitorIp ? (showIp ? d.visitorIp : "IP hidden") : null]
        .filter(Boolean)
        .join(" · "),
    },
    {
      name: "Cloudflare edge",
      tag: "observed",
      detail: d.viaCloudflare
        ? `${d.colo ?? "unknown location"}${city ? ` (${city})` : ""} · ${d.scheme ?? "https"} terminated here · ray ${d.rayId}`
        : "not present on this request",
    },
    { name: "Cloudflare Tunnel", tag: "by design", detail: "Outbound-only connection opened by the home server, so no inbound port is exposed." },
    { name: "Caddy", tag: "observed", detail: `Routes on the Host header: ${d.host ?? "unknown"}` },
    { name: "nginx in the web container", tag: "by design", detail: "Serves the page and forwards only /api/ to the API." },
    {
      name: "API container",
      tag: "observed",
      detail: `${d.container} · running since ${new Date(d.startedAt).toLocaleString()}`,
    },
  ];
}
