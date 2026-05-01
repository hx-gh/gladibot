---
description: Code review automatizado da branch atual contra develop. Executa gates, revisa diff contra regras arquiteturais e gera docs/reviews/review-<branch>-<data>.md pronto para colar na PR.
---

# /review-pr — Code Review Automatizado

Analisa o diff da branch atual contra `develop`, executa gates, revisa contra as convenções do projeto e gera um relatório `.md` pronto para acompanhar o comentário da PR.

## Procedimento

### 1. Coletar contexto do git

```bash
git branch --show-current
git log develop..HEAD --format="%h %an <%ae> %s" 2>/dev/null || git log main..HEAD --format="%h %an <%ae> %s"
git diff develop..HEAD --stat 2>/dev/null || git diff main..HEAD --stat
git diff develop..HEAD 2>/dev/null || git diff main..HEAD
```

Se `develop` não existir, use `main`. Se ambos falharem, use `HEAD~1..HEAD`.

### 2. Executar gates

Execute os comandos abaixo e capture o resultado de cada um. **Se algum falhar, registre no relatório e marque como bloqueante.**

```bash
# Smoke do bot
pnpm tick 2>&1 || pnpm --filter @gladibot/bot tick 2>&1 || echo "bot smoke não rodável"

# Type-check (quando TS instalado)
pnpm --filter bot typecheck 2>/dev/null || echo "typecheck não configurado"

# Build web (quando apps/web existir)
pnpm --filter web build 2>/dev/null || echo "apps/web não existe ainda"

# Validação de docs
bash docs/validate-docs.sh
```

Registre para cada comando:
- ✅ Passou
- ❌ Falhou — output completo do erro
- ⚪ N/A — se o comando não existe nesta fase do projeto

### 3. Revisar o diff

Para cada arquivo alterado, analise contra os critérios abaixo. Registre cada achado com: **severidade**, **arquivo:linha**, **descrição** e **sugestão**.

#### Arquitetura — Regras Fundamentais (CLAUDE.md)

- [ ] **Regra 1:** código novo simula click em vez de chamar AJAX? → **Bloqueante**
- [ ] **Regra 2:** POST sem `x-csrf-token`? → **Bloqueante**
- [ ] **Regra 3:** tentativa de auto-login Google? → **Bloqueante**
- [ ] **Regra 4:** controle não-acessível resolvido via click visual em vez de mapear endpoint AJAX? → **Bloqueante**
- [ ] **Regra 5:** state local persistente do bot entre ticks (HP/cooldown cacheado)? → **Bloqueante**
- [ ] **Regra 6:** heal greedy "não extrapolar" violado? → **Alto**
- [ ] **Regra 7:** cooldowns de exp/masm não mais independentes? → **Bloqueante** (sem DEC)

#### Padrões de Código (prompt.bot.md / CODE_PATTERNS.md)

- [ ] Action com side-effect sem checar `isActionsEnabled()` antes? → **Bloqueante**
- [ ] `client.getHtml` em check secundário concorrente (deveria ser `fetchRawHtml`)? → **Bloqueante**
- [ ] Parser de HTML sem regex defensivo (sem `?` ou `*` onde HTML do jogo varia)? → **Alto**
- [ ] `console.log` em vez de `log.debug/info/warn/error`? → **Médio**
- [ ] Tokens (`sh`/`csrf`/cookies) logados completos sem mask? → **Bloqueante**
- [ ] Hardcode de URL/IDs do servidor BR62 fora de `.env`/`config.js`? → **Bloqueante**
- [ ] Comentário explicando WHAT em vez de WHY? → **Baixo**

#### Documentação

- [ ] Endpoint AJAX novo no código sem entrada em `docs/endpoints.md`? → **Bloqueante**
- [ ] Mudança de ordem do tick sem atualizar `docs/flows.md`? → **Alto**
- [ ] Decisão arquitetural permanente sem `DEC-XX` em `docs/DECISIONS.md`? → **Alto**
- [ ] Débito identificado sem `DEBT-XX` em `docs/TECHNICAL_DEBT.md`? → **Médio**
- [ ] Feature concluída sem entrada em `docs/PROJECT_STATE.md`? → **Médio**

#### Convenção de Commit (docs/CONTRIBUTING.md)

- [ ] Title fora de `<tipo>(<escopo>): <descrição imperativa>`? → **Bloqueante**
- [ ] Escopo inválido (não é `bot|web|shared|docs|claude|deps`)? → **Alto**
- [ ] `Co-Authored-By: Claude` ou footer "Generated with Claude Code"? → **Bloqueante**
- [ ] Descrição vaga (`update`, `wip`, `ajuste`)? → **Alto**

#### Segurança

- [ ] Cookie/CSRF/session hash hardcoded? → **Bloqueante**
- [ ] Path absoluto do home do dev no diff? → **Alto**
- [ ] `.env` versionado? → **Bloqueante**
- [ ] Snapshot real do jogo com nomes de outros jogadores? → **Alto**

### 4. Gerar o relatório

Salve em `docs/reviews/review-<nome-da-branch>-<YYYY-MM-DD>.md` (crie a pasta se necessário) usando o template:

```markdown
---
tags: [review, pr]
branch: <nome-da-branch>
date: <YYYY-MM-DD>
base: <develop|main>
reviewer: Claude Code
---

# Code Review — `<nome-da-branch>`

## Resumo

| Campo | Valor |
|---|---|
| Branch | `<nome-da-branch>` |
| Base | `<develop\|main>` |
| Autor(es) | <nomes do git log> |
| Commits | <N> |
| Arquivos alterados | <N> arquivos (+<add> / -<del>) |
| Recomendação | ✅ Aprovar \| ⚠️ Aprovar com ressalvas \| 🚫 Solicitar mudanças |

## Gates

| Etapa | Resultado |
|---|---|
| `pnpm tick` (smoke) | ✅ Passou \| ❌ Falhou \| ⚪ N/A |
| `pnpm --filter bot typecheck` | ✅ Passou \| ❌ Falhou \| ⚪ N/A |
| `pnpm --filter web build` | ✅ Passou \| ❌ Falhou \| ⚪ N/A |
| `bash docs/validate-docs.sh` | ✅ Passou \| ❌ Falhou |

## Achados

> Ordenados por severidade. **Bloqueantes** impedem merge.

### 🚫 Bloqueantes

<!-- Se não houver: "Nenhum." -->

#### `caminho/arquivo.js` linha X

**Problema:** descrição.

**Regra violada:** referência (ex: Regra Arquitetural #4 do CLAUDE.md, DEBT-XX).

**Sugestão:**
\`\`\`javascript
// código corrigido
\`\`\`

---

### ⚠️ Altos
<!-- Se não houver: "Nenhum." -->

### 🔵 Médios
<!-- Se não houver: "Nenhum." -->

### ℹ️ Baixos / Sugestões
<!-- Se não houver: "Nenhum." -->

## Pontos Positivos

<!-- O que foi bem feito nesta PR -->

## Checklist Final

**Arquitetura:**
- [ ] Regras 1-7 do CLAUDE.md preservadas
- [ ] Toda action com side-effect gateada por `isActionsEnabled()`
- [ ] Checks secundários usam `fetchRawHtml`, não `client.getHtml`

**Código:**
- [ ] Parser defensivo (regex tolerante)
- [ ] Logging estruturado (`log.*`, não `console.log`)
- [ ] Sem hardcode de servidor (BR62)
- [ ] Sem cache de tokens

**Docs:**
- [ ] Endpoints novos em `docs/endpoints.md`
- [ ] Decisões em `docs/DECISIONS.md`
- [ ] Débitos em `docs/TECHNICAL_DEBT.md`
- [ ] PROJECT_STATE atualizado

**Commit:**
- [ ] Conventional Commits estrito (`<tipo>(<escopo>): <descrição>`)
- [ ] Sem `Co-Authored-By: Claude` / "Generated with Claude Code"
```

### 5. Reportar no chat

Exiba:
1. O caminho do arquivo gerado.
2. Resumo em até 10 linhas: recomendação + achados críticos + resultado dos gates.
3. O bloco markdown completo para colar diretamente no comentário da PR.

### 6. Pós-aprovação — sincronizar documentação

**Após a PR ser aprovada e mergeada**, lembre o usuário de rodar `/checkpoint` para sincronizar `PROJECT_STATE.md`, `TECHNICAL_DEBT.md` e a memória com o novo estado do código.

## Regras

- Não altere nenhum arquivo de código durante este fluxo — apenas leia e reporte.
- Se o diff ultrapassar 500 linhas, priorize actions, parsers, orchestrator; sinalize os demais como "revisão superficial".
- Sempre registrar pontos positivos — review unilateralmente negativo é menos útil.
- O relatório deve ser autocontido: quem lê sem contexto do projeto deve entender o problema e a solução.
