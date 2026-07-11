#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$ROOT/apps/api"
WEB_DIR="$ROOT/apps/web"
OBS_DIR="$ROOT/apps/observability"
OBS_SDK_DIR="$ROOT/packages/gmas-observability"
VENV="$ROOT/.venv"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
OBSERVABILITY_PORT="${OBSERVABILITY_PORT:-8100}"
GMAS_SRC="$ROOT/vendor/gmas/src"
OBSERVABILITY_AVAILABLE=false
if [ -f "$OBS_DIR/pyproject.toml" ] && [ -f "$OBS_SDK_DIR/pyproject.toml" ]; then
  OBSERVABILITY_AVAILABLE=true
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  gMAS Apps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

find_python312() {
  if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    echo "$VENV/bin/python"
    return 0
  fi
  for candidate in python3.13 python3.12; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v python3 >/dev/null 2>&1; then
    if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then
      echo "python3"
      return 0
    fi
  fi
  return 1
}

PYTHON_BIN="$(find_python312)" || {
  echo "[API]      Error: Python 3.12+ is required (gMAS uses PEP 695 syntax)." >&2
  echo "           Install python3.12 or python3.13 and re-run ./scripts/dev-up.sh" >&2
  exit 1
}

echo "[API]      Using $PYTHON_BIN ($($PYTHON_BIN --version))"

if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then
  echo "[API]      Creating virtualenv at $VENV"
  "$PYTHON_BIN" -m venv "$VENV"
fi

DEPS_STAMP="$VENV/.gmas-dev-deps"
DEPS_CHANGED=false
for marker in "$ROOT/vendor/gmas/pyproject.toml" "$API_DIR/pyproject.toml"; do
  if [ ! -f "$DEPS_STAMP" ] || [ "$marker" -nt "$DEPS_STAMP" ]; then
    DEPS_CHANGED=true
    break
  fi
done
if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
  for marker in "$OBS_SDK_DIR/pyproject.toml" "$OBS_DIR/pyproject.toml"; do
    if [ ! -f "$DEPS_STAMP" ] || [ "$marker" -nt "$DEPS_STAMP" ]; then
      DEPS_CHANGED=true
      break
    fi
  done
fi

if [ "$DEPS_CHANGED" = true ]; then
  echo "[API]      Installing Python dependencies (first run may take a minute)..."
  if command -v uv >/dev/null 2>&1; then
    if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
      uv pip install --python "$VENV/bin/python" -e "$ROOT/vendor/gmas" -e "$OBS_SDK_DIR" -e "$OBS_DIR" -e "$API_DIR"
    else
      uv pip install --python "$VENV/bin/python" -e "$ROOT/vendor/gmas" -e "$API_DIR"
    fi
  else
    "$VENV/bin/pip" install -q -U pip
    if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
      "$VENV/bin/pip" install -e "$ROOT/vendor/gmas" -e "$OBS_SDK_DIR" -e "$OBS_DIR" -e "$API_DIR"
    else
      "$VENV/bin/pip" install -e "$ROOT/vendor/gmas" -e "$API_DIR"
    fi
  fi
  touch "$DEPS_STAMP"
fi

if [ ! -d "$GMAS_SRC" ] || [ ! -f "$GMAS_SRC/gmas/__init__.py" ]; then
  echo "[API]      Error: vendor/gmas submodule is missing." >&2
  echo "           Run: git submodule update --init --recursive" >&2
  exit 1
fi

if ! "$VENV/bin/python" -c "import sys; sys.path.insert(0, '$GMAS_SRC'); from gmas.utils.async_utils import run_sync" 2>/dev/null; then
  echo "[API]      Error: gMAS import check failed." >&2
  "$VENV/bin/python" -c "import sys; sys.path.insert(0, '$GMAS_SRC'); from gmas.utils.async_utils import run_sync" || true
  exit 1
fi

UVICORN="$VENV/bin/uvicorn"

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "[Web]      Installing dependencies..."
  if [ -f "$WEB_DIR/pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
    (cd "$WEB_DIR" && pnpm install --frozen-lockfile)
  else
    (cd "$WEB_DIR" && npm ci)
  fi
fi

OBSERVABILITY_PID=""
if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
  echo "[Observe]  Starting trace explorer on http://localhost:$OBSERVABILITY_PORT"
  GMAS_OBSERVABILITY_DATA_DIR="$OBS_DIR/data" \
  PYTHONPATH="$OBS_DIR" "$UVICORN" backend.main:app \
    --app-dir "$OBS_DIR" \
    --host 0.0.0.0 \
    --port "$OBSERVABILITY_PORT" \
    --reload \
    --reload-dir "$OBS_DIR/backend" &
  OBSERVABILITY_PID=$!
fi

echo "[API]      Starting FastAPI on http://localhost:8000"
cd "$API_DIR"
API_ENV=(
  PYTHONPATH="$API_DIR:$GMAS_SRC"
)
if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
  API_ENV=(
    GMAS_OBSERVABILITY_ENABLED=true
    GMAS_OBSERVABILITY_ENDPOINT="http://127.0.0.1:$OBSERVABILITY_PORT"
    GMAS_OBSERVABILITY_PROJECT="${GMAS_OBSERVABILITY_PROJECT:-gmas-demo}"
    GMAS_OBSERVABILITY_ENVIRONMENT="${GMAS_OBSERVABILITY_ENVIRONMENT:-development}"
    PYTHONPATH="$API_DIR:$GMAS_SRC:$OBS_SDK_DIR/src"
  )
fi
env "${API_ENV[@]}" "$UVICORN" backend.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --reload-dir "$API_DIR/backend" &
BACKEND_PID=$!

echo "[Web]      Starting Vite on http://localhost:$FRONTEND_PORT"
cd "$WEB_DIR"
WEB_ENV=()
if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
  WEB_ENV=(VITE_GMAS_OBSERVABILITY_URL="http://localhost:$OBSERVABILITY_PORT")
fi
if [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
  env VITE_PORT="$FRONTEND_PORT" "${WEB_ENV[@]}" pnpm dev --port "$FRONTEND_PORT" &
elif command -v npm >/dev/null 2>&1; then
  env VITE_PORT="$FRONTEND_PORT" "${WEB_ENV[@]}" npm run dev -- --port "$FRONTEND_PORT" &
else
  env VITE_PORT="$FRONTEND_PORT" "${WEB_ENV[@]}" npx vite --port "$FRONTEND_PORT" &
fi
FRONTEND_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Web:      http://localhost:$FRONTEND_PORT"
echo "  API:      http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
if [ "$OBSERVABILITY_AVAILABLE" = true ]; then
  echo "  Observe:  http://localhost:$OBSERVABILITY_PORT"
else
  echo "  Observe:  (not installed — checkout feat-6767-sdk-version packages)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Press Ctrl+C to stop."
echo ""

if [ -n "$OBSERVABILITY_PID" ]; then
  trap "echo ''; echo 'Stopping...'; kill $OBSERVABILITY_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; wait" EXIT INT TERM
else
  trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; wait" EXIT INT TERM
fi
wait
