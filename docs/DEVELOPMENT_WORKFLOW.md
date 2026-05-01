---
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Development Workflow

## Setup inicial

```bash
cd projetos/gladibot
pnpm install                 # baixa Playwright + Edge channel automaticamente
cp .env.example .env
# .env funciona como está; ajuste só BASE_URL se mudar de servidor
```

**Primeira run** (login):

```bash
pnpm tick
```

Edge abre. Login Google manual. Quando cair em `mod=overview`, bot detecta e roda 1 tick. Perfil salvo em `./browser-data/` (root do repo).

## Comandos de desenvolvimento

```bash
pnpm tick                    # 1 tick (debug/teste)
pnpm loop                    # loop infinito até Ctrl+C

# Alternativas com filter explícito:
pnpm --filter @gladibot/bot tick
pnpm --filter @gladibot/bot loop

# Debug:
cd apps/bot && node --inspect src/index.js --once    # debug com Edge DevTools (edge://inspect)

LOG_LEVEL=debug pnpm tick    # logs verbosos
HEADLESS=true pnpm loop      # roda invisível em background
```

## Mapear novo fluxo do jogo

Padrão consolidado:

1. **Inspecionar visualmente:** abrir Claude Code com browsermcp na aba do Gladiatus, navegar até o estado relevante, snapshot.
2. **Identificar o controle:** botão real (visível na árvore), `<img onclick="..">` invisível, ou form submit.
3. **Capturar a request:** F12 → Network → filtro Fetch/XHR → executar a ação manualmente → "Copy as cURL" da request mais recente.
4. **Documentar:** entrada nova em `docs/endpoints.md` com método, URL, params, headers, body, response shape.
5. **Implementar:** novo arquivo em `apps/bot/src/actions/<feature>.js` ou estender existente.
6. **Plugar no orchestrator** (`apps/bot/src/orchestrator.js`) se for parte do loop.
7. **Atualizar `docs/flows.md`** com o fluxograma.

### Atalho: controles invisíveis (`<img onclick="...">`)

Se o controle não tem `aria-label` nem texto, browsermcp não consegue clicar. Estratégia recomendada:

1. Abra DevTools → Network → execute a ação manualmente.
2. "Copy as cURL" da request disparada.
3. Use o endpoint AJAX diretamente no Node bot.

Alternativamente, um Tampermonkey userscript ad-hoc pode criar `<a aria-label>` temporários para inspeção via browsermcp durante o mapeamento — eliminar do runtime após capturar o cURL real.

## Debug

### Logs

- `LOG_LEVEL=debug` mostra cada request HTTP no stdout.
- Tail de log em arquivo: `pnpm loop 2>&1 | tee bot.log`
- Filtros úteis: `grep -E "TICK|HEAL|EXPEDITION|DUNGEON" bot.log`

### Inspector Node

```bash
cd apps/bot && node --inspect src/index.js --once
# → Edge → edge://inspect → "inspect"
```

Aba **Network** do DevTools do Node mostra cada request HTTP (mesma vibe de inspecionar o jogo).
Pode botar breakpoint em `apps/bot/src/orchestrator.js`, em `apps/bot/src/state.js#parseOverview`, etc.

### Sessão expirada

Sintoma: `SessionExpiredError` no log.

Causa: cookie de login Google expirou (raro, semanas).

Fix: rode `pnpm tick` (não-headless) e refaça login na janela aberta.

### Bot não acha endpoint

Sintoma: HTTP 404 ou response vazio.

Causa provável: jogo mudou parâmetro do endpoint (acontece em patch).

Fix: recapture cURL via DevTools, atualize `apps/bot/src/actions/<feature>.js` e `docs/endpoints.md`.

## Ciclo `/checkpoint`

Antes de cada commit não-trivial:

1. `/checkpoint` (no Claude Code) — invoca `doc-keeper`.
2. Doc-keeper varre `docs/wip/.session-changes.log` + `git status`, decide o que sincronizar (PROJECT_STATE, DECISIONS, TECHNICAL_DEBT, endpoints, flows, memória).
3. Apresenta diff. Você revisa.
4. Você commita.

## Quando algo dá errado

| Sintoma | Provável causa | Onde olhar |
|---|---|---|
| `SessionExpiredError` | Login expirou | Re-rodar `pnpm tick` headful |
| `HTTP 403` recorrente | CSRF dessincronizado | `apps/bot/src/client.js` deve auto-refresh; se não, limpar `browser-data/` |
| `Could not extract sh/csrf` | Layout da overview mudou | `apps/bot/src/browser.js#readSession` precisa novo regex |
| Bot trava no `waitForURL` no login | Browser foi fechado | Não fechar manualmente; usar Ctrl+C no terminal |
| `pnpm install` falha em `playwright install` | Edge não detectado | Instalar Edge stable, ou trocar `BROWSER_CHANNEL=chromium` |
| Bot consome ouro pra cura quando não deveria | `HEAL_THRESHOLD_PCT` errado | Ajustar `.env` |
