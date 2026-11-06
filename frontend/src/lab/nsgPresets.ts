import type { PacketInput, RuleInput } from "./nsg";

/** "{vm}" stands for a machine address inside the current address space and is filled in when the example is applied. */
export const VM = "{vm}";

export type NsgPreset = {
  label: string;
  rules: Omit<RuleInput, "id">[];
  packet: PacketInput;
};

const rule = (name: string, priority: number, direction: RuleInput["direction"], source: string, destination: string, port: string, protocol: RuleInput["protocol"], action: RuleInput["action"]) => ({
  name,
  priority: String(priority),
  direction,
  source,
  destination,
  port,
  protocol,
  action,
});

export const NSG_PRESETS: NsgPreset[] = [
  {
    label: "Web tier",
    rules: [
      rule("AllowHttps", 100, "Inbound", "Internet", "VirtualNetwork", "443", "TCP", "Allow"),
      rule("AllowSshFromOffice", 200, "Inbound", "203.0.113.0/24", "VirtualNetwork", "22", "TCP", "Allow"),
    ],
    packet: { direction: "Inbound", source: "198.51.100.7", destination: VM, port: "443", protocol: "TCP" },
  },
  {
    label: "Deny placed after Allow",
    rules: [
      rule("AllowTcpFromInternet", 100, "Inbound", "Internet", "VirtualNetwork", "*", "TCP", "Allow"),
      rule("DenySshFromInternet", 200, "Inbound", "Internet", "VirtualNetwork", "22", "TCP", "Deny"),
    ],
    packet: { direction: "Inbound", source: "198.51.100.7", destination: VM, port: "22", protocol: "TCP" },
  },
  {
    label: "Block outbound internet",
    rules: [
      rule("AllowHttpsOut", 100, "Outbound", "VirtualNetwork", "Internet", "443", "TCP", "Allow"),
      rule("DenyInternetOut", 200, "Outbound", "VirtualNetwork", "Internet", "*", "Any", "Deny"),
    ],
    packet: { direction: "Outbound", source: VM, destination: "198.51.100.20", port: "80", protocol: "TCP" },
  },
];
