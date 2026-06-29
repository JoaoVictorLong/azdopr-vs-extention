#!/usr/bin/env bash
set -euo pipefail

# Coloque este script dentro da pasta raiz da extensao
# e execute: bash build-azdopr.sh

cd "$(dirname "$0")"

echo "==> Instalando dependencias..."
npm install

echo "==> Verificando activationEvents no package.json..."
python3 -c "
import json
with open('package.json') as f:
    pkg = json.load(f)
if 'activationEvents' not in pkg:
    pkg['activationEvents'] = ['onView:azureDevOpsPRs']
    with open('package.json', 'w') as f:
        json.dump(pkg, f, indent=2)
    print('  + activationEvents adicionado')
else:
    print('  + activationEvents ja presente')
"

echo "==> Compilando..."
npm run compile:extension

echo "==> Gerando VSIX..."
npx @vscode/vsce package --no-dependencies

echo "==> Instalando no VS Code..."
VSIX=$(ls *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX" ]; then
  code --install-extension "$VSIX" --force
  echo ""
  echo "=== Pronto! ==="
  echo "Extensao '$VSIX' instalada no VS Code."
else
  echo ""
  echo "=== ERRO: VSIX nao foi gerado ==="
  exit 1
fi
