#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEV_VARS_FILE="${SCRIPT_DIR}/apps/worker/.dev.vars"
readonly DEV_VARS_EXAMPLE="${SCRIPT_DIR}/apps/worker/.dev.vars.example"

start_dev=true

usage() {
  cat <<'EOF'
Usage: ./build.sh [--check-only]

  (no option)    Set up the local D1 database, run all checks/builds,
                 and start the Worker and web development servers.
  --check-only   Run setup, checks, and builds, then exit.
  -h, --help     Show this help.
EOF
}

case "${1:-}" in
  "") ;;
  --check-only) start_dev=false ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    printf 'Unknown option: %s\n\n' "$1" >&2
    usage >&2
    exit 2
    ;;
esac

if (( $# > 1 )); then
  printf 'Only one option can be specified.\n\n' >&2
  usage >&2
  exit 2
fi

cd "${SCRIPT_DIR}"

export WRANGLER_LOG_PATH="${TMPDIR:-/tmp}/remote-job-radar-wrangler.log"
export WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true

step() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

require_command node
require_command pnpm

node_major="$(node -p "process.versions.node.split('.')[0]")"
pnpm_version="$(pnpm --version)"
pnpm_major="${pnpm_version%%.*}"

if (( node_major < 24 )); then
  printf 'Node.js 24 or newer is required (current: %s).\n' "$(node --version)" >&2
  exit 1
fi

if (( pnpm_major != 10 )); then
  printf 'pnpm 10 is required (current: %s).\n' "${pnpm_version}" >&2
  exit 1
fi

step "Installing locked dependencies"
pnpm install --frozen-lockfile

if [[ ! -f "${DEV_VARS_FILE}" ]]; then
  if [[ ! -f "${DEV_VARS_EXAMPLE}" ]]; then
    printf 'Missing local environment template: %s\n' "${DEV_VARS_EXAMPLE}" >&2
    exit 1
  fi

  step "Creating local Worker environment"
  cp "${DEV_VARS_EXAMPLE}" "${DEV_VARS_FILE}"
  chmod 600 "${DEV_VARS_FILE}"
else
  step "Using existing local Worker environment"
fi

step "Applying local D1 migrations"
CI=true pnpm db:migrate:local

step "Loading idempotent demo data"
pnpm db:seed:local

step "Running type checks and tests"
pnpm check

step "Building the web app and Worker"
pnpm build

if [[ "${start_dev}" == false ]]; then
  printf '\nLocal setup, checks, and builds completed successfully.\n'
  exit 0
fi

printf '\nLocal setup, checks, and builds completed successfully.\n'
printf 'Web:    http://localhost:5173\n'
printf 'Worker: http://localhost:8787\n'
printf 'Health: http://localhost:8787/api/health\n'
printf 'Press Ctrl-C to stop both development servers.\n\n'

exec pnpm --parallel \
  --filter @remote-job-radar/worker \
  --filter @remote-job-radar/web \
  dev
