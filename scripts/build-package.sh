#!/usr/bin/env bash
# Genera el paquete ZIP que se sube a Azure App Service (mismo esquema que
# VillaDelCasar y la tienda: código Node con sus dependencias + startup.sh).
#
# Uso: scripts/build-package.sh [ruta-del-zip]      (por defecto: crm.zip)
# Trabaja en una copia temporal: no toca el node_modules de su carpeta.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="${1:-$ROOT/crm.zip}"
[[ "$OUT" = /* ]] || OUT="$ROOT/$OUT"

command -v node >/dev/null || { echo "Hace falta Node.js 22.13 o superior"; exit 1; }
command -v zip >/dev/null || { echo "Hace falta el comando zip"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== Copiando el código a $WORK"
tar -C "$ROOT" \
  --exclude=./node_modules --exclude=./.git --exclude=./data \
  --exclude=./infra/.deploy.env --exclude='./*.zip' --exclude=./.env \
  -cf - . | tar -C "$WORK" -xf -

cd "$WORK"
echo "== Instalando dependencias"
npm ci --no-audit --no-fund
echo "== Pruebas"
if ! npm test > "$WORK/pruebas.log" 2>&1; then
  cat "$WORK/pruebas.log"
  echo "== ERROR: las pruebas fallan; no se genera el paquete."
  exit 1
fi
grep -E '^# (pass|fail)' "$WORK/pruebas.log"
echo "== Quitando dependencias de desarrollo"
npm prune --omit=dev --no-audit --no-fund

echo "== Empaquetando $OUT"
rm -f "$OUT"
zip -qr "$OUT" package.json package-lock.json startup.sh src views public node_modules
echo "== Paquete listo: $OUT ($(du -h "$OUT" | cut -f1))"
