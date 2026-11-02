#!/usr/bin/env bash
# Run the suite under several time zones and print pass/fail counts per zone.
#
# Usage: scripts/test-timezones.sh [--mode ci|plain|both] [--zones "TZ1 TZ2 ..."] [--logs DIR]
#   ci     the way `bun run test` runs it: bun test --parallel=4 --timeout 30000
#   plain  bare `bun test` (serial, default 5s timeout)
# Exits non-zero if any run fails. Failed test names are printed under each row.
set -u

mode=both
zones="UTC America/Argentina/Buenos_Aires Asia/Tokyo Pacific/Kiritimati"
logs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --zones) zones="$2"; shift 2 ;;
    --logs) logs="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
[ -n "$logs" ] || logs="$(mktemp -d)"
mkdir -p "$logs"

case "$mode" in
  ci) modes="ci" ;;
  plain) modes="plain" ;;
  both) modes="ci plain" ;;
  *) echo "--mode must be ci, plain or both" >&2; exit 2 ;;
esac

status=0
printf '%-8s %-34s %6s %6s\n' MODE TZ PASS FAIL
for m in $modes; do
  for tz in $zones; do
    log="$logs/${m}-${tz//\//_}.log"
    if [ "$m" = ci ]; then
      TZ="$tz" nice -n 10 bun test --parallel=4 --timeout 30000 >"$log" 2>&1
    else
      TZ="$tz" nice -n 10 bun test >"$log" 2>&1
    fi
    code=$?
    pass=$(grep -E '^ *[0-9]+ pass$' "$log" | tail -1 | awk '{print $1}')
    fail=$(grep -E '^ *[0-9]+ fail$' "$log" | tail -1 | awk '{print $1}')
    pass=${pass:-?}
    fail=${fail:-?}
    printf '%-8s %-34s %6s %6s\n' "$m" "$tz" "$pass" "$fail"
    if [ "$code" -ne 0 ]; then
      status=1
      grep -E '^\(fail\)' "$log" | sed 's/^/    /'
    fi
  done
done
echo "logs: $logs"
exit $status
