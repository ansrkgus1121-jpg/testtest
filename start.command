#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v ffmpeg >/dev/null; then
  echo 'FFmpeg가 필요합니다. Homebrew가 있다면 brew install ffmpeg 로 설치하세요.'
  exit 1
fi
if [[ -x ../../work/venv/bin/python ]]; then
  ribbon_python="$(cd ../../work/venv/bin && pwd)/python"
elif [[ -x .venv/bin/python ]]; then
  ribbon_python="$PWD/.venv/bin/python"
elif command -v uv >/dev/null; then
  uv venv --python 3.12 .venv
  ribbon_python="$PWD/.venv/bin/python"
else
  ribbon_bootstrap="${RIBBON_PYTHON:-python3.12}"
  "$ribbon_bootstrap" -m venv .venv
  ribbon_python="$PWD/.venv/bin/python"
fi
# An interpreter can exist even if the previous installation was interrupted.
# Only mark this exact dependency set complete AFTER installation succeeds.
ribbon_hash="$("$ribbon_python" -c 'import hashlib;print(hashlib.sha256(open("requirements-lock.txt","rb").read()).hexdigest())')"
ribbon_stamp="$("$ribbon_python" -c 'import sys;print(sys.prefix)')/.ribbon-lock.sha256"
if [[ ! -f "$ribbon_stamp" ]] || [[ "$(cat "$ribbon_stamp")" != "$ribbon_hash" ]]; then
  if command -v uv >/dev/null; then
    uv pip sync --python "$ribbon_python" requirements-lock.txt
  else
    "$ribbon_python" -m ensurepip
    "$ribbon_python" -m pip install -r requirements-lock.txt
  fi
  printf '%s\n' "$ribbon_hash" > "$ribbon_stamp"
fi
exec "$ribbon_python" launch.py
