#!/bin/bash
FILE=/home/ubuntu/lavalink/application.yml

# Vérifie si lavalyrics est déjà présent
if grep -q "lavalyrics" "$FILE"; then
    echo "lavalyrics déjà présent :"
    grep -n "lavalyrics" "$FILE"
    exit 0
fi

# Insère après la ligne lavasearch-plugin
perl -i -0pe 's|(    - dependency: "com\.github\.topi314\.lavasearch:lavasearch-plugin[^\n]*"\n      repository: "[^\n]*")|$1\n    - dependency: "com.github.topi314.lavalyrics:lavalyrics-plugin:1.0.0"\n      repository: "https://maven.lavalink.dev/releases"|' "$FILE"

echo "--- Résultat ---"
grep -n -A1 "lavalyrics\|lavasearch" "$FILE"

# Redémarre Lavalink
echo "--- Redémarrage Lavalink ---"
pm2 restart lavalink
echo "Done"

