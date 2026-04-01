#!/usr/bin/env bash
# Run native serial port tests using socat virtual loopback ports.
# Requires socat: brew install socat
#
# Usage:
#   ./scripts/test-hardware.sh          # runs only native tests
#   ./scripts/test-hardware.sh --all    # runs full test suite including native

set -euo pipefail

if ! command -v socat &>/dev/null; then
  echo "socat not found. Install with: brew install socat" >&2
  exit 1
fi

# Start socat and capture the two PTY paths from its stderr output
SOCAT_LOG=$(mktemp)
socat -d -d pty,raw,echo=0 pty,raw,echo=0 2>"$SOCAT_LOG" &
SOCAT_PID=$!

cleanup() {
  kill "$SOCAT_PID" 2>/dev/null || true
  rm -f "$SOCAT_LOG"
}
trap cleanup EXIT

# Wait for both PTY paths to appear in socat's output
echo "Starting virtual loopback ports..."
for i in $(seq 1 20); do
  PORTS=$(grep -oE '/dev/[^ ]+' "$SOCAT_LOG" 2>/dev/null | head -2 || true)
  COUNT=$(echo "$PORTS" | grep -c '/dev/' || true)
  if [ "$COUNT" -ge 2 ]; then break; fi
  sleep 0.1
done

SERIAL_PORT_A=$(echo "$PORTS" | sed -n '1p')
SERIAL_PORT_B=$(echo "$PORTS" | sed -n '2p')

if [ -z "$SERIAL_PORT_A" ] || [ -z "$SERIAL_PORT_B" ]; then
  echo "Failed to detect virtual ports. socat output:" >&2
  cat "$SOCAT_LOG" >&2
  exit 1
fi

echo "Port A: $SERIAL_PORT_A"
echo "Port B: $SERIAL_PORT_B"
echo ""

export SERIAL_PORT_A SERIAL_PORT_B

if [ "${1:-}" = "--all" ]; then
  bun --bun run test
else
  # Run only the native spec directly so we don't re-run mock/parser tests
  node --import @oxc-node/core/register \
    node_modules/.bin/ava __test__/native.spec.ts
fi
