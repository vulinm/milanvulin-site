// Pure IPv4 and CIDR helpers for the network lab. No DOM, no React, no state, so the maths can be
// checked on its own. Addresses are unsigned 32-bit numbers held in plain JavaScript numbers.

export type Mode = "azure" | "generic";

export type Cidr = { base: number; prefix: number };

export type ParsedCidr =
  | { ok: true; cidr: Cidr; given: string; normalized: boolean }
  | { ok: false; error: string };

/** Smallest block each mode allows: Azure subnets stop at /29, the generic mode at /30. */
export const MIN_BLOCK_PREFIX: Record<Mode, number> = { azure: 29, generic: 30 };

/** Addresses that cannot be given to a host. Azure keeps five per subnet, classic IPv4 keeps two. */
export const RESERVED_ADDRESSES: Record<Mode, number> = { azure: 5, generic: 2 };

/** The planner works on address spaces between a /8 and a /29. */
export const VNET_MIN_PREFIX = 8;
export const VNET_MAX_PREFIX = 29;

const OCTET = /^(0|[1-9]\d{0,2})$/;

export function parseIpv4(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!OCTET.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function formatIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function wildcardOf(prefix: number): number {
  return ~maskOf(prefix) >>> 0;
}

export function sizeOf(prefix: number): number {
  return 2 ** (32 - prefix);
}

export function lastOf(c: Cidr): number {
  return c.base + sizeOf(c.prefix) - 1;
}

export function cidrText(c: Cidr): string {
  return `${formatIpv4(c.base)}/${c.prefix}`;
}

/** The 32 bits of an address as a string of 0 and 1. */
export function toBits(n: number): string {
  return (n >>> 0).toString(2).padStart(32, "0");
}

export function parseCidr(text: string, minPrefix: number, maxPrefix: number): ParsedCidr {
  const t = text.trim();
  const slash = t.indexOf("/");
  if (slash < 0) return { ok: false, error: "Write it as address/prefix, for example 10.0.0.0/16." };
  const ip = parseIpv4(t.slice(0, slash));
  if (ip === null) return { ok: false, error: "The address needs four numbers from 0 to 255, like 10.0.0.0." };
  const ps = t.slice(slash + 1);
  if (!/^\d{1,2}$/.test(ps)) return { ok: false, error: "The prefix after the slash must be a whole number." };
  const prefix = Number(ps);
  if (prefix < minPrefix || prefix > maxPrefix) {
    return { ok: false, error: `The prefix must be from /${minPrefix} to /${maxPrefix}.` };
  }
  const base = (ip & maskOf(prefix)) >>> 0;
  return { ok: true, cidr: { base, prefix }, given: t, normalized: base !== ip };
}

/** Hosts a subnet of this size can really hold. */
export function usableHosts(prefix: number, mode: Mode): number {
  return Math.max(0, sizeOf(prefix) - RESERVED_ADDRESSES[mode]);
}

/** The smallest block (largest prefix) that holds this many hosts, or null if even a /8 is too small. */
export function prefixForHosts(hosts: number, mode: Mode): number | null {
  for (let p = MIN_BLOCK_PREFIX[mode]; p >= VNET_MIN_PREFIX; p--) {
    if (usableHosts(p, mode) >= hosts) return p;
  }
  return null;
}

export type Relation = "disjoint" | "same" | "a-contains-b" | "b-contains-a";

/** CIDR blocks are aligned, so two of them are either apart or one sits inside the other. */
export function relation(a: Cidr, b: Cidr): Relation {
  const aEnd = a.base + sizeOf(a.prefix);
  const bEnd = b.base + sizeOf(b.prefix);
  if (aEnd <= b.base || bEnd <= a.base) return "disjoint";
  if (a.prefix === b.prefix) return "same";
  return a.prefix < b.prefix ? "a-contains-b" : "b-contains-a";
}

const PRIVATE_BLOCKS: Cidr[] = [
  { base: parseIpv4("10.0.0.0")!, prefix: 8 },
  { base: parseIpv4("172.16.0.0")!, prefix: 12 },
  { base: parseIpv4("192.168.0.0")!, prefix: 16 },
];

/** True when the whole block lies inside one of the RFC 1918 private ranges. */
export function isPrivate(c: Cidr): boolean {
  return PRIVATE_BLOCKS.some((p) => {
    const r = relation(p, c);
    return r === "same" || r === "a-contains-b";
  });
}

export type SubnetRequest = {
  id: number;
  name: string;
  by: "prefix" | "hosts";
  value: string;
};

export type PlannedSubnet = {
  id: number;
  name: string;
  status: "placed" | "no-space" | "invalid";
  message?: string;
  /** Set for every subnet whose size could be worked out, even when it did not fit. */
  prefix?: number;
  /** Set only when the subnet was placed. */
  cidr?: Cidr;
  size?: number;
  usable?: number;
};

export type Plan = {
  vnet: ParsedCidr;
  subnets: PlannedSubnet[];
  total: number;
  allocated: number;
  free: number;
};

type Needed = { prefix: number } | { error: string };

function neededPrefix(req: SubnetRequest, mode: Mode): Needed {
  const raw = req.value.trim().replace(/^\//, "");
  const min = MIN_BLOCK_PREFIX[mode];
  if (!/^\d+$/.test(raw)) {
    return { error: req.by === "prefix" ? `Enter a prefix from /${VNET_MIN_PREFIX} to /${min}.` : "Enter how many hosts you need." };
  }
  const n = Number(raw);
  if (req.by === "prefix") {
    if (n < VNET_MIN_PREFIX || n > min) return { error: `In this mode a subnet prefix runs from /${VNET_MIN_PREFIX} to /${min}.` };
    return { prefix: n };
  }
  if (n < 1) return { error: "A subnet needs room for at least 1 host." };
  const p = prefixForHosts(n, mode);
  if (p === null) return { error: "That is more hosts than the largest subnet this planner handles." };
  return { prefix: p };
}

/**
 * Places the subnets inside the address space, largest first, packed from the start. Block sizes are
 * powers of two, so going from big to small keeps every block aligned and leaves the free space as one
 * run at the end. Results come back in the order the subnets were given.
 */
export function planSubnets(vnetText: string, requests: SubnetRequest[], mode: Mode): Plan {
  const vnet = parseCidr(vnetText, VNET_MIN_PREFIX, VNET_MAX_PREFIX);
  const out = new Map<number, PlannedSubnet>();
  const todo: { req: SubnetRequest; index: number; prefix: number; size: number }[] = [];

  requests.forEach((req, index) => {
    const name = req.name.trim() || `subnet-${index + 1}`;
    const need = neededPrefix(req, mode);
    if ("error" in need) {
      out.set(req.id, { id: req.id, name, status: "invalid", message: need.error });
    } else {
      todo.push({ req, index, prefix: need.prefix, size: sizeOf(need.prefix) });
    }
  });

  if (!vnet.ok) {
    for (const t of todo) {
      out.set(t.req.id, { id: t.req.id, name: t.req.name.trim() || `subnet-${t.index + 1}`, status: "no-space", prefix: t.prefix, message: "Fix the address space first." });
    }
    return { vnet, subnets: requests.map((r) => out.get(r.id)!), total: 0, allocated: 0, free: 0 };
  }

  const total = sizeOf(vnet.cidr.prefix);
  const end = vnet.cidr.base + total;
  let cursor = vnet.cidr.base;
  let allocated = 0;

  todo.sort((a, b) => b.size - a.size || a.index - b.index);
  for (const t of todo) {
    const name = t.req.name.trim() || `subnet-${t.index + 1}`;
    const aligned = Math.ceil(cursor / t.size) * t.size;
    if (t.size > total) {
      out.set(t.req.id, { id: t.req.id, name, status: "no-space", prefix: t.prefix, message: `A /${t.prefix} is larger than the whole address space.` });
    } else if (aligned + t.size > end) {
      out.set(t.req.id, { id: t.req.id, name, status: "no-space", prefix: t.prefix, message: `No room left for a /${t.prefix} in this address space.` });
    } else {
      out.set(t.req.id, {
        id: t.req.id,
        name,
        status: "placed",
        prefix: t.prefix,
        cidr: { base: aligned, prefix: t.prefix },
        size: t.size,
        usable: usableHosts(t.prefix, mode),
      });
      cursor = aligned + t.size;
      allocated += t.size;
    }
  }

  return { vnet, subnets: requests.map((r) => out.get(r.id)!), total, allocated, free: total - allocated };
}
