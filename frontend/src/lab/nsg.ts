// Pure network security group (NSG) logic for the network lab: rules, tags and first-match
// evaluation. No DOM, no React. Simplified on purpose: source ports are treated as any, and the
// VirtualNetwork tag means the one address space entered in the lab (peered and on-premises ranges
// are not modelled).

import { cidrText, formatIpv4, maskOf, parseCidr, parseIpv4, relation, type Cidr } from "./cidr";

export type Direction = "Inbound" | "Outbound";
export type Protocol = "Any" | "TCP" | "UDP" | "ICMP";
export type Action = "Allow" | "Deny";
export type Tag = "VirtualNetwork" | "Internet" | "AzureLoadBalancer";

export const MIN_PRIORITY = 100;
export const MAX_PRIORITY = 4096;

/** The virtual IP Azure uses for load balancer probes (and DNS). The AzureLoadBalancer tag is this address. */
export const AZURE_LB_IP = parseIpv4("168.63.129.16")!;

export type RuleInput = {
  id: number;
  name: string;
  priority: string;
  direction: Direction;
  source: string;
  destination: string;
  port: string;
  protocol: Protocol;
  action: Action;
};

export type Endpoint = { kind: "any" } | { kind: "tag"; tag: Tag } | { kind: "cidr"; cidr: Cidr };
export type PortRange = [number, number];
export type Ports = { kind: "any" } | { kind: "ranges"; ranges: PortRange[] };

export type Rule = {
  id: number;
  name: string;
  priority: number;
  direction: Direction;
  source: Endpoint;
  destination: Endpoint;
  ports: Ports;
  protocol: Protocol;
  action: Action;
  isDefault: boolean;
  /** The text as typed, for display. */
  text: { source: string; destination: string; port: string };
};

export type Context = { vnet: Cidr | null };

const TAGS: Record<string, Tag> = {
  virtualnetwork: "VirtualNetwork",
  internet: "Internet",
  azureloadbalancer: "AzureLoadBalancer",
};

export function parseEndpoint(text: string): Endpoint | { error: string } {
  const t = text.trim();
  if (t === "" || t === "*" || t.toLowerCase() === "any") return { kind: "any" };
  const tag = TAGS[t.toLowerCase()];
  if (tag) return { kind: "tag", tag };
  const withPrefix = t.includes("/") ? t : `${t}/32`;
  const c = parseCidr(withPrefix, 0, 32);
  if (c.ok) return { kind: "cidr", cidr: c.cidr };
  return { error: "Use *, a tag (VirtualNetwork, Internet, AzureLoadBalancer), an address or a CIDR such as 10.0.0.0/24." };
}

export function parsePorts(text: string): Ports | { error: string } {
  const t = text.trim();
  if (t === "" || t === "*") return { kind: "any" };
  const ranges: PortRange[] = [];
  for (const item of t.split(",")) {
    const m = /^\s*(\d{1,5})\s*(?:-\s*(\d{1,5}))?\s*$/.exec(item);
    if (!m) return { error: "Use * or ports like 443, 80,443 or 1024-65535." };
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (lo > 65535 || hi > 65535 || lo > hi) return { error: "Ports run from 0 to 65535, and a range goes from low to high." };
    ranges.push([lo, hi]);
  }
  return { kind: "ranges", ranges };
}

export type RuleErrors = Partial<Record<"priority" | "source" | "destination" | "port", string>>;

export function compileRule(r: RuleInput): { rule: Rule } | { errors: RuleErrors } {
  const errors: RuleErrors = {};
  const pr = r.priority.trim();
  const priority = /^\d+$/.test(pr) ? Number(pr) : NaN;
  if (!(priority >= MIN_PRIORITY && priority <= MAX_PRIORITY)) {
    errors.priority = `Priority is a whole number from ${MIN_PRIORITY} to ${MAX_PRIORITY}.`;
  }
  const source = parseEndpoint(r.source);
  if ("error" in source) errors.source = source.error;
  const destination = parseEndpoint(r.destination);
  if ("error" in destination) errors.destination = destination.error;
  const ports = parsePorts(r.port);
  if ("error" in ports) errors.port = ports.error;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    rule: {
      id: r.id,
      name: r.name.trim() || `rule-${r.id}`,
      priority,
      direction: r.direction,
      source: source as Endpoint,
      destination: destination as Endpoint,
      ports: ports as Ports,
      protocol: r.protocol,
      action: r.action,
      isDefault: false,
      text: { source: r.source.trim() || "*", destination: r.destination.trim() || "*", port: r.port.trim() || "*" },
    },
  };
}

function def(id: number, name: string, priority: number, direction: Direction, source: string, destination: string, action: Action): Rule {
  // Custom rules stop at 4096, so compile with a legal number and set the real priority afterwards.
  const out = compileRule({ id, name, priority: String(MIN_PRIORITY), direction, source, destination, port: "*", protocol: "Any", action });
  if (!("rule" in out)) throw new Error(`bad default rule ${name}`);
  return { ...out.rule, isDefault: true, priority };
}

/** The rules Azure adds to every NSG. They cannot be edited and always sit below the custom ones. */
export const DEFAULT_RULES: Rule[] = [
  def(-1, "AllowVnetInBound", 65000, "Inbound", "VirtualNetwork", "VirtualNetwork", "Allow"),
  def(-2, "AllowAzureLoadBalancerInBound", 65001, "Inbound", "AzureLoadBalancer", "*", "Allow"),
  def(-3, "DenyAllInBound", 65500, "Inbound", "*", "*", "Deny"),
  def(-4, "AllowVnetOutBound", 65000, "Outbound", "VirtualNetwork", "VirtualNetwork", "Allow"),
  def(-5, "AllowInternetOutBound", 65001, "Outbound", "*", "Internet", "Allow"),
  def(-6, "DenyAllOutBound", 65500, "Outbound", "*", "*", "Deny"),
];

function inCidr(ip: number, c: Cidr): boolean {
  return ((ip & maskOf(c.prefix)) >>> 0) === c.base;
}

function inVnet(ip: number, ctx: Context): boolean {
  return ctx.vnet !== null && inCidr(ip, ctx.vnet);
}

export function endpointMatches(ip: number, ep: Endpoint, ctx: Context): boolean {
  switch (ep.kind) {
    case "any":
      return true;
    case "cidr":
      return inCidr(ip, ep.cidr);
    case "tag":
      if (ep.tag === "VirtualNetwork") return inVnet(ip, ctx);
      if (ep.tag === "AzureLoadBalancer") return ip === AZURE_LB_IP;
      return ctx.vnet !== null && !inVnet(ip, ctx) && ip !== AZURE_LB_IP;
  }
}

function endpointWhy(ip: number, ep: Endpoint, ctx: Context): string {
  const a = formatIpv4(ip);
  if (ep.kind === "cidr") return `${a} is not in ${cidrText(ep.cidr)}`;
  if (ep.kind === "tag") {
    if (ep.tag === "VirtualNetwork") return `${a} is not in the virtual network${ctx.vnet ? ` (${cidrText(ctx.vnet)})` : ""}`;
    if (ep.tag === "AzureLoadBalancer") return `${a} is not ${formatIpv4(AZURE_LB_IP)}, the load balancer address`;
    return ip === AZURE_LB_IP ? `${a} is the Azure load balancer address, not Internet` : `${a} is inside the virtual network, so it is not Internet`;
  }
  return "";
}

export function portMatches(port: number | null, ports: Ports): boolean {
  if (ports.kind === "any") return true;
  if (port === null) return false;
  return ports.ranges.some(([lo, hi]) => port >= lo && port <= hi);
}

function protocolMatches(packet: Protocol, rule: Protocol): boolean {
  return rule === "Any" || rule === packet;
}

export type PacketInput = { direction: Direction; source: string; destination: string; port: string; protocol: Exclude<Protocol, "Any"> };
export type Packet = { direction: Direction; source: number; destination: number; port: number | null; protocol: Exclude<Protocol, "Any"> };
export type PacketErrors = Partial<Record<"source" | "destination" | "port", string>>;

export function parsePacket(p: PacketInput): { packet: Packet } | { errors: PacketErrors } {
  const errors: PacketErrors = {};
  const source = parseIpv4(p.source);
  const destination = parseIpv4(p.destination);
  if (source === null) errors.source = "Enter an address like 203.0.113.7.";
  if (destination === null) errors.destination = "Enter an address like 10.0.0.4.";
  let port: number | null = null;
  if (p.protocol !== "ICMP") {
    const t = p.port.trim();
    port = /^\d{1,5}$/.test(t) ? Number(t) : NaN;
    if (!(port >= 0 && port <= 65535)) errors.port = "Enter a port from 0 to 65535.";
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { packet: { direction: p.direction, source: source!, destination: destination!, port, protocol: p.protocol } };
}

export type Dim = { ok: boolean; why: string };
export type Check = {
  rule: Rule;
  /** False for rules after the winner: Azure never looks at them. */
  evaluated: boolean;
  matched: boolean;
  dims: { source: Dim; destination: Dim; port: Dim; protocol: Dim } | null;
};
export type Evaluation = {
  checks: Check[];
  verdict: { action: Action; rule: Rule } | null;
};

const OK: Dim = { ok: true, why: "" };

/** Walks the rules for the packet's direction from the lowest priority number up and stops at the first match. */
export function evaluate(custom: Rule[], packet: Packet, ctx: Context): Evaluation {
  const rules = [...custom, ...DEFAULT_RULES]
    .filter((r) => r.direction === packet.direction)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.priority - b.r.priority || a.i - b.i)
    .map((x) => x.r);

  const checks: Check[] = [];
  let verdict: Evaluation["verdict"] = null;
  for (const rule of rules) {
    if (verdict) {
      checks.push({ rule, evaluated: false, matched: false, dims: null });
      continue;
    }
    const src = endpointMatches(packet.source, rule.source, ctx);
    const dst = endpointMatches(packet.destination, rule.destination, ctx);
    const port = portMatches(packet.port, rule.ports);
    const proto = protocolMatches(packet.protocol, rule.protocol);
    const dims = {
      source: src ? OK : { ok: false, why: endpointWhy(packet.source, rule.source, ctx) },
      destination: dst ? OK : { ok: false, why: endpointWhy(packet.destination, rule.destination, ctx) },
      port: port
        ? OK
        : { ok: false, why: packet.port === null ? "ICMP has no ports, and this rule names some" : `port ${packet.port} is not in ${rule.text.port}` },
      protocol: proto ? OK : { ok: false, why: `${packet.protocol} is not ${rule.protocol}` },
    };
    const matched = src && dst && port && proto;
    checks.push({ rule, evaluated: true, matched, dims });
    if (matched) verdict = { action: rule.action, rule };
  }
  return { checks, verdict };
}

// ---- Problems in a rule set -------------------------------------------------------------------

function rangesOf(p: Ports): PortRange[] {
  const rs: PortRange[] = p.kind === "any" ? [[0, 65535]] : p.ranges.map((r) => [...r] as PortRange);
  rs.sort((a, b) => a[0] - b[0]);
  const merged: PortRange[] = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  return merged;
}

function portsCover(a: Ports, b: Ports): boolean {
  const ma = rangesOf(a);
  return rangesOf(b).every(([lo, hi]) => ma.some(([alo, ahi]) => lo >= alo && hi <= ahi));
}

/** True only when every address that b matches is certainly matched by a. Unsure cases answer false. */
function endpointCovers(a: Endpoint, b: Endpoint, ctx: Context): boolean {
  if (a.kind === "any") return true;
  if (a.kind === "tag" && b.kind === "tag") return a.tag === b.tag;
  if (a.kind === "cidr" && b.kind === "cidr") {
    const r = relation(a.cidr, b.cidr);
    return r === "same" || r === "a-contains-b";
  }
  if (a.kind === "tag" && b.kind === "cidr") {
    if (!ctx.vnet) return false;
    if (a.tag === "VirtualNetwork") {
      const r = relation(ctx.vnet, b.cidr);
      return r === "same" || r === "a-contains-b";
    }
    if (a.tag === "Internet") return relation(ctx.vnet, b.cidr) === "disjoint" && !inCidr(AZURE_LB_IP, b.cidr);
    return b.cidr.prefix === 32 && b.cidr.base === AZURE_LB_IP;
  }
  if (a.kind === "cidr" && b.kind === "tag") {
    if (b.tag === "AzureLoadBalancer") return inCidr(AZURE_LB_IP, a.cidr);
    if (b.tag === "VirtualNetwork" && ctx.vnet) {
      const r = relation(a.cidr, ctx.vnet);
      return r === "same" || r === "a-contains-b";
    }
  }
  return false;
}

function covers(a: Rule, b: Rule, ctx: Context): boolean {
  return (
    endpointCovers(a.source, b.source, ctx) &&
    endpointCovers(a.destination, b.destination, ctx) &&
    portsCover(a.ports, b.ports) &&
    (a.protocol === "Any" || a.protocol === b.protocol)
  );
}

export type RuleReport = {
  errors: RuleErrors;
  duplicatePriority: boolean;
  /** The earlier rule that already matches everything this one matches, so this one can never be reached. */
  shadowedBy: Rule | null;
  rule: Rule | null;
};

export function analyseRules(inputs: RuleInput[], ctx: Context): Map<number, RuleReport> {
  const out = new Map<number, RuleReport>();
  const valid: Rule[] = [];
  for (const input of inputs) {
    const c = compileRule(input);
    if ("rule" in c) {
      valid.push(c.rule);
      out.set(input.id, { errors: {}, duplicatePriority: false, shadowedBy: null, rule: c.rule });
    } else {
      out.set(input.id, { errors: c.errors, duplicatePriority: false, shadowedBy: null, rule: null });
    }
  }
  for (const r of valid) {
    const same = valid.filter((o) => o.id !== r.id && o.direction === r.direction && o.priority === r.priority);
    const rep = out.get(r.id)!;
    rep.duplicatePriority = same.length > 0;
    const above = valid
      .filter((o) => o.id !== r.id && o.direction === r.direction && o.priority < r.priority && covers(o, r, ctx))
      .sort((a, b) => a.priority - b.priority);
    rep.shadowedBy = above[0] ?? null;
  }
  return out;
}
