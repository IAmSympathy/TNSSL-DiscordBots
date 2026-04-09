# Milton Voice Activity

Commande slash ajoutee: `milton-map`

## But
Lancer la carte Minecraft Milton (`http://tnss-smp.duckdns.org:8123/#`) depuis Discord, idealement comme activite vocale (comme Wordle / Watch Together).

## Variables d'environnement
- `MILTON_MAP_URL` (optionnel): URL de la map web (defaut: `http://tnss-smp.duckdns.org:8123/#`)
- `MILTON_ACTIVITY_APPLICATION_ID` (optionnel): Application ID d'une Discord Embedded Activity

## Comportement
- Si `MILTON_ACTIVITY_APPLICATION_ID` est configure: le bot cree une invite d'activite embedded dans le salon vocal cible.
- Sinon: fallback avec bouton lien direct vers la map web.

## Permissions requises
- Bot: `Create Instant Invite`, `View Channel`, `Connect`
- Utilisateurs: permission d'utiliser les activites dans le salon vocal cible

