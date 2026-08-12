#!/usr/bin/env bash
# Publishes the customer page to candor.unitynodes.com.
#
# The site is static: Caddy serves /var/www/candor directly, so there is no
# service to restart and nothing to keep running. Build, sync, done.
#
#   ./scripts/deploy-ui.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=/var/www/candor
HOST=candor.unitynodes.com

cd "$REPO"

echo "→ building"
npm run ui:build

# --delete so a renamed content-hashed bundle does not leave its predecessor
# behind; index.html is the only unhashed file and it is always rewritten.
echo "→ syncing to $DEST"
rsync -a --delete dist-ui/ "$DEST/"

# Caddy reads the files as the caddy user; the build runs as whoever deployed.
sudo chown -R "$USER":caddy "$DEST"
sudo find "$DEST" -type d -exec chmod 755 {} +
sudo find "$DEST" -type f -exec chmod 644 {} +

# Verified against the real vhost rather than localhost:<some port>, because the
# only thing that matters is what the customer's browser gets back.
echo "→ verifying"
code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/")
wasm=$(curl -sk -o /dev/null -w '%{content_type}' --resolve "$HOST:443:127.0.0.1" \
  "https://$HOST/$(cd "$DEST" && find assets -name '*.wasm' | head -1)")

echo "  index    HTTP $code"
echo "  wasm     $wasm"

[[ "$code" == 200 ]] || { echo "✗ index did not return 200"; exit 1; }
[[ "$wasm" == application/wasm ]] || { echo "✗ wasm served as $wasm — the browser will refuse to compile it"; exit 1; }

echo "✓ https://$HOST"
