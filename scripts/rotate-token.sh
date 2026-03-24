#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=/opt/lectern
ENV_FILE=$DEPLOY_DIR/.env
REPO_DIR=$DEPLOY_DIR/repo

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No env file found at $ENV_FILE. Run deploy.sh first."
  exit 1
fi

NEW_TOKEN=$(openssl rand -hex 32)
sed -i "s/^LECTERN_TOKENS=.*/LECTERN_TOKENS=$NEW_TOKEN/" "$ENV_FILE"

echo "Token rotated. Restarting lectern..."
docker compose -f "$REPO_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d

echo "New token is in $ENV_FILE"
