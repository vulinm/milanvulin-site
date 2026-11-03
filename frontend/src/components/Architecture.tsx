import { useState } from "react";
import { nodes, type ArchNode } from "../architecture";

const BOX_W = 130;
const BOX_H = 56;
const X0 = 30;
const STEP = 160;
const Y = { run: 40, ship: 180 } as const;

const boxX = (n: ArchNode) => X0 + n.col * STEP;

export function Architecture() {
  const [selected, setSelected] = useState<ArchNode>(nodes[2]);

  return (
    <div>
      <svg className="arch" viewBox="0 0 680 250" role="group" aria-label="Architecture diagram: runtime path and delivery path">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <text className="lane" x={30} y={28}>Runtime path: request in</text>
        <text className="lane" x={30} y={168}>Delivery path: code out</text>

        {nodes.map((n) => {
          const x = boxX(n);
          const y = Y[n.lane];
          const on = n.id === selected.id;
          return (
            <g
              key={n.id}
              className={`node ${n.lane}${on ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${n.title}: ${n.sub}`}
              onClick={() => setSelected(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(n);
                }
              }}
            >
              <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={8} />
              <text className="t1" x={x + BOX_W / 2} y={y + 22} textAnchor="middle">{n.title}</text>
              <text className="t2" x={x + BOX_W / 2} y={y + 40} textAnchor="middle">{n.sub}</text>
            </g>
          );
        })}

        {[0, 1, 2].map((c) => (
          <g key={c}>
            <line className="arr run" x1={X0 + c * STEP + BOX_W} y1={Y.run + 28} x2={X0 + (c + 1) * STEP - 2} y2={Y.run + 28} markerEnd="url(#arrow)" />
            <line className="arr ship" x1={X0 + c * STEP + BOX_W} y1={Y.ship + 28} x2={X0 + (c + 1) * STEP - 2} y2={Y.ship + 28} markerEnd="url(#arrow)" />
          </g>
        ))}
        <line className="arr ship" x1={X0 + 3 * STEP + BOX_W / 2} y1={Y.ship - 2} x2={X0 + 3 * STEP + BOX_W / 2} y2={Y.run + BOX_H + 4} markerEnd="url(#arrow)" />
      </svg>

      <div className="detail">
        <div className="detail-head">
          <h3>{selected.title}</h3>
          <span className="muted">Shows: {selected.skill}</span>
        </div>
        <p>{selected.desc}</p>
        <pre>{selected.code}</pre>
        <p className="muted small">
          {selected.source.kind === "repo" ? (
            <>
              Excerpt from <code>{selected.source.path}</code> in this repository.
            </>
          ) : (
            <>Simplified excerpt: {selected.source.note}. Not a copy of the real file.</>
          )}
        </p>
      </div>
    </div>
  );
}
