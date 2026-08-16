#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
CONFIG="$REPO_ROOT/supabase/config.toml"
OWNED_PROJECT="voice-lab-local"
EXCLUDED_SERVICES="studio,imgproxy,realtime,logflare,vector,supavisor"

usage() {
  echo "usage: $0 {start|status|stop} [--dry-run] [--confirm voice-lab-local]" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
COMMAND=$1
shift
DRY_RUN=0
CONFIRM=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --confirm)
      [ "$#" -ge 2 ] || usage
      CONFIRM=$2
      shift
      ;;
    *) usage ;;
  esac
  shift
done

[ -f "$CONFIG" ] || { echo "missing $CONFIG" >&2; exit 1; }
CONFIG_PROJECT=$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG" | head -n 1)
[ "$CONFIG_PROJECT" = "$OWNED_PROJECT" ] || {
  echo "refusing lifecycle action: supabase/config.toml is not owned project $OWNED_PROJECT" >&2
  exit 1
}

echo "project: $OWNED_PROJECT"
echo "config: $CONFIG"

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ '
    printf '%s ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

status() {
  if [ "$DRY_RUN" -eq 1 ]; then
    run docker ps --filter "label=com.supabase.cli.project=$OWNED_PROJECT"
    run docker port "supabase_kong_$OWNED_PROJECT"
    run docker exec "supabase_db_$OWNED_PROJECT" pg_isready -U postgres
    run curl --fail --silent --show-error "http://127.0.0.1:54321/auth/v1/health"
    return
  fi

  CONTAINERS=$(docker ps -q --filter "label=com.supabase.cli.project=$OWNED_PROJECT")
  [ -n "$CONTAINERS" ] || { echo "status: stopped"; return 1; }
  docker ps --filter "label=com.supabase.cli.project=$OWNED_PROJECT" \
    --format 'table {{.Names}}\t{{.Status}}'
  docker port "supabase_kong_$OWNED_PROJECT"
  docker exec "supabase_db_$OWNED_PROJECT" pg_isready -U postgres
  curl --fail --silent --show-error "http://127.0.0.1:54321/auth/v1/health" >/dev/null
  echo "health: database and Auth API ready"
}

case "$COMMAND" in
  start)
    if [ "$DRY_RUN" -eq 1 ]; then
      run npx --yes supabase start --workdir "$REPO_ROOT" -x "$EXCLUDED_SERVICES"
    else
      npx --yes supabase start --workdir "$REPO_ROOT" -x "$EXCLUDED_SERVICES" >/dev/null
    fi
    status
    ;;
  status)
    status
    ;;
  stop)
    [ "$CONFIRM" = "$OWNED_PROJECT" ] || {
      if [ -z "$CONFIRM" ]; then
        echo "stop deletes only the owned local stack; pass --confirm $OWNED_PROJECT" >&2
      else
        echo "refusing to stop unowned project $CONFIRM" >&2
      fi
      exit 1
    }
    run npx --yes supabase stop --workdir "$REPO_ROOT" --project-id "$OWNED_PROJECT" --no-backup
    if [ "$DRY_RUN" -eq 1 ]; then
      run docker ps -aq --filter "label=com.supabase.cli.project=$OWNED_PROJECT"
      run docker network ls -q --filter "label=com.docker.compose.project=$OWNED_PROJECT"
      run docker volume ls -q --filter "label=com.docker.compose.project=$OWNED_PROJECT"
      exit 0
    fi
    REMAINS=$(docker ps -aq --filter "label=com.supabase.cli.project=$OWNED_PROJECT")
    REMAINS="$REMAINS$(docker network ls -q --filter "label=com.docker.compose.project=$OWNED_PROJECT")"
    REMAINS="$REMAINS$(docker volume ls -q --filter "label=com.docker.compose.project=$OWNED_PROJECT")"
    [ -z "$REMAINS" ] || { echo "owned Docker resources remain; cleanup not verified" >&2; exit 1; }
    echo "cleanup: owned containers, network, and volumes removed"
    ;;
  *) usage ;;
esac
