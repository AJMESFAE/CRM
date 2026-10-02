#!/usr/bin/env bash
# Elimina los recursos del CRM en Azure, BASE DE DATOS INCLUIDA.
#
# - Grupo propio (por defecto): borra el grupo de recursos entero.
# - Plan compartido con otra web (SHARE_PLAN_WITH_APP, p. ej. VillaDelCasar):
#   borra SOLO los recursos del CRM; el grupo, el plan y la otra web no se tocan.
#
# Antes de borrar, descargue una copia de /home/colegio/backups (ver docs/despliegue-azure.md).
#
# Uso: ./infra/destroy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[[ -f infra/.deploy.env ]] && source infra/.deploy.env
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-colegio-mezquita}"
PREFIX="${PREFIX:-colegiomezquita}"
SHARE_PLAN_WITH_APP="${SHARE_PLAN_WITH_APP:-}"

if [[ -z "$SHARE_PLAN_WITH_APP" ]]; then
  read -r -p "Se borrará el grupo '$RESOURCE_GROUP' con la base de datos del colegio. Escriba BORRAR para continuar: " answer
  [[ "$answer" == "BORRAR" ]] || { echo "Cancelado."; exit 1; }
  az group delete -n "$RESOURCE_GROUP" --yes --no-wait
  echo "Borrado en curso (tarda unos minutos)."
  exit 0
fi

# Recursos del CRM dentro del grupo compartido (todos empiezan por PREFIX)
mapfile -t IDS < <(az resource list -g "$RESOURCE_GROUP" \
  --query "[?starts_with(name, '$PREFIX') && type != 'Microsoft.Web/serverfarms'].id" -o tsv)
[[ ${#IDS[@]} -gt 0 ]] || { echo "No hay recursos del CRM en $RESOURCE_GROUP."; exit 0; }
echo "Se borrarán estos recursos de '$RESOURCE_GROUP' (no se toca '$SHARE_PLAN_WITH_APP' ni el plan):"
printf '  %s\n' "${IDS[@]##*/}"
read -r -p "Escriba BORRAR para continuar: " answer
[[ "$answer" == "BORRAR" ]] || { echo "Cancelado."; exit 1; }
az resource delete --ids "${IDS[@]}" -o none
echo "Recursos del CRM eliminados."
