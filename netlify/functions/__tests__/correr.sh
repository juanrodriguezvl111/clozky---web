#!/bin/sh
# Corre todas las pruebas. Sin dependencias: solo Node.
#   sh netlify/functions/__tests__/correr.sh
set -e
cd "$(dirname "$0")/../../.."
node netlify/functions/__tests__/create-payment.test.js
node netlify/functions/__tests__/wompi-webhook.test.js
node netlify/functions/__tests__/mantener-viva.test.js
node netlify/functions/__tests__/salud.test.js
echo ""
echo "  Todas las pruebas pasan."
