#!/usr/bin/env bash
set -euo pipefail

# Run in a test container. The site must already be built and served.
if [[ ! -f /run/.containerenv && ! -f /.dockerenv ]]; then
  echo 'Run this check in a container, with Bun and Chrome installed.' >&2
  exit 1
fi
if ! command -v bun >/dev/null; then
  echo 'Bun is missing from the test container.' >&2
  exit 1
fi
flash_browser="${CHROME_BIN:-}"
if [[ -z "$flash_browser" ]]; then
  for candidate in google-chrome chromium chromium-browser /opt/google/chrome/chrome; do
    if command -v "$candidate" >/dev/null; then
      flash_browser="$(command -v "$candidate")"
      break
    fi
  done
fi
if [[ -z "$flash_browser" || ! -x "$flash_browser" ]]; then
  echo 'Chrome is missing. Install it in the container or set CHROME_BIN.' >&2
  exit 1
fi
flash_profile="$(mktemp -d "${TMPDIR:-/tmp}/xp-flash-input.XXXXXX")"
flash_browser_pid=''
cleanup() {
  if [[ -n "$flash_browser_pid" ]]; then
    kill "$flash_browser_pid" 2>/dev/null || true
    wait "$flash_browser_pid" 2>/dev/null || true
  fi
  rm -rf "$flash_profile"
}
trap cleanup EXIT
nice -n 10 "$flash_browser" --headless=new --no-sandbox --disable-dev-shm-usage \
  --mute-audio --enable-unsafe-swiftshader --disable-background-timer-throttling \
  --user-data-dir="$flash_profile" --remote-debugging-port=0 \
  about:blank >"$flash_profile/browser.log" 2>&1 &
flash_browser_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -s "$flash_profile/DevToolsActivePort" ]]; then
    read -r flash_port <"$flash_profile/DevToolsActivePort"
    nice -n 10 bun tools/check-flash-input.mjs "${1:-http://127.0.0.1:8000}" "http://127.0.0.1:$flash_port"
    exit
  fi
  if ! kill -0 "$flash_browser_pid" 2>/dev/null; then
    cat "$flash_profile/browser.log" >&2
    exit 1
  fi
  sleep 0.1
done
echo 'Chrome did not start its debugger within 10 seconds.' >&2
exit 1
