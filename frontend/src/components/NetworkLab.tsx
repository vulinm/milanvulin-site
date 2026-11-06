import { useRef, useState } from "react";
import { PRESETS } from "../lab/presets";
import { CidrPlanner } from "./CidrPlanner";
import { NsgEvaluator } from "./NsgEvaluator";

type Tab = { id: string; label: string };

// More tabs (DNS and TLS steppers) are added here as they are built.
const TABS: Tab[] = [
  { id: "cidr", label: "CIDR planner" },
  { id: "nsg", label: "NSG evaluator" },
];

// Starts on the first example, so the planner opens with rows and address space that belong together.
const DEFAULT_VNET = PRESETS[0].vnet;

export function NetworkLab() {
  const [tab, setTab] = useState(TABS[0].id);
  // The address space is shared between tabs, so the NSG tab can resolve "VirtualNetwork" from it.
  const [vnet, setVnet] = useState(DEFAULT_VNET);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Arrow keys move between tabs, as the tab pattern expects.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length];
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <div>
      <div className="lab-tabs" role="tablist" aria-label="Network lab tools">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`lab-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`lab-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted and is only hidden, so what you typed in a tab is still there when you come back. */}
      <div role="tabpanel" id="lab-panel-cidr" aria-labelledby="lab-tab-cidr" hidden={tab !== "cidr"}>
        <CidrPlanner vnet={vnet} onVnet={setVnet} />
      </div>
      <div role="tabpanel" id="lab-panel-nsg" aria-labelledby="lab-tab-nsg" hidden={tab !== "nsg"}>
        <NsgEvaluator vnet={vnet} onVnet={setVnet} />
      </div>
    </div>
  );
}
