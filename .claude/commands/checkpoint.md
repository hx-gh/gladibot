---
description: Captura aprendizados da sessão e sincroniza docs+memória antes de um /clear ou commit. Delega ao agente doc-keeper.
---

# /checkpoint — Sincronização Antes do /clear ou Commit

Persiste aprendizados da sessão em `docs/` e `memory/` invocando o agente **`doc-keeper`**, que faz a sincronização determinística baseada em `docs/wip/.session-changes.log` (alimentado pelo hook PostToolUse) e `git diff`.

## Quando usar

- **Antes de `/clear`** — obrigatório se a sessão teve decisões, padrões novos, bugs resolvidos com contexto não-óbvio, ou feedback direto do usuário sobre comportamento
- **Antes de commitar** mudanças que afetam estado documentado (feature concluída, débito resolvido, novo módulo)
- **Após fechar uma PR** — para migrar aprendizados do `docs/wip/` para memória persistente
- **Ao mudar drasticamente de contexto** — ex: passar de bot para UI

## Procedimento

### 1. Resumo da sessão (você, antes de invocar o agente)

Em até 10 bullets, liste o que aconteceu de relevante. Isso é input para o `doc-keeper`:

- Decisões arquiteturais tomadas
- Bugs encontrados e a causa-raiz
- Feedback do usuário (corretivo ou validador)
- Padrões confirmados ou descobertos
- Endpoints AJAX novos capturados
- Erros de julgamento corrigidos

Descarte:
- Conteúdo de commit messages (já em git log)
- Status momentâneos (smoke verde)
- Detalhes de implementação que o código já expressa

### 2. Invocar `doc-keeper`

Despache o agente via `Agent` tool com `subagent_type: "doc-keeper"`. Modelo padrão: `haiku`. Escale para `sonnet` se o diff é grande/ambíguo.

No `prompt` do agente, inclua:
- O resumo dos 10 bullets acima
- Slug da feature (se aplicável) — ex: `framework-claude`
- Indicação se a feature está mergeada (autoriza deletar `docs/wip/<slug>.md`) ou em andamento

O agente vai:
- Ler `.session-changes.log` + `git diff`
- Atualizar docs do repo conforme mapeamento (PROJECT_STATE, DECISIONS, TECHNICAL_DEBT, endpoints, flows, CODE_PATTERNS, memory)
- Atualizar memórias Claude
- Rodar `bash docs/validate-docs.sh`
- Truncar `.session-changes.log`
- Apresentar relatório em formato padrão e mensagem de commit sugerida

### 3. Revisar o relatório

Antes de commitar:
- Confirme que cada `✅` reflete mudança real desejada
- Se o agente sugeriu débito que você não quer registrar, peça remoção
- Se faltou algo (ex: nova memória), peça complementar
- Mensagem de commit sugerida: ajuste tipo/escopo conforme convenção do `docs/CONTRIBUTING.md`

### 4. Commit

Você decide o commit. **Nunca** comite por iniciativa do agente. Não use `Co-Authored-By: Claude` nem footer "Generated with Claude Code".

## Regras

- O `doc-keeper` **não cria** docs novos em `docs/`. Se algo demanda doc novo, ele reporta — você decide criar manualmente
- O `doc-keeper` faz **edits cirúrgicos** com `Edit`; preserva o resto dos arquivos
- Em conflito memória vs. repo, **`PROJECT_STATE.md` vence**
- Memórias `feedback_*.md` são sinal puro — nunca delete sem confirmar com o usuário
- Se a sessão foi trivial (só uma pergunta respondida, sem código), diga isso e **não invoque** o agente para criar arquivos vazios
