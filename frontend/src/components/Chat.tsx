import { useEffect, useRef, useState } from "react";
import { ChatError, streamChat, type ChatDone, type ChatMsg, type ChatStatus } from "../api";
import { QUESTION_SLOTS } from "../chatQuestions";

type View = ChatMsg & { stats?: ChatDone };

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
  // Where each of the suggested-question slots is in its list, and which slot is being answered right now.
  const [position, setPosition] = useState<number[]>(() => QUESTION_SLOTS.map(() => 0));
  const [asking, setAsking] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  const patchLast = (change: (m: View) => View) =>
    setMessages((cur) => (cur.length === 0 ? cur : [...cur.slice(0, -1), change(cur[cur.length - 1])]));

  // slot is set when the question came from a suggestion button: that button advances to its next question, but only
  // if the answer arrived in full, so a failed or stopped answer leaves the same question available.
  async function send(text: string, slot?: number) {
    const question = text.trim();
    if (!question || busy) return;

    const history: ChatMsg[] = [...messages, { role: "user" as const, content: question }]
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_ASSISTANT_CHARS) }));
    setMessages((cur) => [...cur, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setBusy(true);
    setAsking(slot ?? null);

    const controller = new AbortController();
    abort.current = controller;
    try {
      const stats = await streamChat(history, (piece) => patchLast((m) => ({ ...m, content: m.content + piece })), controller.signal);
      if (stats) {
        patchLast((m) => ({ ...m, stats }));
        if (slot !== undefined) setPosition((cur) => cur.map((p, i) => (i === slot ? p + 1 : p)));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(friendly(e));
      setMessages((cur) => (cur[cur.length - 1]?.content === "" ? cur.slice(0, -1) : cur));
    } finally {
      setBusy(false);
      setAsking(null);
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

  // Slots that still have a question left; a slot disappears once its list is used up.
  const open = QUESTION_SLOTS.flatMap((questions, slot) => (position[slot] < questions.length ? [{ slot, question: questions[position[slot]] }] : []));

  return (
    <div className="chat">
      <div className="suggest">
        {open.length > 0 ? (
          <>
            <span className="muted small">Try one of these, or ask your own:</span>
            <div className="suggest-row">
              {open.map(({ slot, question }) => (
                <button
                  key={slot}
                  type="button"
                  className={`suggest-chip${asking === slot ? " out" : ""}`}
                  disabled={busy}
                  onClick={() => void send(question, slot)}
                >
                  {question}
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="muted small">Ask your own question below.</span>
        )}
      </div>
      <div className={`chat-log${messages.length === 0 ? " empty" : ""}`} ref={log} aria-live="polite">
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
          disabled={busy}
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
