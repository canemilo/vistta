#!/usr/bin/env bash
# Sube las fotos de demostración al R2 local que usa `wrangler dev`.
set -euo pipefail
cd "$(dirname "$0")/.."

subir() { # subir <archivo> <clave>
  pnpm exec wrangler r2 object put "vistta-media/$2" --file="$1" --content-type=image/jpeg --local >/dev/null
  echo "  $2"
}

echo "Subiendo fotos de demostración al R2 local:"
for n in 01 02 03 04 05 06 07 08; do subir "seed/fotos/$n.jpg" "u/p_nordeste/$n.jpg"; done
for n in 01 02 03; do subir "seed/fotos/$n.jpg" "u/p_marina/$n.jpg"; done
