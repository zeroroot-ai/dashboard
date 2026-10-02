#!/bin/sh
# Size the V8 old-space heap from the container's memory limit.
#
# Node sizes its default heap from the machine's RAM, not from the cgroup the
# pod runs in. In a 1Gi container the default old-space cap lands near 512MB,
# so a signed-in render that allocates past it dies with
# "Ineffective mark-compacts near heap limit" and exit code 139 while the
# cgroup still has headroom. Kubernetes records no OOMKilled event for that,
# because the process killed itself below the limit, so the crash hides as a
# plain restart (dashboard#150).
#
# This entrypoint reads the cgroup limit (v2 first, then v1), hands Node
# three quarters of it as --max-old-space-size, and leaves the rest for
# code, buffers and the rest of the process. A pod that still exhausts the
# limit is then OOMKilled by the kernel, with an event an operator can see.
#
# No limit, or an unlimited cgroup, sets nothing: Node keeps its own default.
# CGROUP_MEMORY_MAX overrides the v2 path for the test in
# scripts/entrypoint-heap.test.mjs.
set -eu

limit=""
for f in "${CGROUP_MEMORY_MAX:-/sys/fs/cgroup/memory.max}" /sys/fs/cgroup/memory/memory.limit_in_bytes; do
  [ -r "$f" ] || continue
  v=$(cat "$f")
  case "$v" in
    ""|max|*[!0-9]*) continue ;;
  esac
  # cgroup v1 reports "no limit" as a number near 2^63.
  if [ "$v" -ge 9223372036854771712 ]; then
    continue
  fi
  limit="$v"
  break
done

if [ -n "$limit" ]; then
  heap=$(( limit / 1048576 * 3 / 4 ))
  if [ "$heap" -lt 128 ]; then
    heap=128
  fi
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${heap}"
fi

exec "$@"
