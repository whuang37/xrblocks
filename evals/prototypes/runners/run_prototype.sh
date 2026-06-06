#!/usr/bin/env bash
# Run a prototyping task against gemini, with skill on or off, score the
# resulting workspace.
#
# Usage:
#   ./evals/prototypes/runners/run_prototype.sh <task_id> {with-skill|without-skill}

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: run_prototype.sh <task_id> {with-skill|without-skill}" >&2
  exit 1
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "error: GEMINI_API_KEY not set" >&2
  exit 1
fi

TASK_ID="$1"
MODE="$2"
case "$MODE" in
  with-skill|without-skill) ;;
  *) echo "error: mode must be with-skill or without-skill" >&2; exit 1;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVALS="$REPO_ROOT/evals"
TASK_DIR="$EVALS/prototypes/tasks/$TASK_ID"
RESULTS_DIR="$EVALS/results/proto-gemini-${MODE}"
WORKSPACE="/tmp/xrblocks-proto-${TASK_ID}-${MODE}"

mkdir -p "$RESULTS_DIR"

if [ ! -d "$TASK_DIR" ]; then
  echo "error: task $TASK_ID not found" >&2
  exit 1
fi

SKILL_NAME=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['skill'])" "$TASK_DIR/spec.json")
TEMPLATE_REL=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['template'])" "$TASK_DIR/spec.json")
TEMPLATE="$REPO_ROOT/$TEMPLATE_REL"

# Clean workspace.
rm -rf "$WORKSPACE"
cp -r "$TEMPLATE" "$WORKSPACE"
# Init a git repo so the agent can git-diff if it wants; not required.
(cd "$WORKSPACE" && git init -q && git add -A && git -c user.email=e@e -c user.name=e commit -qm init)

# Helpers for skill install/uninstall.
install_skill() {
  local skill_dir="$REPO_ROOT/skills/$1"
  if [ -d "$skill_dir" ]; then
    gemini skills install "$skill_dir" --scope user --consent > /dev/null 2>&1 && return 0
  fi
  return 1
}
uninstall_skill() {
  gemini skills uninstall "$1" --scope user > /dev/null 2>&1 || true
}

# Always start clean.
uninstall_skill "$SKILL_NAME"

if [ "$MODE" = "with-skill" ]; then
  if install_skill "$SKILL_NAME"; then
    echo "[$TASK_ID/$MODE] installed $SKILL_NAME"
  else
    echo "[$TASK_ID/$MODE] WARNING: failed to install $SKILL_NAME"
  fi
fi

# Build prompt.
PROMPT_BODY="$(cat "$TASK_DIR/prompt.md")"
FULL_PROMPT="You are working in a small xrblocks app project. Edit the file as instructed. Do not commit. Just make the file changes.

${PROMPT_BODY}"

echo "[$TASK_ID/$MODE] invoking gemini in $WORKSPACE"
cd "$WORKSPACE"
LOG_PATH="${WORKSPACE}.log"
if ! gemini --skip-trust --approval-mode yolo -o text -p "$FULL_PROMPT" > "$LOG_PATH" 2>&1; then
  echo "[$TASK_ID/$MODE] gemini exited non-zero, see $LOG_PATH"
fi

# Score.
cd "$REPO_ROOT"
python3 evals/prototypes/score_proto.py "$TASK_DIR" "$WORKSPACE" > "$RESULTS_DIR/${TASK_ID}.json"

# Cleanup skill, keep workspace + log + result.
uninstall_skill "$SKILL_NAME"

cat "$RESULTS_DIR/${TASK_ID}.json"
