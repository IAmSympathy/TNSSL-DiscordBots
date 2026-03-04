#!/usr/bin/env bash
set -e

cd ~/discord-bot-llm

echo "==> Initialisation ou mise a jour du repo git..."
if [ ! -d .git ]; then
  echo "    Pas de repo git - initialisation..."
  git init
  git remote add origin https://github.com/IAmSympathy/TNSSL-DiscordBots.git
fi

git fetch origin main

echo "==> Sauvegarde des dossiers critiques..."
BACKUP_DIR=$(mktemp -d)
[ -d data ]             && cp -a data             "$BACKUP_DIR/"
[ -d lavalink ]         && cp -a lavalink         "$BACKUP_DIR/"
[ -d python_services ]  && cp -a python_services  "$BACKUP_DIR/"
[ -d logs ]             && cp -a logs             "$BACKUP_DIR/"
[ -d node_modules ]     && cp -a node_modules     "$BACKUP_DIR/"
[ -d generated_images ] && cp -a generated_images "$BACKUP_DIR/"

echo "==> Nettoyage et synchronisation git..."
git clean -fdx --exclude=.env
git checkout -B main origin/main

echo "==> Restauration des dossiers critiques..."
[ -d "$BACKUP_DIR/data" ]             && rm -rf data             && mv "$BACKUP_DIR/data"             .
[ -d "$BACKUP_DIR/lavalink" ]         && rm -rf lavalink         && mv "$BACKUP_DIR/lavalink"         .
[ -d "$BACKUP_DIR/python_services" ]  && rm -rf python_services  && mv "$BACKUP_DIR/python_services"  .
[ -d "$BACKUP_DIR/logs" ]             && rm -rf logs             && mv "$BACKUP_DIR/logs"             .
[ -d "$BACKUP_DIR/node_modules" ]     && rm -rf node_modules     && mv "$BACKUP_DIR/node_modules"     .
[ -d "$BACKUP_DIR/generated_images" ] && rm -rf generated_images && mv "$BACKUP_DIR/generated_images" .
rm -rf "$BACKUP_DIR"
echo "    Repo synchronise"

echo "==> Installation des dependances..."
npm install 2>&1 | tail -5

echo "==> Compilation TypeScript..."
./node_modules/.bin/tsc

mkdir -p logs

echo "==> Redemarrage du bot..."
pm2 restart discord-bot-netricsa

echo ""
echo "==> Statut des services:"
pm2 status

echo ""
echo "==> Derniers logs bot:"
pm2 logs discord-bot-netricsa --lines 20 --nostream



