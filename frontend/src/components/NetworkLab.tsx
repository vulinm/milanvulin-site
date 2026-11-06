import { useState } from "react";
import { PRESETS } from "../lab/presets";
import { CidrPlanner } from "./CidrPlanner";

type Tab = { id: string; label: string };

// More tabs (NSG evaluator, DNS and TLS steppers) are added here as they are built.
const TABS: Tab[] = [{ id: "cidr", label: "CIDR planner" }];

// Starts on the first example, so the planner opens with rows and address space that belong together.
const DEFAULT_VNET = PRESETS[0].vnet;

export function NetworkLab() {
  const [tab, setTab] = useState(TABS[0].id);
  // The address space is shared between tabs, so a later tab can resolve "VirtualNetwork" from it.
  const [vnet, setVnet] = useState(DEFAULT_VNET);

  const tabbed = TABS.length > 1;
  const panelProps = tabbed ? { role: "tabpanel", id: `lab-panel-${tab}`, "aria-labelledby": `lab-tab-${tab}` } : {};

  return (
    <div>
      {tabbed && (
        <div className="lab-tabs" role="tablist" aria-label="Network lab tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`lab-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`lab-panel-${t.id}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div {...panelProps}>
        {tab === "cidr" && <CidrPlanner vnet={vnet} onVnet={setVnet} />}
      </div>
    </div>
  );
}
