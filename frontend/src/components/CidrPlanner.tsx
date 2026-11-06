import { useMemo, useRef, useState } from "react";
import {
  MIN_BLOCK_PREFIX,
  VNET_MAX_PREFIX,
  VNET_MIN_PREFIX,
  cidrText,
  formatIpv4,
  isPrivate,
  lastOf,
  maskOf,
  parseCidr,
  planSubnets,
  relation,
  sizeOf,
  toBits,
  wildcardOf,
  type Mode,
  type PlannedSubnet,
  type SubnetRequest,
} from "../lab/cidr";
import { DEFAULT_PEER, PRESETS, type Preset } from "../lab/presets";

const BAR_W = 640;
const COLORS = 6;
const MAX_ROWS = 12;

const nf = new Intl.NumberFormat("en");
const num = (n: number) => nf.format(n);

function fromPreset(p: Preset, nextId: { current: number }): SubnetRequest[] {
  return p.rows.map((r) => ({ ...r, id: nextId.current++ }));
}

export function CidrPlanner(props: { vnet: string; onVnet: (v: string) => void }) {
  const { vnet, onVnet } = props;
  const nextId = useRef(1);
  const [mode, setMode] = useState<Mode>("azure");
  const [rows, setRows] = useState<SubnetRequest[]>(() => fromPreset(PRESETS[0], nextId));
  const [selected, setSelected] = useState<number | null>(null);
  const [peer, setPeer] = useState(DEFAULT_PEER);

  const plan = useMemo(() => planSubnets(vnet, rows, mode), [vnet, rows, mode]);
  const colorOf = (id: number) => `c${Math.max(0, rows.findIndex((r) => r.id === id)) % COLORS}`;
  const placed = plan.subnets.filter((s) => s.status === "placed");
  const current = placed.find((s) => s.id === selected) ?? placed[0] ?? null;

  const update = (id: number, patch: Partial<SubnetRequest>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));
  const add = () =>
    setRows((rs) =>
      rs.length >= MAX_ROWS ? rs : [...rs, { id: nextId.current++, name: `subnet-${rs.length + 1}`, by: "prefix", value: String(Math.min(26, MIN_BLOCK_PREFIX[mode])) }],
    );
  const applyPreset = (p: Preset) => {
    onVnet(p.vnet);
    setRows(fromPreset(p, nextId));
    setSelected(null);
    setMode("azure");
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    // Keep every row legal in the new mode: a /30 is fine in generic mode but not in Azure.
    setRows((rs) =>
      rs.map((r) => {
        if (r.by !== "prefix") return r;
        const n = Number(r.value.trim().replace(/^\//, ""));
        return Number.isInteger(n) && n > MIN_BLOCK_PREFIX[m] ? { ...r, value: String(MIN_BLOCK_PREFIX[m]) } : r;
      }),
    );
  };

  const vnetOk = plan.vnet.ok;
  const failed = plan.subnets.filter((s) => s.status === "no-space");

  return (
    <div className="lab">
      <div className="row">
        <span className="muted small">Examples:</span>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => applyPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="lab-grid">
        <div>
          <label className="lab-label" htmlFor="lab-vnet">
            Address space of the virtual network
          </label>
          <input
            id="lab-vnet"
            className="mono"
            value={vnet}
            onChange={(e) => onVnet(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!vnetOk}
            aria-describedby="lab-vnet-msg"
          />
        </div>
        <div>
          <span className="lab-label" id="lab-mode-label">
            Counting rules
          </span>
          <div className="lab-toggle" role="group" aria-labelledby="lab-mode-label">
            <button type="button" aria-pressed={mode === "azure"} onClick={() => switchMode("azure")}>
              Azure
            </button>
            <button type="button" aria-pressed={mode === "generic"} onClick={() => switchMode("generic")}>
              Generic IPv4
            </button>
          </div>
        </div>
      </div>
      <p id="lab-vnet-msg" className={plan.vnet.ok ? "note" : "note lab-error"}>
        {plan.vnet.ok
          ? vnetNote(plan.vnet.cidr, plan.vnet.normalized, plan.vnet.given)
          : plan.vnet.error}
      </p>

      <h3 className="sub">Subnets</h3>
      <ul className="lab-rows">
        {rows.map((r) => {
          const res = plan.subnets.find((s) => s.id === r.id);
          return (
            <li key={r.id}>
              <div className="lab-row">
                <input
                  aria-label="Subnet name"
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  maxLength={40}
                  spellCheck={false}
                  autoComplete="off"
                />
                <select aria-label="Size given as" value={r.by} onChange={(e) => update(r.id, { by: e.target.value as "prefix" | "hosts" })}>
                  <option value="prefix">prefix /</option>
                  <option value="hosts">hosts</option>
                </select>
                <input
                  className="lab-value mono"
                  aria-label={r.by === "prefix" ? "Prefix length" : "Number of hosts"}
                  inputMode="numeric"
                  value={r.value}
                  onChange={(e) => update(r.id, { value: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={res?.status === "invalid"}
                />
                <button type="button" onClick={() => remove(r.id)} aria-label={`Remove ${res?.name ?? "subnet"}`}>
                  Remove
                </button>
              </div>
              {res?.status === "invalid" && <p className="lab-error small">{res.message}</p>}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button type="button" onClick={add} disabled={rows.length >= MAX_ROWS}>
          Add subnet
        </button>
        <span className="muted small">
          Largest first, packed from the start of the address space.
          {mode === "azure" ? " Azure subnets run from /29 up." : " Generic mode allows down to /30."}
        </span>
      </div>

      {plan.vnet.ok && (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Address space</div>
              <div className="tile-value mono">{num(plan.total)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">In subnets</div>
              <div className="tile-value mono">{num(plan.allocated)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Free</div>
              <div className="tile-value mono">{num(plan.free)}</div>
            </div>
          </div>

          <AddressBar plan={plan} colorOf={colorOf} selectedId={current?.id ?? null} onSelect={setSelected} />

          {failed.length > 0 && (
            <ul className="lab-fails">
              {failed.map((s) => (
                <li key={s.id} className="lab-error">
                  <strong>{s.name}</strong>: {s.message}
                </li>
              ))}
            </ul>
          )}

          {placed.length > 0 && (
            <div className="lab-tablewrap">
              <table className="lab-table">
                <thead>
                  <tr>
                    <th>Subnet</th>
                    <th>CIDR</th>
                    <th>Address range</th>
                    <th>Addresses</th>
                    <th>Usable hosts</th>
                  </tr>
                </thead>
                <tbody>
                  {placed
                    .slice()
                    .sort((a, b) => a.cidr!.base - b.cidr!.base)
                    .map((s) => (
                      <tr key={s.id} className={s.id === current?.id ? "sel" : undefined}>
                        <td data-label="Subnet">
                          <button type="button" className={`row-pick ${colorOf(s.id)}`} onClick={() => setSelected(s.id)} aria-pressed={s.id === current?.id}>
                            <span className="lab-swatch" aria-hidden="true" />
                            {s.name}
                          </button>
                        </td>
                        <td data-label="CIDR" className="mono">{cidrText(s.cidr!)}</td>
                        <td data-label="Address range" className="mono">
                          {formatIpv4(s.cidr!.base)} – {formatIpv4(lastOf(s.cidr!))}
                        </td>
                        <td data-label="Addresses" className="mono">{num(s.size!)}</td>
                        <td data-label="Usable hosts" className="mono">{num(s.usable!)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {current && <BitView s={current} mode={mode} />}
        </>
      )}

      <Peering vnetText={vnet} peer={peer} onPeer={setPeer} />
      <p className="note">Everything here is calculated in your browser. Nothing you type is sent anywhere.</p>
    </div>
  );
}

function vnetNote(c: { base: number; prefix: number }, normalized: boolean, given: string): string {
  const parts: string[] = [];
  if (normalized) parts.push(`${given} has host bits set, so it was read as ${cidrText(c)}.`);
  parts.push(isPrivate(c) ? "A private (RFC 1918) range." : "Not an RFC 1918 private range. Virtual networks normally use one.");
  return parts.join(" ");
}

function AddressBar(props: {
  plan: ReturnType<typeof planSubnets>;
  colorOf: (id: number) => string;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { plan } = props;
  if (!plan.vnet.ok) return null;
  const v = plan.vnet.cidr;
  const placed = plan.subnets.filter((s): s is PlannedSubnet & { cidr: NonNullable<PlannedSubnet["cidr"]> } => s.status === "placed" && !!s.cidr);
  const xOf = (addr: number) => ((addr - v.base) / plan.total) * BAR_W;
  const tailX = placed.length ? Math.max(...placed.map((s) => xOf(s.cidr.base + sizeOf(s.cidr.prefix)))) : 0;

  return (
    <div>
      <svg className="lab-bar" viewBox="0 0 640 56" role="group" aria-label={`The address space ${cidrText(v)} split into subnets`}>
        <rect className="lab-bar-free" x={0.5} y={10} width={BAR_W - 1} height={36} rx={4} />
        {BAR_W - tailX > 70 && (
          <text className="lab-bar-free-text" x={(tailX + BAR_W) / 2} y={32} textAnchor="middle">
            free
          </text>
        )}
        {placed.map((s) => {
          const x = xOf(s.cidr.base);
          const w = Math.max((sizeOf(s.cidr.prefix) / plan.total) * BAR_W, 2);
          const label = s.name.length * 7.2 + 10 <= w ? s.name : w >= 34 ? `/${s.cidr.prefix}` : "";
          const sel = s.id === props.selectedId;
          return (
            <g
              key={s.id}
              className={`lab-blk ${props.colorOf(s.id)}${sel ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${s.name}, ${cidrText(s.cidr)}`}
              aria-pressed={sel}
              onClick={() => props.onSelect(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onSelect(s.id);
                }
              }}
            >
              <rect x={x} y={10} width={w} height={36} rx={3} />
              {label && (
                <text className="lab-bar-text" x={x + w / 2} y={32} textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="lab-axis mono muted">
        <span>{formatIpv4(v.base)}</span>
        <span>{formatIpv4(lastOf(v))}</span>
      </div>
    </div>
  );
}

function BitView(props: { s: PlannedSubnet; mode: Mode }) {
  const { s, mode } = props;
  const c = s.cidr!;
  const bits = toBits(c.base);
  const octets = [0, 1, 2, 3].map((o) => ({
    bits: bits.slice(o * 8, o * 8 + 8).split(""),
    value: (c.base >>> (24 - o * 8)) & 255,
    offset: o * 8,
  }));
  return (
    <div className="detail">
      <div className="detail-head">
        <h3>
          {s.name} <span className="mono muted">{cidrText(c)}</span>
        </h3>
        <span className="muted small mono">
          mask {formatIpv4(maskOf(c.prefix))} · wildcard {formatIpv4(wildcardOf(c.prefix))}
        </span>
      </div>
      <div className="bits" role="img" aria-label={`The first ${c.prefix} of 32 bits are the network part, the remaining ${32 - c.prefix} identify hosts.`}>
        {octets.map((o) => (
          <div key={o.offset} className="octet">
            <div className="octet-bits mono">
              {o.bits.map((b, i) => (
                <span key={i} className={o.offset + i < c.prefix ? "bit net" : "bit host"}>
                  {b}
                </span>
              ))}
            </div>
            <div className="octet-val mono muted">{o.value}</div>
          </div>
        ))}
      </div>
      <p className="note">
        <span className="bit net key">network</span> the first {c.prefix} bits are fixed for every address in the subnet.{" "}
        <span className="bit host key">host</span> the other {32 - c.prefix} bits count through {num(sizeOf(c.prefix))} addresses.
      </p>
      <p className="note">
        {num(s.usable!)} of them can go to hosts.{" "}
        {mode === "azure"
          ? "Azure reserves 5 addresses in every subnet: the first four (the network address, the default gateway and two for Azure DNS) and the last one."
          : "The first address names the network and the last one is the broadcast address."}
      </p>
    </div>
  );
}

function Peering(props: { vnetText: string; peer: string; onPeer: (v: string) => void }) {
  const a = parseCidr(props.vnetText, VNET_MIN_PREFIX, VNET_MAX_PREFIX);
  const b = parseCidr(props.peer, VNET_MIN_PREFIX, VNET_MAX_PREFIX);
  let verdict: { ok: boolean; text: string } | null = null;
  if (a.ok && b.ok) {
    const r = relation(a.cidr, b.cidr);
    verdict =
      r === "disjoint"
        ? { ok: true, text: `${cidrText(a.cidr)} and ${cidrText(b.cidr)} do not overlap, so their address spaces can be peered.` }
        : {
            ok: false,
            text:
              r === "same"
                ? "These are the same address space, so the networks overlap and cannot be peered."
                : `${r === "a-contains-b" ? cidrText(a.cidr) : cidrText(b.cidr)} contains ${r === "a-contains-b" ? cidrText(b.cidr) : cidrText(a.cidr)}, so the networks overlap and cannot be peered.`,
          };
  }
  return (
    <>
      <h3 className="sub">Can two networks be peered?</h3>
      <p className="note">Peering needs address spaces that do not overlap. Compare the one above with another.</p>
      <div className="lab-grid">
        <div>
          <label className="lab-label" htmlFor="lab-peer">
            Other address space
          </label>
          <input id="lab-peer" className="mono" value={props.peer} onChange={(e) => props.onPeer(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!b.ok} />
        </div>
      </div>
      <p className={verdict ? (verdict.ok ? "note lab-ok" : "note lab-error") : "note lab-error"} aria-live="polite">
        {verdict ? verdict.text : !a.ok ? "Fix the first address space above." : !b.ok ? b.error : ""}
      </p>
    </>
  );
}
