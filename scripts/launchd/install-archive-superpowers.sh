#!/usr/bin/env bash
# Install (or refresh) the daily launchd job that archives superpowers
# specs/plans older than 2 days.
#
# macOS-only. Idempotent — safe to re-run after pulling updates.
#
# What it does:
#   1. Renders scripts/launchd/com.switchboard.archive-superpowers.plist.tmpl
#      with the current $HOME and repo root.
#   2. Writes the rendered plist to ~/Library/LaunchAgents/.
#   3. launchctl bootout + bootstrap (or fallback to unload/load) for the
#      gui/<uid> domain, so the job is registered with the live login session.
#
# Usage:
#   scripts/launchd/install-archive-superpowers.sh           # install/refresh
#   scripts/launchd/install-archive-superpowers.sh --status  # show status
#   scripts/launchd/install-archive-superpowers.sh --uninstall

set -euo pipefail

label="com.switchboard.archive-superpowers"
plist_dest="$HOME/Library/LaunchAgents/${label}.plist"

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
template="$repo_root/scripts/launchd/${label}.plist.tmpl"
log_path="$HOME/Library/Logs/switchboard-archive.log"

uid="$(id -u)"
domain="gui/${uid}"

case "${1:-}" in
  --status)
    echo "label:       $label"
    echo "plist:       $plist_dest ($([ -f "$plist_dest" ] && echo present || echo absent))"
    echo "log:         $log_path"
    echo "repo_root:   $repo_root"
    echo ""
    launchctl print "${domain}/${label}" 2>/dev/null | head -40 \
      || echo "(not loaded in ${domain})"
    exit 0
    ;;
  --uninstall)
    if [ -f "$plist_dest" ]; then
      launchctl bootout "${domain}/${label}" 2>/dev/null \
        || launchctl unload "$plist_dest" 2>/dev/null \
        || true
      rm -f "$plist_dest"
      echo "Removed $plist_dest and unloaded from ${domain}."
    else
      echo "No plist at $plist_dest — nothing to remove."
    fi
    exit 0
    ;;
esac

[ -f "$template" ] || { echo "Template not found: $template" >&2; exit 1; }

mkdir -p "$(dirname "$plist_dest")"
mkdir -p "$(dirname "$log_path")"

# Render the plist (escape forward slashes for sed by using a non-/ delimiter).
sed \
  -e "s|{{REPO_ROOT}}|${repo_root}|g" \
  -e "s|{{HOME}}|${HOME}|g" \
  "$template" > "$plist_dest"

echo "Wrote $plist_dest"

# Refresh in the gui domain. bootout might fail if not loaded — that's fine.
launchctl bootout "${domain}/${label}" 2>/dev/null \
  || launchctl unload "$plist_dest" 2>/dev/null \
  || true

if launchctl bootstrap "${domain}" "$plist_dest" 2>/dev/null; then
  echo "Loaded into ${domain}."
elif launchctl load "$plist_dest" 2>/dev/null; then
  echo "Loaded (legacy launchctl load)."
else
  echo "Warning: launchctl bootstrap/load failed. The plist is in place; reboot or run \`launchctl bootstrap ${domain} '$plist_dest'\` manually." >&2
fi

echo ""
echo "Next run: daily at 09:00 local time."
echo "Log: $log_path"
echo "Status: $0 --status"
