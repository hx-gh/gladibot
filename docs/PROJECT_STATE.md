---
date: 2026-04-28
updated: 2026-05-01
---

# Gladibot — Project State

Snapshot vivo. Atualizar ao concluir feature ou ao identificar mudança de prioridade.

## Stack

- Node.js 18+ (ESM, `"type": "module"`)
- TypeScript 5 + `tsx` (runtime loader, sem build step — DEC-31)
- Playwright 1.49 (channel `msedge`, persistent context)
- dotenv 17 (lê `.env` do root do repo via path absoluto em `apps/bot/src/config.ts`)
- pnpm 10.32.1 + TurboRepo 2.x (monorepo — PR 2 mergeado)
- `packages/shared` — pacote type-only com 8 grupos de tipos canônicos (BotSnapshot, WorkStatus, AuctionListing, CharacterRow/EquippedItemRow, MercSuggestion, LoopStatus/BotStateView, REST request/response)
- Sem lib de teste por enquanto (1 dev, MVP)

> **Em migração (roadmap):** TypeScript em `apps/bot` e `apps/web`, Next.js 15 App Router + Tailwind + shadcn/ui. Framework Claude com agentes tech-architect/bot-builder/code-reviewer instalado (PR 1 mergeado). Monorepo skeleton (PR 2 pronto pra mergear). Ver `docs/wip/framework-monorepo-migration.md` (scratchpad ativo — PRs 3-5). Ver DEC-28, DEC-29, DEC-30.

## Componentes

| Componente | Status | Notas |
|---|---|---|
| `apps/bot/src/browser.ts` (Playwright bootstrap) | ✅ Pronto | Detecta login multi-aba; readSession navega overview pra extrair `sh`+`csrf` (meta tag) |
| `apps/bot/src/client.ts` (HTTP + retry em 401/403) | ✅ Pronto | `getHtml` via `page.goto` (JS roda); auto-refresh CSRF |
| `apps/bot/src/state.ts` (parser overview) | ✅ Pronto | Parser por IDs específicos (gold/HP/pontos/cooldowns/inventário); parsers de char/paperdoll/leilão dual-format — validado em produção |
| `apps/bot/src/itemCompare.ts` (pareamento e consolidação) | ✅ Pronto | `pairStats(itemBlock, equippedBlock, {useGameDelta})`, `consolidateMainStats`, `summarizeRows` com score lvlDiff/5, `buildComparison`. Dual-format parsing, flat+% consolidação pra 6 atributos (DEC-11, DEC-12) |
| `apps/bot/src/actions/heal.ts` | ✅ Pronto | Greedy "não extrapolar" |
| `apps/bot/src/actions/expedition.ts` | ✅ Pronto | `mod=location&submod=attack` |
| `apps/bot/src/actions/dungeon.ts` | ✅ Pronto | `startFight` por AJAX + `restartDungeon` (POST `dif1=Normal`) quando boss cai. `parseDungeonFights` marca `isBoss` via `<div class="map_label">Chefe`; `DUNGEON_SKIP_BOSS` (default true) filtra boss e dispara `cancelDungeon`+`restartDungeon` quando só sobra boss (DEBT-10) |
| `apps/bot/src/actions/work.ts` | ✅ Pronto | POST `index.php?mod=work&submod=start` (`jobType`+`timeToWork`); aceita `opts={force,jobType,hours}` pra fallback AFK |
| `apps/bot/src/orchestrator.ts` (tick loop) | ✅ Pronto | Heal pre → top-off comida (packages + autobuy leilão) → AFK fallback se ainda lowHp+noFood → exp → masm → work fallback → heal post; chama `setSnapshot` a cada parse |
| `apps/bot/src/actions/packages.ts` | ✅ Pronto | `parsePackages` + `openPackages/openHealPackages`: drena `mod=packages` movendo cada item pra slot livre via `findFreeBagSlot` (8×5 grid). `from=-packageId`, mesmo POST `mod=inventory&submod=move` da cura |
| `apps/bot/src/actions/buyHeal.ts` | ✅ Pronto | Auto-compra de cura no leilão (`itemType=7`). Filtra `healNominal/buyoutGold ≥ AUTOBUY_HEAL_MIN_RATIO` (default 3), buyout-only, ignora listings com lance. Loop até `AUTOBUY_HEAL_TARGET` (default 5) ou budget per-tick exausto |
| `apps/bot/src/botState.ts` (state in-memory + ring buffer) | ✅ Pronto | Singleton: snapshot, loopStatus, logs (ring 200) |
| `apps/bot/src/ui/server.ts` + `public/` (control panel) | ✅ Pronto | Express :3000 (127.0.0.1), polling 2s, pause/resume/tick-now; tab Leilão + endpoint `/api/auction` |
| `apps/bot/src/actions/auction.ts` | ✅ Pronto | `fetchAuctionList(client, {ttype, filter})` + `placeBid` plugado via UI (POST `/api/auction/bid`). Marca ID em `botState.myBidAuctionIds` pra parser cobrir gap até sample real |
| `apps/bot/src/mercSuggestions.ts` (recomendador v2) | ✅ Pronto | DEC-20. Score magnitude-weighted (`statWeight × roleBoost × Δ`), waste check, cost efficiency, top affix bonus, dedup ring1/ring2, soulbound flag. Exporta `enrichListingWithWaste` reusado pelo Painel 2 |
| `apps/bot/src/formulas.ts` (evaluator) | ✅ Pronto | Mini-evaluator de `apps/bot/data/formulas.json`. `auctionLevelRange(playerLevel)` aplica `auction-min-level` / `auction-max-level` pra popular `<select>` dinamicamente |
| `apps/bot/src/actions/characters.ts` | ✅ Pronto | `fetchCharacter(client, doll)` + `fetchAllCharacters(client)`. Varre doll=1..6 em paralelo. Usa `noXhr: true` (DEC-17) |
| `apps/bot/src/db.ts` (SQLite via node:sqlite) | ✅ Pronto | DEC-18. Schema characters + equipped_items, upsert sem histórico. WAL mode. apps/bot/data/state.db gitignored |
| `apps/bot/src/state.ts` parsers de char (paperdoll) | ✅ Pronto | `parseEquipped`, `parseDollTabs`, `parseCharSnapshot`. 9 slots equipados (helm/weapon/offhand/armor/ring1/ring2/pants/boots/amulet) |
| `apps/bot/src/state.ts` parsers de leilão | ✅ Pronto | `parseAuctionList(html)` + tooltip duplo (item + equipado) |
| `data/affixes.json` (catálogo) | ✅ Pronto | 228 prefixos + 317 sufixos; 87 com `top:true`; effects[] estruturados |
| `data/formulas.json` (catálogo) | ✅ Pronto | 38 fórmulas (combat/defense/critical/healing/regen/items/etc) com `expression` em JS |
| Resiliência tick errors | ✅ Pronto | Erro dentro de tick → log.warn + retry em 30s; SessionExpiredError e bootstrap continuam fatais |
| `apps/bot/src/log.ts` (sink ring + arquivo) | ✅ Pronto | Console + ring buffer + `apps/bot/logs/session.log` truncado por sessão |
| Tampermonkey userscript (ad-hoc) | ✅ Pronto (abordagem) | Usado durante mapeamento de controles invisíveis via DevTools; não versionado |

## Features

### Completas

| Feature | Data |
|---|---|
| Bridge userscript (heals + dungeon fights) | 2026-04-28 |
| Captura de endpoints: heal, dungeon fight, expedition attack | 2026-04-28 |
| Bot Node.js base (Playwright + AJAX) | 2026-04-28 |
| Lobby flow (entrada via lobby.gladiatus, multi-aba) | 2026-04-28 |
| Parser de overview por IDs (HP, ouro, pontos, cooldowns, inventário) | 2026-04-28 |
| Validação end-to-end no WSL (chromium + WSLg) | 2026-04-28 |
| `actions/work.js` real (DEBT-01 fechado) | 2026-04-28 |
| `actions/dungeon.js` auto-restart (DEBT-02 fechado) | 2026-04-28 |
| Heal pré + pós-luta no orchestrator | 2026-04-28 |
| UI vanilla local (Express + HTML/CSS/JS, polling 2s) — DEBT-04 fechado | 2026-04-28 |
| Kill switch de actions (env + CLI `--no-actions` + UI toggle) | 2026-04-28 |
| Detecção de "trabalhando" via `mod=work` + gating no orchestrator (banner na UI) | 2026-04-28 |
| UI rica: hero card (avatar+nome+lvl+HP), stats dos 6 atributos, banner de buffs (globais + pessoais), card de Treinamento com botões (gated por kill switch + ouro), redesign de layout mais denso | 2026-04-28 |
| Painel 2 Leilão — Fase 1 (read-only): parser, action, endpoint API, UI com tabs/filtros/lista | 2026-04-28 |
| Painel 2 Leilão — Fase 1.5 (comparação rica + recomendação): `apps/bot/src/itemCompare.js`, parsing dual-format, consolidação flat+%, `RECOMENDADO` por gap | 2026-04-29 |
| Catálogo de prefixos/sufixos (`data/affixes.json`): 228 + 317 entries, top flag, scrape via curl + Playwright render | 2026-04-28 |
| Catálogo de fórmulas (`data/formulas.json`): 38 entries com expression JS-evaluable | 2026-04-28 |
| Resiliência: tick errors não derrubam loop (warn + retry 30s) | 2026-04-28 |
| AFK fallback no orchestrator: HP baixo + sem comida → Rapaz do Estábulo 8h (DEC-16) | 2026-04-29 |
| Painel 4 Personagens — Tab Mercenários no card Char: parser de paperdoll (9 slots) + actions/characters.js + SQLite + endpoints `/api/characters[/attributes\|/items]` + UI grid de 6 cards (DEC-17, DEC-18) | 2026-04-29 |
| Painel 3 Sugestões Mercs — recomendador de upgrade pros 4 mercs em 1 fetch único (`/api/mercs/suggestions`), comparação local via SQLite (`readEquippedBlock`) reusando `pairStats`/`summarizeRows`. Click no candidato → scroll+expand no Painel 2 | 2026-04-29 |
| Auction list — chip "com lance / sem lance" no card de listing (rendering do `hasBids` que o parser já produzia) | 2026-04-29 |
| Painel 2 Leilão — Bid via UI: botões Lance/Comprar por listing, parser estendido (`myBid`/`currentBid`/`formTtype`), endpoint `POST /api/auction/bid` gated, filtros "só com lances"/"só meus lances", chip ★ "MEU LANCE" e tracking local de IDs em `botState.myBidAuctionIds` (DEC-21) | 2026-04-29 |
| Painel 3 Sugestões Mercs — merc role-weighted score (DEC-22, DEC-23) | 2026-04-30 |
| Skip do boss da masmorra (DEBT-10) — parser detecta `<div class="map_label">Chefe`, `DUNGEON_SKIP_BOSS` (default true) filtra boss; se só sobra boss, `cancelDungeon` + `restartDungeon` automáticos no mesmo tick (volta a ter monstros normais) | 2026-04-30 |
| Heartbeat de sessão durante sleep (DEC-24) — `interruptibleSleep` dispara `readSession` a cada [45s,135s] com jitter pra evitar redirect silencioso pro lobby durante inatividade | 2026-04-30 |
| Dropdown do leilão parseado do HTML real (DEC-25) — `itemLevelOptions` extraído via `<select name="itemLevel">` no HTML cru, não por fórmula | 2026-04-30 |
| Top-off de comida no orchestrator (DEC-26) — antes do AFK fallback, drena packages com `Usar: Cura X` (move pra bag via `from=-packageId`) e auto-compra no leilão (itemType=7, ratio heal/preço ≥ 3, buyout-only) até `AUTOBUY_HEAL_TARGET`. Resolve o "pause-pra-trabalhar" sem queimar pontos | 2026-05-01 |
| Framework Claude adotado (PR 1) — agentes tech-architect/bot-builder/code-reviewer, comandos /implement /audit-sync /review-pr, docs/validate-docs.sh (gate), docs/reviews/, prompt.bot.md, CLAUDE.md § Framework, CONTRIBUTING.md com Conventional Commits estritos. Nenhuma mudança em `apps/bot/src/`. (DEC-28) | 2026-05-01 |
| Monorepo skeleton (PR 2) — pnpm workspaces + TurboRepo; `src/` → `apps/bot/src/`; `data/` → `apps/bot/data/`; `config.js` lê `.env` do root via path absoluto; `browser-data/` permanece no root; dotenv@17; `pnpm tick` / `pnpm loop` como comandos principais. (DEC-29) | 2026-05-01 |
| PR 3 (`refactor/bot-typescript`) — TypeScript 5 em `apps/bot` via `tsx` runtime, rename `.js → .ts` em todos os `apps/bot/src/` (exceto `ui/public/`), `tsconfig.json` strict+noEmit, `packages/shared` type-only com 8 grupos de tipos canônicos, `pnpm typecheck` como gate obrigatório. (DEC-31) | 2026-05-01 |

### Em andamento

_(nenhuma)_

### Pendentes

| Feature | Bloqueio |
|---|---|
| Refresh de sessão automático | Não-MVP. Ver DEBT-03 |
| **Painel 2 Leilão Fase 2:** catálogo SQLite + sniper de subvalorizados + UI de regras autobuy + executor automático | Bid manual via UI ✅ entregue 2026-04-29; autobuy automático segue gated até regras + sniper |
| **Painel 3: Forja** (Fornalha + Fundição + Bancada + Horreum) | Mapear endpoints AJAX de cada uma; precisa de cURL via DevTools no jogo real |
| Tab "Lojas" no Painel 2 (Mercado + estabelecimentos do menu) | Subordinada a evolução do Painel 2 |
| **Aplicar fórmulas no projeto** (evaluator + valores derivados na UI: DPS estimado, EHP, hit chance, regen real, caps) | Próxima sessão |
| ~~Recomendador de upgrade~~ | ✅ Entregue 2026-04-29 (Painel 3 Sugestões Mercs) |
| Pendências de captura do leilão | `ttype` semantics; marker "seu lance"; aba Tudo sem filtro — descobrem rodando o bot |

## Próximas Ações Sugeridas

1. **Commitar e abrir PR 3** (`refactor/bot-typescript`) — TypeScript 5 + tsx + `packages/shared` type-only pronto para revisão e merge em `develop`. Gate: `pnpm typecheck` → 0 erros.
2. **Iniciar PR 4** (`feat/web-nextjs`) — `apps/web` Next.js 15 App Router + Tailwind + shadcn/ui; 4 painéis em paridade com a UI Express atual; bot passa a expor HTTP em `:3001`; deleta `apps/bot/src/ui/`. Pré-requisito: `@gladibot/shared` types prontos (entregue no PR 3).
3. **Validar end-to-end no jogo** — `pnpm tick` (do root) cobrindo:
   - heal disparando com HP < 20% (start do bot e pós-luta);
   - dungeon entrando automaticamente após boss cair (POST `dif1=Normal`);
   - work iniciando com `jobType=2` quando ambos os pools zeram.

## Métricas observadas (sessão 2026-04-28)

- Ouro/expedição (Lobo Sanguinário, level 41): ~1.500 ouro/luta
- Ouro/expedição (Escaravelho Gigante, level 41-42): ~2.500 ouro/luta
- Tick (expedição+masmorra simultâneos): **+3.827 ouro** validado em produção
- HP máx atual: **2.736** (level 50, +25 vs level 49 anterior)
- Regen: 3.294/h
- Cooldown por ataque: ~60s real (independente entre slots; Speed x5 não acelera)
