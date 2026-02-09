#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$DIR/.venv"

if [ ! -d "$VENV" ]; then
  echo "Creating virtual environment..."
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install -q -r "$DIR/requirements.txt"

cd "$DIR/.."
exec "$VENV/bin/python" -m server.run "$@"
