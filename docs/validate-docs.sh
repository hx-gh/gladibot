#!/usr/bin/env bash
# validate-docs.sh — Consistência entre docs e realidade do repo
#   Exit 0 = OK ou apenas avisos
#   Exit 1 = inconsistências bloqueantes
#
# Uso:
#   bash docs/validate-docs.sh

cd "$(dirname "$0")/.." || exit 1

WARN=0
ERR=0

warn()  { echo "  ! $1"; WARN=$((WARN+1)); }
errm()  { echo "  x $1"; ERR=$((ERR+1)); }
ok()    { echo "  ok  $1"; }

echo ""
echo "Validação de Docs — gladibot"
echo "----------------------------"

# [1] Diretórios do workflow
echo ""
echo "[1] Diretórios"
for dir in "docs" "docs/reviews"; do
  if [ -d "$dir" ]; then ok "$dir"; else errm "$dir ausente"; fi
done

# docs/wip/ é gitignored — pode ou não existir localmente, mas se existir precisa ter o .gitignore
if [ -d "docs/wip" ]; then
  if [ -f "docs/wip/.gitignore" ] && grep -q "^\*$" docs/wip/.gitignore; then
    ok "docs/wip (local, gitignored via docs/wip/.gitignore)"
  else
    errm "docs/wip existe mas docs/wip/.gitignore não tem '*' — risco de commitar scratchpad"
  fi
fi

# [2] Documentos-fonte-de-verdade
echo ""
echo "[2] Documentos permanentes"
for doc in \
  "docs/PROJECT_STATE.md" \
  "docs/DECISIONS.md" \
  "docs/TECHNICAL_DEBT.md" \
  "docs/CODE_PATTERNS.md" \
  "docs/CONTRIBUTING.md" \
  "docs/DEVELOPMENT_WORKFLOW.md" \
  "docs/INDEX.md" \
  "docs/memory.md" \
  "docs/flows.md" \
  "docs/endpoints.md" \
  "CLAUDE.md" \
  "README.md" \
  "prompt.bot.md"; do
  if [ -f "$doc" ]; then ok "$doc"; else errm "$doc ausente"; fi
done

# [3] Framework Claude
echo ""
echo "[3] Framework Claude"
for f in \
  ".claude/settings.json" \
  ".claude/agents/tech-architect.md" \
  ".claude/agents/code-reviewer.md" \
  ".claude/agents/bot-builder.md" \
  ".claude/agents/doc-keeper.md" \
  ".claude/commands/implement.md" \
  ".claude/commands/audit-sync.md" \
  ".claude/commands/review-pr.md" \
  ".claude/commands/checkpoint.md"; do
  if [ -f "$f" ]; then ok "$f"; else errm "$f ausente"; fi
done

# [4] Co-Authored-By Claude leak
echo ""
echo "[4] Co-Authored-By / Generated with Claude Code"
leaks=$(git log --all --format="%H %s%n%b" 2>/dev/null | grep -iE "Co-Authored-By: Claude|Generated with Claude Code" | head -5)
if [ -z "$leaks" ]; then
  ok "nenhum trailer Claude em commits"
else
  echo "$leaks" | while IFS= read -r line; do
    warn "trailer Claude em commit: $line"
  done
fi

# [5] Secrets em arquivos versionados
echo ""
echo "[5] Possíveis secrets"
secret_hits=$(git ls-files | xargs grep -lE "x-csrf-token.*[a-f0-9]{16,}|sh=[a-f0-9]{16,}" 2>/dev/null | head -5)
if [ -z "$secret_hits" ]; then
  ok "nenhum CSRF/sh com hash longo em tracked files"
else
  echo "$secret_hits" | while IFS= read -r line; do
    warn "possível token em: $line"
  done
fi

# Sumário
echo ""
echo "----------------------------"
echo "  $ERR erros, $WARN avisos"
echo "----------------------------"

exit $ERR
