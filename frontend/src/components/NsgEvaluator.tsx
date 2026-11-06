import { useMemo, useRef, useState } from "react";
import { VNET_MAX_PREFIX, VNET_MIN_PREFIX, formatIpv4, parseCidr } from "../lab/cidr";
import {
  MAX_PRIORITY,
  MIN_PRIORITY,
  analyseRules,
  evaluate,
  parsePacket,
  type Action,
  type Check,
  type Context,
  type Direction,
  type PacketInput,
  type Protocol,
  type Rule,
  type RuleInput,
} from "../lab/nsg";
import { NSG_PRESETS, VM, type NsgPreset } from "../lab/nsgPresets";

const MAX_RULES = 10;
const DIMS = ["source", "destination", "port", "protocol"] as const;

/** The first address Azure hands to a machine in a subnet is the fourth one, so use that as an example VM. */
function vmAddress(vnetText: string): string {
  const p = parseCidr(vnetText, VNET_MIN_PREFIX, VNET_MAX_PREFIX);
  return p.ok ? formatIpv4(p.cidr.base + 4) : "10.20.0.4";
}

function resolve(preset: NsgPreset, vm: string): PacketInput {
  const fill = (s: string) => (s === VM ? vm : s);
  return { ...preset.packet, source: fill(preset.packet.source), destination: fill(preset.packet.destination) };
}

function describe(r: Rule): string {
  const proto = r.protocol === "Any" ? "any protocol" : r.protocol;
  return `${r.text.source} → ${r.text.destination} · ${proto}, port ${r.text.port}`;
}

export function NsgEvaluator(props: { vnet: string; onVnet: (v: string) => void }) {
  const { vnet, onVnet } = props;
  const nextId = useRef(1);
  const fromPreset = (p: NsgPreset): RuleInput[] => p.rules.map((r) => ({ ...r, id: nextId.current++ }));
  const [rules, setRules] = useState<RuleInput[]>(() => fromPreset(NSG_PRESETS[0]));
  const [packet, setPacket] = useState<PacketInput>(() => resolve(NSG_PRESETS[0], vmAddress(vnet)));

  const parsedVnet = useMemo(() => parseCidr(vnet, VNET_MIN_PREFIX, VNET_MAX_PREFIX), [vnet]);
  const ctx: Context = useMemo(() => ({ vnet: parsedVnet.ok ? parsedVnet.cidr : null }), [parsedVnet]);
  const reports = useMemo(() => analyseRules(rules, ctx), [rules, ctx]);
  const parsedPacket = useMemo(() => parsePacket(packet), [packet]);

  const valid = useMemo(() => rules.map((r) => reports.get(r.id)?.rule).filter((r): r is Rule => !!r), [rules, reports]);
  const skipped = rules.length - valid.length;
  const result = useMemo(() => (ctx.vnet && "packet" in parsedPacket ? evaluate(valid, parsedPacket.packet, ctx) : null), [valid, parsedPacket, ctx]);

  const update = (id: number, patch: Partial<RuleInput>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => setRules((rs) => rs.filter((r) => r.id !== id));
  const add = () =>
    setRules((rs) => {
      if (rs.length >= MAX_RULES) return rs;
      const used = new Set(rs.filter((r) => r.direction === "Inbound").map((r) => r.priority.trim()));
      let p = 100;
      while (used.has(String(p))) p += 10;
      return [...rs, { id: nextId.current++, name: `rule-${rs.length + 1}`, priority: String(p), direction: "Inbound", source: "*", destination: "*", port: "*", protocol: "Any", action: "Allow" }];
    });
  const applyPreset = (p: NsgPreset) => {
    setRules(fromPreset(p));
    setPacket(resolve(p, vmAddress(vnet)));
  };
  const setP = (patch: Partial<PacketInput>) => setPacket((p) => ({ ...p, ...patch }));

  return (
    <div className="lab">
      <div className="row">
        <span className="muted small">Examples:</span>
        {NSG_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => applyPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="lab-grid">
        <div>
          <label className="lab-label" htmlFor="nsg-vnet">
            Address space of the virtual network (shared with the CIDR planner)
          </label>
          <input id="nsg-vnet" className="mono" value={vnet} onChange={(e) => onVnet(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!parsedVnet.ok} />
        </div>
      </div>
      <p className={parsedVnet.ok ? "note" : "note lab-error"}>
        {parsedVnet.ok
          ? "The VirtualNetwork tag means this address space. Internet means any other address."
          : `${parsedVnet.error} The tags need a valid address space.`}
      </p>

      <h3 className="sub">Your rules</h3>
      <ul className="nsg-rules">
        {rules.map((r) => {
          const rep = reports.get(r.id);
          const e = rep?.errors ?? {};
          return (
            <li key={r.id} className="nsg-rule">
              <div className="nsg-top">
                <input className="nsg-prio mono" aria-label="Priority" placeholder="100" inputMode="numeric" value={r.priority} onChange={(ev) => update(r.id, { priority: ev.target.value })} aria-invalid={!!e.priority || !!rep?.duplicatePriority} spellCheck={false} autoComplete="off" />
                <input className="nsg-name" aria-label="Rule name" value={r.name} maxLength={40} onChange={(ev) => update(r.id, { name: ev.target.value })} spellCheck={false} autoComplete="off" />
                <select aria-label="Direction" value={r.direction} onChange={(ev) => update(r.id, { direction: ev.target.value as Direction })}>
                  <option>Inbound</option>
                  <option>Outbound</option>
                </select>
                <select aria-label="Protocol" value={r.protocol} onChange={(ev) => update(r.id, { protocol: ev.target.value as Protocol })}>
                  <option value="Any">Any</option>
                  <option>TCP</option>
                  <option>UDP</option>
                  <option>ICMP</option>
                </select>
                <select aria-label="Action" value={r.action} onChange={(ev) => update(r.id, { action: ev.target.value as Action })}>
                  <option>Allow</option>
                  <option>Deny</option>
                </select>
                <button type="button" onClick={() => remove(r.id)} aria-label={`Remove ${r.name || "rule"}`}>
                  Remove
                </button>
              </div>
              <div className="nsg-match">
                <label>
                  <span className="lab-label">Source</span>
                  <input className="mono" value={r.source} onChange={(ev) => update(r.id, { source: ev.target.value })} aria-invalid={!!e.source} spellCheck={false} autoComplete="off" />
                </label>
                <label>
                  <span className="lab-label">Destination</span>
                  <input className="mono" value={r.destination} onChange={(ev) => update(r.id, { destination: ev.target.value })} aria-invalid={!!e.destination} spellCheck={false} autoComplete="off" />
                </label>
                <label>
                  <span className="lab-label">Destination port</span>
                  <input className="mono" value={r.port} onChange={(ev) => update(r.id, { port: ev.target.value })} aria-invalid={!!e.port} spellCheck={false} autoComplete="off" />
                </label>
              </div>
              {Object.entries(e).map(([k, msg]) => (
                <p key={k} className="lab-error small">
                  {msg}
                </p>
              ))}
              {rep?.duplicatePriority && (
                <p className="lab-error small">
                  Another {r.direction.toLowerCase()} rule uses priority {r.priority.trim()}. Azure needs a different number for each rule in a direction.
                </p>
              )}
              {rep?.shadowedBy && rep.rule && (
                <p className="lab-warn small">
                  Never reached: {rep.shadowedBy.name} (priority {rep.shadowedBy.priority}) already matches everything this rule matches and{" "}
                  {rep.shadowedBy.action === "Allow" ? "allows" : "denies"} it
                  {rep.shadowedBy.action !== rep.rule.action ? `, so this ${rep.rule.action} never applies.` : ", so this rule changes nothing."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button type="button" onClick={add} disabled={rules.length >= MAX_RULES}>
          Add rule
        </button>
        <span className="muted small">
          Priority runs from {MIN_PRIORITY} to {MAX_PRIORITY}, lowest number first. Azure's default rules always sit below yours.
        </span>
      </div>

      <h3 className="sub">Test a packet</h3>
      <div className="nsg-packet">
        <label>
          <span className="lab-label">Direction</span>
          <select value={packet.direction} onChange={(e) => setP({ direction: e.target.value as Direction })}>
            <option>Inbound</option>
            <option>Outbound</option>
          </select>
        </label>
        <label>
          <span className="lab-label">Source address</span>
          <input className="mono" value={packet.source} onChange={(e) => setP({ source: e.target.value })} aria-invalid={"errors" in parsedPacket && !!parsedPacket.errors.source} spellCheck={false} autoComplete="off" />
        </label>
        <label>
          <span className="lab-label">Destination address</span>
          <input className="mono" value={packet.destination} onChange={(e) => setP({ destination: e.target.value })} aria-invalid={"errors" in parsedPacket && !!parsedPacket.errors.destination} spellCheck={false} autoComplete="off" />
        </label>
        <label>
          <span className="lab-label">Protocol</span>
          <select value={packet.protocol} onChange={(e) => setP({ protocol: e.target.value as PacketInput["protocol"] })}>
            <option>TCP</option>
            <option>UDP</option>
            <option>ICMP</option>
          </select>
        </label>
        <label>
          <span className="lab-label">Destination port</span>
          <input className="mono" value={packet.protocol === "ICMP" ? "" : packet.port} disabled={packet.protocol === "ICMP"} placeholder={packet.protocol === "ICMP" ? "none" : ""} inputMode="numeric" onChange={(e) => setP({ port: e.target.value })} aria-invalid={"errors" in parsedPacket && !!parsedPacket.errors.port} spellCheck={false} autoComplete="off" />
        </label>
      </div>
      {"errors" in parsedPacket &&
        Object.values(parsedPacket.errors).map((m) => (
          <p key={m} className="lab-error small">
            {m}
          </p>
        ))}

      {result && result.verdict && (
        <>
          <div className={`nsg-verdict ${result.verdict.action === "Allow" ? "ok" : "bad"}`} role="status" aria-live="polite">
            <strong>{result.verdict.action}</strong>
            <span>
              {" "}
              by {result.verdict.rule.name} (priority {result.verdict.rule.priority})
              {result.verdict.rule.isDefault ? ", one of Azure's default rules" : ""}
            </span>
          </div>
          <p className="note">
            Rules are checked from the lowest priority number up, and the first one that matches decides. The rest are not looked at.
            {skipped > 0 ? ` ${skipped} rule${skipped === 1 ? "" : "s"} with errors ${skipped === 1 ? "was" : "were"} left out.` : ""}
          </p>
          <ol className="nsg-checks">
            {result.checks.map((c) => (
              <CheckRow key={c.rule.id} c={c} win={c.rule.id === result.verdict!.rule.id} />
            ))}
          </ol>
        </>
      )}

      <p className="note">
        <span className="tag des">simplified</span> Source ports count as any. VirtualNetwork is the address space above, so peered and on-premises ranges are
        not modelled, and application security groups, other service tags, user-defined routes and firewalls are left out. Azure lets the reply to an allowed
        flow back in on its own, so this checks one direction at a time. Everything is calculated in your browser.
      </p>
    </div>
  );
}

function CheckRow(props: { c: Check; win: boolean }) {
  const { c, win } = props;
  const cls = ["nsg-check", win ? "win" : "", c.evaluated ? "" : "skip"].filter(Boolean).join(" ");
  return (
    <li className={cls}>
      <div className="nsg-check-head">
        <span className="mono nsg-check-prio">{c.rule.priority}</span>
        <strong>{c.rule.name}</strong>
        {c.rule.isDefault && <span className="tag des">default</span>}
        <span className={`nsg-act ${c.rule.action === "Allow" ? "ok" : "bad"}`}>{c.rule.action}</span>
        {win && <span className="tag obs">matched</span>}
      </div>
      <div className="muted small mono">{describe(c.rule)}</div>
      {c.dims ? (
        <ul className="nsg-dims">
          {DIMS.map((d) => (
            <li key={d} className={c.dims![d].ok ? "ok" : "bad"}>
              <span>
                {c.dims![d].ok ? "✓" : "✗"} {d}
              </span>
              {!c.dims![d].ok && <span className="muted small"> {c.dims![d].why}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small nsg-skip">Not checked: a rule above already decided.</p>
      )}
    </li>
  );
}
