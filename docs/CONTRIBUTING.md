---
date: 2026-04-28
updated: 2026-05-01
---

# Gladibot — Contributing

> Estágio: 1 dev hoje, com plano de hosting BYOK. Branches `main` (produção) + `develop` (integração). Conventional Commits estritos.

## Modelo de Branches

```
main
 └── develop
      ├── feat/<descricao-curta>
      ├── fix/<descricao-curta>
      ├── chore/<descricao-curta>
      ├── refactor/<descricao-curta>
      ├── docs/<descricao-curta>
      └── hotfix/<descricao-curta>   (origem: main)
```

| Branch      | Descrição                                                      | Protegida |
|-------------|----------------------------------------------------------------|-----------|
| `main`      | Código em produção. Nunca recebe push direto.                  | Sim       |
| `develop`   | Branch de integração. Base para todas as features.             | Sim       |
| `feat/*`    | Nova funcionalidade. Sempre parte de `develop`.                | Não       |
| `fix/*`     | Correção de bug não crítico. Parte de `develop`.               | Não       |
| `hotfix/*`  | Correção urgente em produção. Parte de `main`.                 | Não       |
| `chore/*`   | Tarefas técnicas sem impacto funcional (deps, configs, framework). | Não   |
| `docs/*`    | Apenas documentação.                                           | Não       |
| `refactor/*`| Refatoração sem mudança de comportamento.                      | Não       |
| `test/*`    | Adição ou ajuste de testes.                                    | Não       |

### Regras de nome

- Letras minúsculas e hífens. Nunca espaços, underscores ou CamelCase.
- Descrição curta: máximo 5 palavras, sem artigos.
- Sem ticket Jira (não usamos). `feat/auction-snipe`, não `feat/AID-123-auction-snipe`.

---

## Convenção de Commits — Conventional Commits estritos

```
<tipo>(<escopo>): <descrição imperativa>
```

Exemplos:

```bash
feat(bot): adicionar gate de lances baseado em globalTimeBucket
fix(bot): corrigir parser de itemLevelOptions em char lvl >= 70
chore(claude): adicionar agente bot-builder e comando /implement
refactor(bot): migrar src/state.js para TypeScript
docs(decisions): registrar DEC-27 sobre lances só em Curto
chore(deps): atualizar playwright para 1.50
```

### Tipos

| Tipo       | Quando usar                                                  |
|------------|--------------------------------------------------------------|
| `feat`     | Nova funcionalidade do bot ou da UI                          |
| `fix`      | Correção de bug                                              |
| `hotfix`   | Correção urgente em produção                                 |
| `chore`    | Tarefas de manutenção (deps, configs, framework Claude)      |
| `docs`     | Apenas documentação                                          |
| `refactor` | Refatoração sem mudança de comportamento externo             |
| `test`     | Adição ou correção de testes                                 |
| `style`    | Formatação (sem mudança de lógica)                           |

### Escopos válidos

| Escopo     | Cobre                                                       |
|------------|-------------------------------------------------------------|
| `bot`      | `apps/bot/src/` (Node + Playwright + AJAX)                  |
| `web`      | Futuro `apps/web/` (Next.js + Tailwind + shadcn)            |
| `shared`   | Futuro `packages/shared/` (tipos compartilhados)            |
| `docs`     | `docs/**`, `README.md`                                      |
| `claude`   | `.claude/**`, `prompt.bot.md`                               |
| `deps`     | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`     |

### Regras

- Descrição no **imperativo**: "adicionar", "corrigir", "atualizar" — não "adicionado", "corrigindo", "atualiza".
- Máximo de 72 caracteres na linha do título.
- Use o corpo do commit para explicar o **porquê**, não o quê.
- Um commit por unidade lógica de mudança.
- Português ou inglês indiferente, desde que imperativo e específico. Priorize clareza.
- **Sem `Co-Authored-By: Claude`** ou footer "Generated with Claude Code". Regra do framework adotado.

### Anti-padrões — recusar em review

| ❌ Ruim | Por quê | ✅ Bom |
|---|---|---|
| `feat:  ajuste no leilão` | Dois espaços, sem escopo, "ajuste" é vago | `fix(bot): corrigir gate de lance quando bucket é stale` |
| `update` / `wip` / `.` | Vazio de significado | Faça squash antes do PR |
| `feat: adicionei autobuy` | Não-imperativo (passado) | `feat(bot): adicionar autobuy de cura no leilão` |
| `chore: misc` | Vago | `chore(claude): atualizar doc-keeper para alinhar com framework` |

### Regra de ouro

> Se um dev novo, sem contexto, lesse só o título do commit daqui a 6 meses enquanto debuga um `git blame`, ele entenderia **o que mudou e por quê**?

Se a resposta é não, reescreva antes de subir o PR (`git commit --amend` ou rebase interativo).

## Definition of Done (DoD)

Antes de commitar uma mudança:

1. ✅ **Bot roda** com `pnpm tick` (do root) sem erro.
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

## Fluxo via `/implement` (recomendado)

Para feature nova ou débito > 4h, use o ciclo orquestrado:

1. `/implement <feature-slug>` — Fase 1 invoca `tech-architect` (Opus) que escreve `docs/wip/<slug>.md`.
2. **Aprove o plano.** Se houver `OPEN`, responda antes de continuar.
3. Fase 2 invoca `bot-builder` (Sonnet) que implementa.
4. Fase 3 invoca `code-reviewer` (Sonnet) que roda gates e checa regras 1-7.
5. Fase 4 invoca `doc-keeper` (Haiku) que sincroniza docs + memória.
6. Fase 5 apresenta diff + mensagem de commit. **Você** decide commit/push.

Detalhe completo em `.claude/commands/implement.md`.

## Fluxo manual (mudança trivial)

Para débito de 1 arquivo, hot-fix óbvio, edição de doc:

1. **Pensar/explorar:** scratchpad em `docs/wip/<slug>.md` (gitignored).
2. **Mapear** (se for fluxo novo do jogo): browsermcp via Claude Code + DevTools Network.
3. **Implementar:** seguir padrões em `prompt.bot.md` + `docs/CODE_PATTERNS.md`.
4. **Smoke:** `pnpm tick`.
5. **Atualizar docs** (DoD acima).
6. **`/checkpoint`** — `doc-keeper` faz sync mecânico.
7. **Commit** com Conventional Commit estrito; **sem** `Co-Authored-By: Claude`.

## Pull Requests

- Nenhum merge direto em `develop` ou `main` — sempre via PR.
- A branch deve estar atualizada com `develop` antes do merge (rebase ou merge).
- PRs com conflito não são mergeados — resolva antes.

### Título do PR

Mesmo formato do commit principal: `<tipo>(<escopo>): <descrição imperativa>`.

### Estratégia de merge

| Destino   | Estratégia       | Motivo                                      |
|-----------|------------------|---------------------------------------------|
| `develop` | **Squash merge** | Histórico limpo; um commit por feature      |
| `main`    | **Merge commit** | Preserva o contexto de cada release         |

### Body do PR (gerado pelo `doc-keeper` na Fase 4)

```markdown
## Resumo
<1-2 frases — o que muda e por quê>

## Mudanças
- <bullets curtos por área (bot/web/docs/claude)>

## Decisões / Débitos
- <DEC-XX criado | débito X resolvido | nada relevante>

## Test plan
- [ ] <comando ou cenário verificável>

## Riscos
<linha única ou "nenhum identificado">
```

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
