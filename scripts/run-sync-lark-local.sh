#!/usr/bin/env bash
set -euo pipefail

REFRESH_SCRIPT="${HOME}/.lark-cli/refresh-token.py"

if [[ -f "${REFRESH_SCRIPT}" ]]; then
  tmp_env="$(mktemp)"
  python3 "${REFRESH_SCRIPT}" > "${tmp_env}"
  set -a
  # shellcheck disable=SC1090
  source "${tmp_env}"
  set +a
  rm -f "${tmp_env}"
fi

lark-cli auth status >/dev/null
npm run sync:lark
