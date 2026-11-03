export type Source =
  | { kind: "repo"; path: string }
  | { kind: "simplified"; note: string };

export type ArchNode = {
  id: string;
  lane: "run" | "ship";
  col: number;
  title: string;
  sub: string;
  skill: string;
  desc: string;
  source: Source;
  code: string;
};

export const nodes: ArchNode[] = [
  {
    id: "cf",
    lane: "run",
    col: 0,
    title: "Cloudflare",
    sub: "DNS and TLS",
    skill: "DNS, edge TLS",
    desc: "Public DNS and TLS termination live at the edge. The record points at a tunnel, not at my home IP address.",
    source: { kind: "simplified", note: "DNS records, tunnel ID removed" },
    code: "milanvulin.com      CNAME  <tunnel-id>.cfargotunnel.com  (proxied)\nwww.milanvulin.com  CNAME  <tunnel-id>.cfargotunnel.com  (proxied)",
  },
  {
    id: "tun",
    lane: "run",
    col: 1,
    title: "Tunnel",
    sub: "cloudflared",
    skill: "Outbound-only networking",
    desc: "cloudflared dials out from the server and carries requests back in, so the router has no port forwarding and no inbound port is open.",
    source: { kind: "simplified", note: "published routes, credentials removed" },
    code: "ingress:\n  - hostname: milanvulin.com\n    service: http://caddy:80\n  - hostname: www.milanvulin.com\n    service: http://caddy:80\n  - service: http_status:404",
  },
  {
    id: "caddy",
    lane: "run",
    col: 2,
    title: "Caddy",
    sub: "Host routing",
    skill: "Layer 7 routing",
    desc: "One shared proxy for every app on the server. Each app is a block that routes a hostname to that app's web container on the proxy network.",
    source: { kind: "simplified", note: "one block of the shared Caddyfile" },
    code: "http://milanvulin.com, http://www.milanvulin.com {\n  reverse_proxy milanvulin-site-web:80\n}",
  },
  {
    id: "app",
    lane: "run",
    col: 3,
    title: "App stack",
    sub: "web and api",
    skill: "Network isolation",
    desc: "Only the web container joins the shared proxy network. The API sits on a private network, and nginx forwards nothing except /api/ to it.",
    source: { kind: "repo", path: "compose.platform.yaml" },
    code: "services:\n  web:\n    networks:\n      app: {}\n      proxy:\n        aliases: [\"${APP_NAME:?}-web\"]\nnetworks:\n  proxy:\n    external: true\n    name: stack_proxy",
  },
  {
    id: "gha",
    lane: "ship",
    col: 0,
    title: "GitHub Actions",
    sub: "Build images",
    skill: "CI",
    desc: "Every push to main builds three images in parallel: web, api, and a deploy image that carries the compose files. The commit SHA is baked into the API image.",
    source: { kind: "repo", path: ".github/workflows/build.yml" },
    code: "on:\n  push:\n    branches: [main]\n...\nmatrix:\n  include:\n    - { name: web, ... }\n    - { name: api, ... }\n    - { name: deploy, ... }\n...\nbuild-args: GIT_SHA=${{ github.sha }}",
  },
  {
    id: "ghcr",
    lane: "ship",
    col: 1,
    title: "ghcr.io",
    sub: "Image registry",
    skill: "Artifacts",
    desc: "The only hand-off between CI and the server. Nothing is ever pushed to the server: it only pulls.",
    source: { kind: "simplified", note: "image names" },
    code: "ghcr.io/vulinm/milanvulin-site-web\nghcr.io/vulinm/milanvulin-site-api\nghcr.io/vulinm/milanvulin-site-deploy",
  },
  {
    id: "timer",
    lane: "ship",
    col: 2,
    title: "Sync timer",
    sub: "systemd, per app",
    skill: "Pull-based delivery",
    desc: "A templated systemd timer per app wakes the sync script on a schedule, with random jitter so apps do not all hit the registry at once.",
    source: { kind: "simplified", note: "timer unit, interval illustrative" },
    code: "# ownforge-sync@milanvulin-site.timer\n[Timer]\nOnUnitActiveSec=1min\nRandomizedDelaySec=30s",
  },
  {
    id: "sync",
    lane: "ship",
    col: 3,
    title: "sync.sh",
    sub: "Pull and restart",
    skill: "Deploy automation",
    desc: "Takes the compose files from the deploy image, pulls newer images, and recreates only what changed. A shared lock stops two runs overlapping.",
    source: { kind: "simplified", note: "outline of the script, not the full file" },
    code: "sync.sh <app>\n  1. extract compose files from the deploy image\n  2. docker compose pull\n  3. docker compose up -d   # recreates changed services\n  (one shared lock for all apps)",
  },
];
