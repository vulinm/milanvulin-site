# Local language model for the chat panel

The "Ask my AI" panel talks to a small open model running on the home server's GPU (RTX 3060, 12 GB). The model is a platform service, not part of this app: it lives in the server's shared `~/stack` next to Caddy and cloudflared, so any app can use the same GPU. The site only needs an OpenAI-compatible endpoint.

If `LLM_URL` or `LLM_MODEL` is empty, the API reports the chat as disabled and the page does not show the section at all. This is why the code can be merged before the GPU side is ready.

## How a question travels
browser, then Cloudflare and the tunnel, Caddy, the web container (nginx, unbuffered for `/api/chat`), the API, and finally the model service on a private Docker network (`stack_llm`). Nothing exposes the model to the internet.

## Protections
- Per visitor: 8 questions a minute (sliding window, keyed on the Cloudflare client address).
- Global: at most 2 answers generated at the same time; a third visitor gets a friendly "busy" message instead of a queue.
- Size limits: 500 characters per question, 8 messages of history, 350 output tokens, 60 seconds per answer.
- If a visitor closes the page, the request is cancelled and the GPU stops generating.
- The system prompt contains only public facts and tells the model not to invent anything about Milan. What the model knows about Milan is read at startup from `./profile/Profile.md` on the server (see "Updating what the model knows"; the file is not part of the repository and there is no built-in copy: without it the chat stays off); the rules around it are in `ChatPrompt` in `backend/Api/Chat.cs`. Messages are not stored or logged by the site.

## Server setup (once)
1. NVIDIA driver on the host. `nvidia-smi` must show the RTX 3060. If it does not, install the recommended driver (for example `sudo ubuntu-drivers install`) and reboot.
2. NVIDIA Container Toolkit, following NVIDIA's install guide, then `sudo nvidia-ctk runtime configure --runtime=docker` and `sudo systemctl restart docker`.
3. Add the model service to `~/stack/compose.yaml` (the network is named `stack_llm` because the project is named `stack`, like `stack_proxy`):

```yaml
services:
  ollama:
    image: ollama/ollama:<pinned version>
    restart: unless-stopped
    environment:
      OLLAMA_KEEP_ALIVE: "-1"       # keep the model in VRAM for good, so the first visitor after a pause does not wait for a reload
      OLLAMA_CONTEXT_LENGTH: "4096" # enough for the profile (about 1,300 tokens) plus a short conversation; 8192 with two parallel answers was much slower on a 12 GB card
      OLLAMA_NUM_PARALLEL: "2"      # matches the API's limit of 2 parallel answers
      OLLAMA_MAX_LOADED_MODELS: "1"
    volumes: [ollama:/root/.ollama]
    deploy:
      resources:
        reservations:
          devices: [{ driver: nvidia, count: 1, capabilities: [gpu] }]
    networks: [llm]
volumes:
  ollama: {}
networks:
  llm: {}
```
No `ports:` entry: the model is reachable only from containers on `stack_llm`.

4. Start it and pull a model: `cd ~/stack && docker compose up -d ollama && docker compose exec ollama ollama pull gemma4:e4b`.
5. Measure it: `docker compose exec ollama ollama run gemma4:e4b --verbose "Explain pull-based deployment in two sentences."` and read the `eval rate` line (tokens per second).

## Enable it for this app
In `/srv/apps/milanvulin-site/.env`:
```
COMPOSE_FILE=compose.yaml:compose.platform.yaml:compose.llm.yaml
LLM_URL=http://ollama:11434
LLM_MODEL=gemma4:e4b
```
Keep any other settings already there. If `COMPOSE_FILE` already lists files, append `:compose.llm.yaml`. The next sync recreates the API on the `stack_llm` network. To switch the chat off again, empty `LLM_URL`.

## GPU panel (optional)
The Live telemetry section has a GPU panel next to the chat numbers. It has two sources, both read by the API on the private network, and each works without the other:
- **The model server.** `GET /api/ps` on `LLM_URL` says whether the chat model is loaded in video memory and how much of it sits on the GPU. This needs nothing extra. Only the chat model is read; any other model on the server is ignored.
- **A GPU exporter** for load, video memory, temperature and power of the card. Add it to `~/stack/compose.yaml` next to the model service, on the same private network and without `ports:`:

```yaml
services:
  gpu-exporter:
    image: utkuozdemir/nvidia_gpu_exporter:<pinned version>
    restart: unless-stopped
    environment:
      NVIDIA_DRIVER_CAPABILITIES: utility
    deploy:
      resources:
        reservations:
          devices: [{ driver: nvidia, count: 1, capabilities: [gpu] }]
    networks: [llm]
```
Check it from the model network first: `docker run --rm --network stack_llm curlimages/curl -s http://gpu-exporter:9835/metrics | grep -E "utilization_gpu|memory_(used|total)|temperature_gpu|power_draw"`. The API reads `nvidia_smi_utilization_gpu_ratio`, `nvidia_smi_memory_used_bytes`, `nvidia_smi_memory_total_bytes`, `nvidia_smi_temperature_gpu`, `nvidia_smi_power_draw_watts` and the `name` label of `nvidia_smi_gpu_info`; if the names differ in the version you pin, adjust `ParseReading` in `backend/Api/Gpu.cs`. Then set `GPU_METRICS_URL=http://gpu-exporter:9835/metrics` in the app's `.env`. If the exporter is down the card tiles disappear and the rest of the page is unaffected.

Nothing is stored: the API samples every 10 seconds and keeps the last hour in memory. The exporter reports only the card, never processes or other apps.

## Trying another model
Models are configuration: pull a different one (`ollama pull <name>`), change `LLM_MODEL`, and the next sync applies it. Compare candidates with the same five questions and look at the tokens per second and first-token time that each answer shows on the page.

## Local development
Run Ollama on your own machine, set `LLM_URL=http://host.docker.internal:11434` and `LLM_MODEL=<a model you pulled>` in `.env`, then `docker compose up --build`.

## Updating what the model knows
The profile text is read once when the API starts. On the server it is looked up as `/srv/apps/milanvulin-site/profile/Profile.md` (mounted read-only by `compose.llm.yaml`); the path is fixed (`/app/profile/Profile.md` inside the container). If the file is missing or empty the API logs a warning and the chat stays off, like when `LLM_URL` is empty. The file is never committed (`.gitignore` blocks `profile/` and `Profile.md`).

One-time setup on the server, before the first sync that has the mount (otherwise Docker creates the folder owned by root): `mkdir /srv/apps/milanvulin-site/profile`.

The update is done from your own computer over ssh (copy the file to `profile/Profile.md`, restart only the `api` service with `docker compose restart api`, check the log line, ask the model "hi"). The script that does this is kept outside the repository, together with the profile text.
