#!/bin/bash
set -e
S=${DRIVE_DIR:-/tmp/merman-drive}
HERE=$(cd "$(dirname "$0")/.." && pwd)/live-check
X=${XTERM:-$S/node_modules/@xterm/xterm}

if [ "$1" = setup ]; then
  repo=$(cd "$2" && pwd -P)
  rm -rf "$S" && mkdir -p "$S/cfg" "$S/mkt/.claude-plugin" "$S/out"
  [ -d "$X" ] || npm i -s --prefix "$S" @xterm/xterm >/dev/null
  jq --arg r "$repo" '{hasCompletedOnboarding, theme} | with_entries(select(.value != null)) + {projects: {($r): {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true}}}' ~/.claude.json > "$S/cfg/.claude.json"
  echo '{}' > "$S/cfg/settings.json"
  rsync -a --exclude .git --exclude node_modules "$repo/" "$S/mkt/merman/"
  echo '{"name":"drive","owner":{"name":"drive"},"plugins":[{"name":"merman","source":"./merman"}]}' > "$S/mkt/.claude-plugin/marketplace.json"
  CLAUDE_CONFIG_DIR="$S/cfg" claude plugin marketplace add "$S/mkt" >/dev/null
  CLAUDE_CONFIG_DIR="$S/cfg" claude plugin install merman@drive >/dev/null
  cp "$S/cfg/settings.json" "$S/baseline.json"
  echo "$repo" > "$S/repo"
  echo "installed $repo into $S/cfg"
  exit 0
fi

name=$1 cols=$2 rows=$3 steps=$4
cp "$S/baseline.json" "$S/cfg/settings.json"
timeout 150 python3 "$HERE/capture.py" "$S/out/$name.bin" "$(cat "$S/repo")" "$cols" "$rows" "$steps" env -u CLAUDE_CODE_PLUGIN_DIRS CLAUDE_CONFIG_DIR="$S/cfg" claude >/dev/null 2>&1 || true
node "$HERE/render.mjs" "$S/out/$name.bin" "$S/out/$name.png" "$cols" "$rows" "$X" >/dev/null
echo "$S/out/$name.png saved: $(jq -c '.pluginConfigs["merman@drive"].options // {}' "$S/cfg/settings.json")"
