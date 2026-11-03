# milanvulin-site

Source of [milanvulin.com](https://milanvulin.com): a portfolio that shows the pipeline it runs on instead of only describing it.

- **Ship it, live**: the real push-to-deploy timeline for this site, measured from GitHub Actions runs and the API container's start time.
- **Clickable architecture**: the runtime and delivery paths as a diagram; every node opens a config excerpt.
- **Trace my request**: how your own request reached the API container, from Cloudflare headers and measured round-trip times.

## Stack
React + Vite (served by nginx) and a small ASP.NET Core API, each in its own container. No database. Built by GitHub Actions, published to ghcr.io, and pulled by a systemd timer on a home server behind a Cloudflare Tunnel and Caddy. Created from [ownforge-skeleton](https://github.com/vulinm/ownforge-skeleton).

## Local development
    cp .env.example .env
    docker compose up --build

Then open http://localhost:8080. Outside Cloudflare the trace panel has no edge data, and the pipeline panel only matches a live build once the image is built by CI.

## Editing content
Name, intro and links live in `frontend/src/content.ts`. Architecture excerpts live in `frontend/src/architecture.ts`; each one states whether it is a real file from this repository or a simplified excerpt of server configuration.

## Configuration
Settings come from `.env`, which is never committed. The API makes unauthenticated requests to the public GitHub API only, so there are no secrets to configure.

## License
PolyForm Noncommercial 1.0.0: free for noncommercial use only. Commercial use requires a separate license from the author. See LICENSE.
