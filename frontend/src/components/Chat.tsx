import { useEffect, useRef, useState } from "react";
import { ChatError, streamChat, type ChatDone, type ChatMsg, type ChatStatus } from "../api";

type View = ChatMsg & { stats?: ChatDone };

const SUGGESTIONS = [
  "What does Milan work on?",
  "How does this site deploy itself?",
  "Why a pull-based pipeline?",
];

const HISTORY_LIMIT = 6; // messages sent along with each question
const MAX_ASSISTANT_CHARS = 2000;

function friendly(e: unknown): string {
  if (e instanceof ChatError) {
    if (e.status === 429) return "Too many questions in a minute. Try again shortly.";
    if (e.code === "busy") return "The GPU is answering other visitors right now. Try again in a few seconds.";
    if (e.status === 400 && e.code) return e.code;
  }
  return "The model isn't answering right now.";
}

export function Chat({ status, onRecheck }: { status: ChatStatus; onRecheck: () => void }) {
  const [messages, setMessages] = useState<View[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  const patchLast = (change: (m: View) => View) =>
    setMessages((cur) => (cur.length === 0 ? cur : [...cur.slice(0, -1), change(cur[cur.length - 1])]));

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const history: ChatMsg[] = [...messages, { role: "user" as const, content: question }]
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_ASSISTANT_CHARS) }));
    setMessages((cur) => [...cur, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setBusy(true);

    const controller = new AbortController();
    abort.current = controller;
    try {
      const stats = await streamChat(history, (piece) => patchLast((m) => ({ ...m, content: m.content + piece })), controller.signal);
      if (stats) patchLast((m) => ({ ...m, stats }));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(friendly(e));
      setMessages((cur) => (cur[cur.length - 1]?.content === "" ? cur.slice(0, -1) : cur));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  if (!status.online) {
    return (
      <div className="chat chat-off">
        <p className="note">
          The model is asleep or restarting right now. <button type="button" className="link" onClick={onRecheck}>Check again</button>
        </p>
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <div className="suggest">
            <span className="muted small">Try one of these, or ask your own:</span>
            <div className="suggest-row">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            {m.stats && (
              <span className="stats">
                first token {(m.stats.ttftMs / 1000).toFixed(1)} s · {m.stats.tps} tok/s · {m.stats.model}
              </span>
            )}
          </div>
        ))}
      </div>
      {error && <p className="chat-error">{error}</p>}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          maxLength={500}
          rows={2}
          placeholder="Ask about my work or how this site runs"
          aria-label="Your question"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit">Send</button>
        )}
      </form>
    </div>
  );
}
