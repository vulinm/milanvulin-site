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
- The system prompt contains only public facts and tells the model not to invent anything about Milan. What the model knows about Milan is read at startup from `./profile/Profile.md` on the server when that file exists (see "Updating what the model knows"), otherwise from the public `backend/Api/Profile.md` bundled in the image; the rules around it are in `ChatPrompt` in `backend/Api/Chat.cs`. Messages are not stored or logged by the site.

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

## Trying another model
Models are configuration: pull a different one (`ollama pull <name>`), change `LLM_MODEL`, and the next sync applies it. Compare candidates with the same five questions and look at the tokens per second and first-token time that each answer shows on the page.

## Local development
Run Ollama on your own machine, set `LLM_URL=http://host.docker.internal:11434` and `LLM_MODEL=<a model you pulled>` in `.env`, then `docker compose up --build`.

## Updating what the model knows
The profile text is read once when the API starts. On the server it is looked up as `/srv/apps/milanvulin-site/profile/Profile.md` (mounted read-only by `compose.llm.yaml`); if that file is missing the bundled `backend/Api/Profile.md` is used, then a short built-in text.

One-time setup on the server, before the first sync that has the mount (otherwise Docker creates the folder owned by root): `mkdir /srv/apps/milanvulin-site/profile`.

To update it from your own computer, edit the text and run `SERVER=user@host scripts/update-profile.sh path/to/Profile.md`. The script checks the length (at most 1,300 words for the 4096-token context), copies the file, restarts only the API container, waits until it is healthy, prints the `Chat profile: ...` log line and sends the model a "hi". Nothing is rebuilt and nothing is committed, so the server's text does not have to be public.
