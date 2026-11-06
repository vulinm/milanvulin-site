import type { SubnetRequest } from "./cidr";

export type Preset = {
  label: string;
  vnet: string;
  rows: Omit<SubnetRequest, "id">[];
};

export const DEFAULT_PEER = "10.30.0.0/16";

export const PRESETS: Preset[] = [
  {
    label: "3-tier app",
    vnet: "10.20.0.0/22",
    rows: [
      { name: "web", by: "prefix", value: "24" },
      { name: "app", by: "hosts", value: "200" },
      { name: "data", by: "prefix", value: "26" },
      { name: "private-endpoints", by: "prefix", value: "27" },
    ],
  },
  {
    label: "Hub for hub-and-spoke",
    vnet: "10.0.0.0/22",
    rows: [
      { name: "GatewaySubnet", by: "prefix", value: "27" },
      { name: "AzureFirewallSubnet", by: "prefix", value: "26" },
      { name: "AzureBastionSubnet", by: "prefix", value: "26" },
      { name: "shared-services", by: "hosts", value: "100" },
    ],
  },
  {
    label: "Does not fit",
    vnet: "10.50.0.0/24",
    rows: [
      { name: "big", by: "prefix", value: "25" },
      { name: "medium", by: "prefix", value: "26" },
      { name: "extra", by: "prefix", value: "26" },
      { name: "one-too-many", by: "prefix", value: "27" },
    ],
  },
];
