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

export type ChatStatus = { enabled: boolean; online: boolean; model: string | null };
export type ChatMsg = { role: "user" | "assistant"; content: string };
export type ChatDone = { model: string; ttftMs: number; tokens: number; tps: number };

export const getChatStatus = () => get<ChatStatus>("/api/chat/status");

export type TelemetryData = {
  generatedAt: string;
  windowMinutes: number;
  startedAt: string;
  uptimeSeconds: number;
  api: {
    requestsPerMinute: number;
    avgMs: number | null;
    errorPercent: number;
    requests: number[];
    errors: number[];
    avg: (number | null)[];
  };
  chat: {
    enabled: boolean;
    slotsInUse: number;
    slotsTotal: number;
    turnedAway: number;
    ttftMedianMs: number | null;
    tpsMedian: number | null;
    answers: { at: string; ttftMs: number; tps: number }[];
  };
};

export const getTelemetry = () => get<TelemetryData>("/api/telemetry");

export type GpuData = {
  generatedAt: string;
  gpu: {
    name: string | null;
    utilizationPercent: number;
    memoryUsedMb: number;
    memoryTotalMb: number | null;
    temperatureC: number | null;
    powerW: number | null;
  } | null;
  model: { name: string; vramMb: number; sizeMb: number; onGpuPercent: number; contextLength: number | null } | null;
  utilization: (number | null)[];
  memoryMb: (number | null)[];
};

export const getGpu = () => get<GpuData>("/api/telemetry/gpu");

export class ChatError extends Error {
  status: number;
  code: string;
  constructor(status: number, code = "") {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

// Sends the conversation and reads the answer as it streams in (server-sent events over fetch).
export async function streamChat(
  messages: ChatMsg[],
  onText: (piece: string) => void,
  signal: AbortSignal,
): Promise<ChatDone | null> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!r.ok || !r.body) {
    let code = "";
    try {
      code = ((await r.json()) as { error?: string }).error ?? "";
    } catch {
      /* the body was empty or not JSON */
    }
    throw new ChatError(r.status, code);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: ChatDone | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf("\n\n");
      if (!event.startsWith("data: ")) continue;
      const data = JSON.parse(event.slice(6)) as { t?: string; done?: boolean; error?: string } & Partial<ChatDone>;
      if (data.error) throw new ChatError(0, data.error);
      if (typeof data.t === "string") onText(data.t);
      else if (data.done) {
        done = { model: data.model ?? "", ttftMs: data.ttftMs ?? 0, tokens: data.tokens ?? 0, tps: data.tps ?? 0 };
      }
    }
  }
  return done;
}

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
