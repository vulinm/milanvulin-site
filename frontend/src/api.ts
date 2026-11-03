export type Version = { sha: string; repo: string; startedAt: string };

export type Run = {
  sha: string;
  message: string;
  status: string;
  conclusion: string | null;
  started: string;
  updated: string;
  url: string;
};

export type TraceData = {
  viaCloudflare: boolean;
  rayId: string | null;
  colo: string | null;
  country: string | null;
  visitorIp: string | null;
  scheme: string | null;
  host: string | null;
  container: string;
  startedAt: string;
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const getVersion = () => get<Version>("/api/version");
export const getRuns = async () => (await get<{ runs: Run[] }>("/api/deploys")).runs;
export const getTrace = () => get<TraceData>("/api/trace");

export function fmtSeconds(s: number): string {
  const n = Math.round(s);
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
