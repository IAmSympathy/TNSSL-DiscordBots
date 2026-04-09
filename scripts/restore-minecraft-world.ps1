#!/usr/bin/env pwsh
# =============================================================================
# restore-minecraft-world.ps1 — Restaure le monde Minecraft depuis une sauvegarde
# Usage: .\restore-minecraft-world.ps1
#
# Ce script:
# 1. Se connecte au serveur Oracle
# 2. Entre dans le container Docker Minecraft
# 3. Restaure la sauvegarde du monde
# =============================================================================

$SSH_KEY = "C:\Users\samyl\Downloads\ssh-key-2026-03-04.key"
$SERVER  = "ubuntu@68.233.120.229"

Write-Host "=============================================="
Write-Host " Restauration du monde Minecraft"
Write-Host " Serveur : $SERVER"
Write-Host "=============================================="

# Test de connexion
Write-Host ""
Write-Host "[1/4] Test de connexion au serveur..."
try {
    ssh -o StrictHostKeyChecking=no -i $SSH_KEY $SERVER "echo 'Connexion OK' && docker ps"
    Write-Host "  ✅ Connexion OK"
}
catch {
    Write-Error "  ❌ Impossible de se connecter au serveur"
    exit 1
}

# Vérifier les containers Docker disponibles
Write-Host ""
Write-Host "[2/4] Recherche du container Minecraft..."
$dockerContainers = ssh -o StrictHostKeyChecking=no -i $SSH_KEY $SERVER "docker ps --all --format='table {{.Names}}\t{{.Status}}' | grep -i minecraft || echo 'Aucun container Minecraft trouvé'"
Write-Host $dockerContainers

# Vérifier les sauvegardes disponibles
Write-Host ""
Write-Host "[3/4] Recherche des sauvegardes disponibles..."
$backups = ssh -o StrictHostKeyChecking=no -i $SSH_KEY $SERVER "docker exec minecraft ls -la /data/backups/ 2>/dev/null | tail -20 || echo 'Dossier backups non trouvé'"
Write-Host $backups

# Demander laquelle restaurer
Write-Host ""
Write-Host "[4/4] Restauration du monde..."
Write-Host "Quelle sauvegarde voulez-vous restaurer? (tapez le nom complet)" -ForegroundColor Yellow
$backupName = Read-Host "Nom du backup"

if ([string]::IsNullOrWhiteSpace($backupName)) {
    Write-Error "Nom de backup vide"
    exit 1
}

# Effectuer la restauration
Write-Host ""
Write-Host "Restauration de $backupName..."

$restoreScript = @"
#!/bin/bash
set -e

echo "→ Arrêt du serveur Minecraft..."
docker exec minecraft rcon-cli say "Sauvegarde du monde en cours... Le serveur va redémarrer."
docker exec minecraft rcon-cli stop

sleep 5

echo "→ Suppression du monde actuel..."
docker exec minecraft rm -rf /data/world
docker exec minecraft rm -rf /data/world_nether
docker exec minecraft rm -rf /data/world_the_end

echo "→ Extraction de la sauvegarde..."
docker exec minecraft bash -c "cd /data && tar -xzf backups/$backupName"

echo "→ Redémarrage du serveur..."
docker restart minecraft

sleep 10

echo "→ Vérification du monde restauré..."
docker exec minecraft ls -la /data/ | grep world

echo "✅ Monde restauré avec succès !"
"@

ssh -o StrictHostKeyChecking=no -i $SSH_KEY $SERVER $restoreScript

Write-Host ""
Write-Host "=============================================="
Write-Host " ✅ Restauration terminée !"
Write-Host "=============================================="

