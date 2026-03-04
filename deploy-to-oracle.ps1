﻿# Script de déploiement automatique vers le serveur Oracle
# Usage: .\deploy-to-oracle.ps1

$SSH_KEY = "C:\Users\samyl\Downloads\ssh-key-2026-03-04.key"
$SERVER = "ubuntu@147.15.132.219"
$SSH_OPTS = "-o StrictHostKeyChecking=no -o ConnectTimeout=15"

Write-Host "🚀 Déploiement vers le serveur Oracle Cloud..." -ForegroundColor Cyan

# 1. Commit et push local (optionnel)
Write-Host "`n📝 Voulez-vous commit et push les changements locaux? (o/n)" -ForegroundColor Yellow
$commit = Read-Host
if ($commit -eq "o")
{
    Write-Host "💬 Message de commit:" -ForegroundColor Yellow
    $message = Read-Host
    git add .
    git commit -m "$message"
    git push origin main
    Write-Host "✅ Code poussé vers GitHub" -ForegroundColor Green
}

# 2. Se connecter au serveur et déployer
Write-Host "`n🔄 Déploiement sur le serveur..." -ForegroundColor Cyan

$commands = @"
set -e
cd ~/discord-bot-llm
echo '📥 Récupération des dernières modifications...'
git stash && git pull && git stash pop || git pull
echo '🔨 Compilation du TypeScript...'
npx tsc
echo '📁 Création du dossier logs si nécessaire...'
mkdir -p logs
echo '🔄 Redémarrage via ecosystem.config.js...'
pm2 stop all 2>/dev/null || true
sleep 2
pm2 start ecosystem.config.js
pm2 save
echo '✅ Déploiement terminé!'
echo ''
echo '📊 Statut des services:'
pm2 status
echo ''
echo '📋 Derniers logs bot:'
pm2 logs discord-bot-netricsa --lines 15 --nostream
"@

$expr = "ssh -i `"$SSH_KEY`" $SSH_OPTS $SERVER `"$commands`""
Invoke-Expression $expr

Write-Host "`n✅ Déploiement terminé avec succès!" -ForegroundColor Green
Write-Host "🔍 Logs en temps réel: .\manage-bot.ps1" -ForegroundColor Yellow
