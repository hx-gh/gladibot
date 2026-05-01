---
name: implement
description: Ciclo completo de implementação — tech-architect plano → aprovação → bot-builder → code-reviewer → doc-keeper. Pausa em cada fase.
argument-hint: <feature-slug ou caminho para spec>
---

# /implement

Conduz o ciclo completo de uma feature, do plano técnico ao commit-ready. **Pause após cada fase** para o usuário aprovar antes da próxima.

## Argumentos

`$ARGUMENTS` — feature-slug (ex: `auction-snipe`) ou caminho explícito para spec/scratchpad existente em `docs/wip/`.

## Execução em fases

### Fase 1 — Plano técnico (`tech-architect`)

1. Invocar `tech-architect` via Agent tool (`subagent_type: "tech-architect"`, `model: "opus"`):
   - Feature alvo: `$ARGUMENTS`.
   - Spec inicial (se vier de scratchpad existente em `docs/wip/<slug>.md`).
   - Instrução: ler `CLAUDE.md`, `docs/DECISIONS.md`, `docs/PROJECT_STATE.md`, `docs/TECHNICAL_DEBT.md`, `docs/CODE_PATTERNS.md`, `docs/memory.md`, `docs/flows.md`, `docs/endpoints.md` + `prompt.bot.md`.
2. Agente cria/atualiza `docs/wip/<slug>.md` com `GOAL`/`STATE`/`PLAN`/`RISCOS`/`OPEN`.
3. **PAUSE.** Apresente o plano. Aguarde aprovação ou refinamento.

### Fase 2 — Implementação (`bot-builder`)

Após aprovação do plano:

1. Invocar `bot-builder` via Agent tool (`subagent_type: "bot-builder"`, `model: "sonnet"`).
2. Builder lê `docs/wip/<slug>.md` + `prompt.bot.md` e implementa.
3. Builder **reescreve** `STATE` no scratchpad continuamente e marca checkboxes em `PLAN`.
4. Builder **pausa** se o plano demanda mudança de regra arquitetural fundamental do `CLAUDE.md` (1-7) sem `DEC-XX` correspondente.
5. **PAUSE** após builder concluir. Apresente o diff (`git diff` + `git status --short`).

### Fase 3 — Review (`code-reviewer`)

1. Invocar `code-reviewer` via Agent tool (`subagent_type: "code-reviewer"`, `model: "sonnet"`).
2. Agente roda gates (`node src/index.js --once` smoke, `bash docs/validate-docs.sh`, `tsc --noEmit` quando TS instalado, `pnpm --filter web build` quando `apps/web` existir).
3. Verifica regras arquiteturais 1-7, `isActionsEnabled()` em todo write, `fetchRawHtml` em checks secundários, sem cache de tokens, sem hardcode de servidor.
4. Reporta achados (🔴 blockers / 🟠 ressalvas / 🟡 nits / ✅ praises) + recomendações para `doc-keeper`.
5. **PAUSE** se houver blockers. Aguarde aprovação de fix ou ajuste — Fase 2 pode ser re-executada com escopo cirúrgico.

### Fase 4 — Checkpoint (`doc-keeper`) — ANTES do commit

Após review aprovado (sem blockers), e **antes** de o usuário commitar:

1. Invocar `doc-keeper` via Agent tool (`subagent_type: "doc-keeper"`, `model: "haiku"` — escalar para `sonnet` se diff grande/ambíguo).
2. Agente faz **dupla sincronização**:

   **A) Docs do repositório** (versionados):
   - `docs/PROJECT_STATE.md` — feature movida para Completas se aplicável
   - `docs/DECISIONS.md` — novo `DEC-XX` se houve decisão arquitetural
   - `docs/TECHNICAL_DEBT.md` — débito resolvido movido para § Resolvidos OU novo débito registrado
   - `docs/endpoints.md` — endpoint AJAX novo (se descoberto)
   - `docs/flows.md` — fluxograma atualizado se mudou tick
   - `docs/CODE_PATTERNS.md` — padrão novo confirmado

   **B) Memórias Claude** (locais, fora do repo):
   - Path: `~/.claude/projects/<hash>/memory/` (ou `C:\Users\<user>\.claude\projects\<hash>\memory\` no Windows)
   - Atualizar `project_*.md` relevantes (refresh, não append)
   - Criar `feedback_*.md` se decisão consciente do owner com `Why` + `How to apply`
   - Criar `reference_*.md` se novo doc/sistema externo aprendido
   - Mover entradas obsoletas para `archive/`
   - Atualizar `MEMORY.md` (índice, ~150 chars/linha, limite ~40 entradas ativas)

3. Agente roda `bash docs/validate-docs.sh` (esperado: 0 erros).
4. Agente **trunca** `docs/wip/.session-changes.log`.
5. Agente **deleta** `docs/wip/<slug>.md` apenas se a feature está mergeada (do contrário, preserva e indica no relatório).
6. Reporta no formato padrão (Repo / Memórias / Validação / Limpeza / Mensagem de commit sugerida).

> **Por que antes do commit?** Para que ao mergear na `develop`/`main`, qualquer agente em sessão futura veja memórias e docs **alinhados com o código entregue**. Sincronizar pós-commit deixa janela de descompasso.

### Fase 5 — Commit final (manual pelo usuário)

Apresente:
- Resumo do que foi feito (técnico + impacto em produto).
- Diff completo (`git diff` + `git status --short`).
- Mensagem sugerida no formato Conventional Commits (`<tipo>(<escopo>): <descrição>`).
- **Sem `Co-Authored-By: Claude`** ou footer "Generated with Claude Code".

**O usuário decide commit/push.** Você nunca commita sozinho.

## Output esperado em cada fase

Use cabeçalhos visuais consistentes:

```
🏗️  Fase 1/5 — Plano técnico
[output do tech-architect — link para docs/wip/<slug>.md]
⏸️  Pausando para aprovação. Próxima: Implementação.

🔧  Fase 2/5 — Implementação
[diff curto + status]
⏸️  Pausando para revisão. Próxima: Code Review.

🔍  Fase 3/5 — Review
[output do code-reviewer; status APROVADO / RESSALVAS / BLOQUEADO]
⏸️  Pausando se houver blockers. Caso contrário, próxima: Checkpoint.

🗂️  Fase 4/5 — Checkpoint (docs + memórias Claude)
[output do doc-keeper — dupla sync]

✅  Fase 5/5 — Pronto para commit
[mensagem de commit sugerida; usuário decide]
```

## Notas

- Comando **mais usado** do sistema — vai ser exercitado dezenas de vezes.
- Se o plano for trivial (< 30min, escopo único, débito de 1 arquivo), pode pular Fase 1 e ir direto para Fase 2 com instruções inline no prompt do builder. Mas **sempre** passa por Fase 3 (review) e Fase 4 (checkpoint).
- Se surgir bloqueador inesperado durante Fase 2 (descoberta no código), o builder deve **parar e reportar** — não improvisar arquitetura.
- Se uma regra arquitetural fundamental do `CLAUDE.md` precisa mudar, isso vira `OPEN` no plano da Fase 1 e exige `DEC-XX` aprovado **antes** de a Fase 2 começar.
- `/checkpoint` standalone só é invocado quando há mudanças manuais fora do ciclo `/implement`. Não invoque os dois em sequência (Fase 4 já chama `doc-keeper`).
