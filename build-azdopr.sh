#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Instalando dependencias..."
npm install

echo "==> Compilando..."
npm run compile

echo "==> Limpando VSIXs antigos..."
rm -f *.vsix

echo "==> Gerando VSIX..."
npx @vscode/vsce package

echo "==> Removendo extensao anterior..."
code --uninstall-extension joaovictorlong.azdopr-simple 2>/dev/null || true

echo "==> Instalando no VS Code..."
VSIX=$(ls *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX" ]; then
  code --install-extension "$VSIX" --force
  echo ""
  echo "=== Pronto! ==="
  echo "Extensao '$VSIX' (joaovictorlong.azdopr-simple) instalada."
  echo "Recarregue o VS Code (Ctrl+Shift+P -> Developer: Reload Window)"
else
  echo ""
  echo "=== ERRO: VSIX nao foi gerado ==="
  exit 1
fi
