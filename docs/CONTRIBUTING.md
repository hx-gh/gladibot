---
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Contributing

> Versão 1-dev: simples, sem PR review formal. Quando virar multi-dev, expandir.

## Branch e commits

- Trabalhar direto em `main` é OK pra ajustes pequenos.
- Pra mudanças não-triviais, branch curta: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`.
- Commits em **português**, imperativo, primeira letra minúscula:

```
feat(actions): adiciona work submit endpoint

- captura cURL do "Ir!" da página de trabalho
- plug no orchestrator para acionar quando ambos os pontos = 0
- atualiza endpoints.md
```

Tipos comuns: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.

## Definition of Done (DoD)

Antes de commitar uma mudança:

1. ✅ **Bot roda** com `node src/index.js --once` sem erro.
2. ✅ **Sem `console.log` esquecido** — usar `log.debug/info/warn/error`.
3. ✅ **Sem segredos** no diff: cookie strings, CSRF tokens, sh, paths absolutos do home do dev.
4. ✅ **Docs atualizadas:**
   - Novo endpoint AJAX → `docs/endpoints.md`.
   - Novo fluxo do loop → `docs/flows.md`.
   - Decisão arquitetural → `docs/DECISIONS.md` com `DEC-XX`.
   - Débito identificado → `docs/TECHNICAL_DEBT.md` com `DEBT-XX`.
   - Débito resolvido → mover para §Resolvidos.
   - Feature concluída → atualizar `docs/PROJECT_STATE.md`.
5. ✅ **`/checkpoint`** — invocar antes do commit pra sincronizar docs+memória.

## Fluxo típico de uma feature

1. **Pensar/explorar:** scratchpad em `docs/wip/<slug>.md` (gitignored).
2. **Mapear** (se for fluxo novo do jogo): browsermcp via Claude Code + DevTools Network.
3. **Implementar:** seguir padrões em `docs/CODE_PATTERNS.md`.
4. **Testar manualmente:** `node src/index.js --once`.
5. **Atualizar docs** (DoD acima).
6. **`/checkpoint`** (subagent `doc-keeper` faz sync mecânico).
7. **Commit** — mensagem clara, sem skip de hooks.

## O que NÃO commitar

- `.env` (use `.env.example` como template)
- `browser-data/` (perfil Playwright)
- `node_modules/`
- `docs/wip/*` (scratchpads efêmeros — gitignored automaticamente)
- Cookies, CSRF tokens, session hashes em qualquer arquivo
- Snapshots reais do jogo com nomes de jogadores/IDs além do `AidsEgipicia` (que já está em docs como referência única)

## Sessão de Claude Code

- Confiar nas memórias persistentes (`~/.claude/projects/.../memory/`) — `doc-keeper` mantém alinhadas com `docs/PROJECT_STATE.md`.
- Em conflito entre memória e repo: **repo vence** (atualizar memória).
- `docs/wip/.session-changes.log` é alimentado automaticamente pelo hook PostToolUse — não editar manualmente.
