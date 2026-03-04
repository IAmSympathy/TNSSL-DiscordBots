# Script de deploiement automatique vers le serveur Oracle
# Usage: .\deploy-to-oracle.ps1
$SSH_KEY = "C:\Users\samyl\Downloads\ssh-key-2026-03-04.key"
$SERVER  = "ubuntu@147.15.132.219"
Write-Host "Deploy vers Oracle Cloud..." -ForegroundColor Cyan
# 1. Commit et push local (optionnel)
Write-Host "`nVoulez-vous commit et push les changements locaux? (o/n)" -ForegroundColor Yellow
$commit = Read-Host
if ($commit -eq "o") {
    Write-Host "Message de commit:" -ForegroundColor Yellow
    $message = Read-Host
    git add .
    git commit -m "$message"
    git push origin main
    Write-Host "Code pousse vers GitHub" -ForegroundColor Green
}
# 2. Lire le script bash, forcer LF, envoyer sur le serveur
$localScript = Join-Path $PSScriptRoot "scripts\deploy-remote.sh"
$tmpScript   = [System.IO.Path]::GetTempFileName() + ".sh"
$bashContent = [System.IO.File]::ReadAllText($localScript) -replace "`r`n", "`n" -replace "`r", "`n"
[System.IO.File]::WriteAllText($tmpScript, $bashContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "`nDeploiement sur le serveur..." -ForegroundColor Cyan
& scp -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15 $tmpScript "${SERVER}:/tmp/deploy.sh"
& ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15 $SERVER "bash /tmp/deploy.sh; rm -f /tmp/deploy.sh"
# 3. Nettoyage local
Remove-Item $tmpScript -ErrorAction SilentlyContinue
Write-Host "`nDeploiement termine!" -ForegroundColor Green