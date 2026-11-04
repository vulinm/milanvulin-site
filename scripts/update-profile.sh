#!/usr/bin/env bash
# Sends a new Profile.md to the home server, restarts the API so the chat model reads it,
# checks the log and asks the model "hi" (which also warms it up).
#
# Usage:  SERVER=user@host scripts/update-profile.sh path/to/Profile.md
# Needs:  ssh and scp access to the server (key login). Works in Linux, macOS, WSL and Git Bash.
#
# The text is read by the API at startup only, so a restart is enough; nothing is rebuilt.
set -euo pipefail

FILE="${1:-}"
[ -n "$FILE" ] || { echo "Usage: SERVER=user@host $0 path/to/Profile.md" >&2; exit 1; }
: "${SERVER:?Set SERVER, for example SERVER=user@192.168.0.10}"
APP_DIR="${APP_DIR:-/srv/apps/milanvulin-site}"
CONTAINER="${CONTAINER:-milanvulin-site-api-1}"
MAX_WORDS=1300   # the model runs with a 4096-token context; the profile must leave room for the conversation

[ -s "$FILE" ] || { echo "File not found or empty: $FILE" >&2; exit 1; }
words=$(wc -w < "$FILE" | tr -d ' ')
echo "Profile: $words words"
if [ "$words" -gt "$MAX_WORDS" ]; then
  echo "Too long: more than $MAX_WORDS words would not fit the model's context. Shorten it." >&2
  exit 1
fi

echo "Copying to $SERVER ..."
scp -q "$FILE" "$SERVER:/tmp/Profile.md.new"

ssh "$SERVER" "APP_DIR='$APP_DIR' CONTAINER='$CONTAINER' bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP_DIR"

mkdir -p profile
if ! install -m 644 /tmp/Profile.md.new profile/Profile.md; then
  echo "Cannot write $APP_DIR/profile. If Docker created it, run once: sudo chown -R $USER: $APP_DIR/profile" >&2
  exit 1
fi
rm -f /tmp/Profile.md.new

echo "Restarting the API ..."
docker compose restart api >/dev/null

for i in $(seq 1 40); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo none)
  [ "$state" = healthy ] && break
  sleep 2
done
echo "API health: $state"
[ "$state" = healthy ] || { echo "API did not become healthy; check: docker logs $CONTAINER" >&2; exit 1; }

docker logs "$CONTAINER" 2>&1 | grep "Chat profile" | tail -1

echo 'Asking the model "hi" ...'
reply=$(docker compose exec -T api wget -qO- \
  --header='Content-Type: application/json' \
  --post-data='{"messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:8080/api/chat || true)
if printf '%s' "$reply" | grep -q '"done":true'; then
  printf '%s' "$reply" | grep '"done":true' | tail -1
  echo "OK: the model answered."
else
  echo "No complete answer from the model. Is Ollama up (docker ps) and LLM_URL set in .env?" >&2
  exit 1
fi
REMOTE
