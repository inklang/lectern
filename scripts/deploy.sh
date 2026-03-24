#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=/opt/lectern
ENV_FILE=$DEPLOY_DIR/.env
REPO_URL=https://github.com/inklang/lectern.git
REPO_DIR=$DEPLOY_DIR/repo

sudo mkdir -p "$DEPLOY_DIR"
sudo chown "$(whoami):$(whoami)" "$DEPLOY_DIR"

# Generate a token if one doesn't exist yet
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Generating LECTERN_TOKENS..."
  TOKEN=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
BASE_URL=https://packages.inklang.org
LECTERN_TOKENS=$TOKEN
EOF
  chmod 600 "$ENV_FILE"
  echo "Token saved to $ENV_FILE"
else
  echo "Using existing $ENV_FILE"
fi

# Clone or pull latest source
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Pulling latest changes..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "Cloning repo..."
  git clone "$REPO_URL" "$REPO_DIR"
fi

# Build image and start
docker compose -f "$REPO_DIR/docker-compose.yml" --env-file "$ENV_FILE" build
docker compose -f "$REPO_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d

echo ""
echo "Lectern is running at http://localhost:4321"
echo "Token is in $ENV_FILE"
echo ""
echo "To deploy updates: bash $REPO_DIR/scripts/deploy.sh"
echo "To rotate token:   bash $REPO_DIR/scripts/rotate-token.sh"
