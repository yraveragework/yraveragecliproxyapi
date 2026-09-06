#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer, then run this launcher again."
  exit 1
fi
exec node tools/macos-services.mjs start
