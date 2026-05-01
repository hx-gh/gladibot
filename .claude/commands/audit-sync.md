---
description: Detecta drift entre código e docs/memória — varre git log, actions, parsers vs PROJECT_STATE/endpoints/flows/CODE_PATTERNS/TECHNICAL_DEBT. Comando de manutenção, sem args.
---

# /audit-sync — Auditoria de Drift

Comando de **manutenção**. Detecta descompassos entre o estado real do código e o que `PROJECT_STATE.md`, `endpoints.md`, `flows.md`, `CODE_PATTERNS.md`, `TECHNICAL_DEBT.md` e a memória local declaram. Útil quando você suspeita que a documentação ficou para trás (especialmente após múltiplos commits sem `/checkpoint` rodando).

## Sem argumentos

Comando autônomo. Não exige escopo — varre tudo.

## Execução

### 1. Validação rígida

```bash
bash docs/validate-docs.sh
```

Reportar erros e warnings. Se a validação falha, isso já é o primeiro achado — siga com a auditoria mesmo assim.

### 2. Drift de PROJECT_STATE vs git log

```bash
git log --oneline --since="30 days ago"
```

Confrontar commits recentes com a tabela "Features Completas" do `PROJECT_STATE.md`. Apontar:

- Commits que parecem feature concluída mas não estão em "Completas"
- Itens em "Em Andamento" há > 30 dias (provavelmente abandonados ou esquecidos)
- Itens em "Bloqueios" cuja causa pode ter sido resolvida

### 3. Drift de endpoints.md vs actions

```bash
grep -rn "client\.\(get\|post\)" src/actions/ apps/bot/src/actions/ 2>/dev/null
```

Para cada chamada AJAX no código, conferir se o endpoint está catalogado em `docs/endpoints.md` (método, URL, params, headers, body, shape do response). Apontar:

- Endpoints chamados no código ausentes no doc
- Endpoints no doc ausentes no código (action removida sem limpar)
- Divergência de params (campo novo no código que o doc não menciona)

### 4. Drift de flows.md vs orchestrator

```bash
cat src/orchestrator.js apps/bot/src/orchestrator.js 2>/dev/null
```

Confrontar a ordem de execução do tick com o fluxograma em `docs/flows.md`. Apontar:

- Ramos novos no orchestrator (heal post, autobuy, AFK fallback, packages) não refletidos no flows
- Fluxogramas referenciando ações que foram removidas

### 5. Drift de CODE_PATTERNS vs código

Padrões documentados em `docs/CODE_PATTERNS.md` (HTTP client retry, parser defensivo, kill switch via `isActionsEnabled`, logging estruturado) ainda batem com o código? Apontar regressões.

### 6. Drift de TECHNICAL_DEBT vs estado real

Varrer débitos abertos (`### DEBT-XX`). Para cada um:

- Procurar evidência de resolução em `git log --grep=<ID>` ou `git log --grep=<keyword>`
- Se commit recente parece resolver mas débito ainda em aberto → sinalizar
- Se débito cita arquivo/função que não existe mais → sinalizar

### 7. Drift de memória vs repo

Listar memórias `project_*.md` em `~/.claude/projects/<hash>/memory/` e checar se cada uma tem reflexo coerente em `docs/PROJECT_STATE.md`. Em conflito, **`PROJECT_STATE.md` vence** — a memória é que precisa atualizar.

### 8. Sync via `doc-keeper` (opcional, com confirmação)

Se o drift for tratável mecanicamente (poucos itens, edits cirúrgicos), proponha invocar `doc-keeper` para aplicar as correções. **Não invoque sem confirmação** — drift grande é sinal de housekeeping dedicado, não de fix automatizado.

### 9. Staging final (obrigatório se aplicar correções)

Após aplicar correções, `git add` nos arquivos tocados e apresente `git diff --staged --stat` + mensagem sugerida. **Não comite.** Aguarde feedback.

## Output esperado

```markdown
## Audit sync — <YYYY-MM-DD>

### Validação
- ✅/❌ `bash docs/validate-docs.sh` (X erros, Y warnings)

### Drift de PROJECT_STATE
- 🟡 Commit `<hash>` "<msg>" parece feature concluída mas não está em PROJECT_STATE.md
- 🟡 "<Item X>" em "Em Andamento" há 45 dias — abandonado?

### Drift de endpoints.md
- 🟠 `POST mod=auction&submod=bid` chamado em `src/actions/auction.js:142` ausente no doc
- 🟢 (resto OK)

### Drift de flows.md
- 🟡 Ramo "autobuy heal" no orchestrator (`src/orchestrator.js:88`) ausente no flows.md

### Drift de CODE_PATTERNS
- 🟠 `src/actions/buyHeal.js:34` usa `console.log` — viola padrão de logging documentado

### Drift de TECHNICAL_DEBT
- 🟠 DEBT-XX cita `src/actions/old-feature.js` — arquivo removido no commit `<hash>`
- 🟢 DEBT-YY arquivo/função ainda existem, débito legítimo

### Drift de memória
- 🟡 `project_<topico>.md` cita estado antigo (ex: "PR de leilão"); PROJECT_STATE atual é outro

### Ações sugeridas para doc-keeper (aguardando confirmação)
- [ ] Adicionar entrada em endpoints.md para `POST mod=auction&submod=bid`
- [ ] Mover DEBT-XX para § Resolvidos com ref ao commit `<hash>`
- [ ] Atualizar `project_<topico>.md` para refletir PROJECT_STATE atual

### Ações que precisam de você (não automatizáveis)
- [ ] Decidir status de "<Item X>" em "Em Andamento" há 45 dias
- [ ] Revisar feature do commit `<hash>` — concluída ou parcial?
```

## Notas

- Esse comando **não muda código** — apenas docs e memória (e só após confirmação).
- Bom rodar antes de release/tag, ou periodicamente (a cada ~2 semanas de uso ativo).
- Se o drift for muito grande, considere uma sessão dedicada de housekeeping em vez de fix automatizado.
- O `/checkpoint` cobre o ciclo "edit → sync" da sessão atual; `/audit-sync` cobre o drift acumulado de ciclos passados onde o `/checkpoint` não rodou.
