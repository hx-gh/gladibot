---
date: 2026-04-28
updated: 2026-05-01
---

# Gladibot — Technical Debt

> Débitos abertos com IDs únicos (`DEBT-XX`). Quando resolver, mover para §Resolvidos com data e referência (commit/sessão).

## Prefixos

- **DEBT** — débito genérico (mais comum num bot single-package)

Quando o projeto crescer e justificar, separar em prefixos finos (`SEC`, `INFRA`, `BACK`, ...).

---

## Abertos

### DEBT-03 — Refresh de sessão expirada não-automático

**Arquivo**: `apps/bot/src/browser.ts`, `apps/bot/src/index.ts`
**Problema**: Em 401/403, o cliente já tenta uma vez re-extrair `sh+csrf` via `refreshSession`. Se isso também falhar (ex: cookie de login expirou de fato), o bot exit code 2 e pede pra usuário re-rodar. Não há recovery automático que dispare novo flow de login.
**Impacto**: 🟡 Baixo — login Google expira raramente (semanas?). Aceitável pedir intervenção manual.
**Ação** (se virar prioridade): detectar redirect para `login.gameforge.com` e abrir o browser não-headless mesmo se o `.env` pediu headless, esperar o usuário concluir, retomar.
**Esforço**: ~1h
**Prioridade**: 🟡

### DEBT-06 — Catálogo de sufixos só em EN; leilão BR usa PT-BR

**Arquivo**: `apps/bot/data/affixes.json`, `apps/bot/src/affixCatalog.ts`
**Problema**: O catálogo do fansite (gladiatus.gamerz-bg.com) está em inglês — sufixos lá são "of Brightness", "of Strength" etc. No servidor BR62, sufixos vêm como "do Brilho", "da Força", etc. Resultado: lookup direto por nome falha — `lookupSuffix("do Brilho")` retorna null sempre.
Prefixos não têm esse problema porque o jogo usa nomes inventados (Bilgs, Calódiens, Asendacs) que são iguais em todos os idiomas.
**Impacto**: 🟡 Médio — filtro "⭐ só top" só pega itens com **prefix** top. Sufixos top ficam invisíveis.
**Ação**: Construir mapping PT↔EN. Opções:
- Scrape próprio jogo (filtrar leilão por sufixo até cobrir todos), cross-ref com catálogo EN por stats.
- Mapeamento manual dos ~36 top-suffixes (esforço pequeno, valor alto).
- Detectar sufixo BR pela combinação `(stat, value, level)` extraída do tooltip do item.
**Esforço**: ~1h (mapping manual dos top), ~3h (scrape automatizado)
**Prioridade**: 🟡

### DEBT-07 — Consolidação de stats flat+% cobre só 6 atributos principais

**Arquivo**: `apps/bot/src/itemCompare.ts`, `consolidateMainStats`
**Problema**: Hardcoded em `CONSOLIDATABLE_STATS` = {força, destreza, agilidade, constituição, carisma, inteligência}. Se o jogo adicionar novos atributos ou modificar a consolidação, o código fica defasado.
**Impacto**: 🟡 Baixo — atributos estão estáveis no jogo (parece não haver plano pra adicionar).
**Ação**: Ao atualizar `data/affixes.json` (próximo patch do jogo), revisar lista de atributos principais em `CONSOLIDATABLE_STATS`.
**Esforço**: ~5 min (uma linha de grep/map)
**Prioridade**: 🟢

### DEBT-11 — `/api/auction/level-options` obsoleto se UI consumir direto do response do `/api/auction`

**Arquivo**: `apps/bot/src/ui/server.ts`, `apps/bot/src/ui/public/app.js`
**Problema**: Adicionado em DEC-25 como conveniência — app.js `fetchAuctionLevelOptions` faz GET a `/api/auction/level-options?ttype=...` pra sincronizar o dropdown. Mas `parseAuctionList` em `apps/bot/src/state.js` já retorna `itemLevelOptions` no response principal de `/api/auction`. UI poderia ler direto dali, economizando 1 fetch.
**Impacto**: 🟡 Cosmético — endpoint funciona, adiciona <1KB por request. Apenas inelegância arquitetural.
**Ação**: Refatorar `app.js` para consumir `data.itemLevelOptions` do response de `/api/auction`. Remover endpoint redundante e helper `fetchAuctionLevelOptions`.
**Esforço**: ~15 min
**Prioridade**: 🟢

### DEBT-12 — Detectar redirect silencioso pra `browsergamelobby` no response 200 de POST

**Arquivo**: `apps/bot/src/client.ts`, `_exec`
**Problema**: DEC-24 mitiga via heartbeat de sessão. Mas se mesmo com heartbeat algum POST cair na rota que redireciona pro lobby, a resposta é 200 com HTML (não 401/403) — não há hook de retry. Parser que espera JSON fica sem dados, fallback retorna vazio (ex: listagem do leilão). Camada 2: detectar `browsergamelobby` no `response.text()` e tratar como `SessionExpiredError`.
**Impacto**: 🟡 Rede de segurança — mitigado por DEC-24; ativa só se heartbeat falhar.
**Ação**: Adicionar check `if (text.includes('browsergamelobby')) throw new SessionExpiredError` após receber HTML do POST.
**Esforço**: ~20 min
**Prioridade**: 🟡

### DEBT-08 — `analyzeRecommendation` na UI só analisa stats com max conhecido

**Arquivo**: `apps/bot/src/ui/public/app.js`, `analyzeRecommendation` (JS puro — sai com PR 4 Next.js)
**Problema**: Função que calcula `isRecommended` depende de `charSnapshot.stats[statKey].max` — valor de cap do atributo. Stats cujo max não é extraído do parser (ex: `max === null`) são ignorados na análise de gap. Resultado: item que preenche Dano (stat sem max no snapshot) não sai recomendado mesmo sendo upgrade.
**Impacto**: 🟡 Médio — stats secundários (Dano, Cura, Regen) tendem a ter cap booleano (0 ou não-0), não intervalo descoberto. `analyzeRecommendation` pode ser muito conservador.
**Ação**: Estender parser de stats para capturar `max` mesmo pra stats secundários (se tooltip do char expõe). Ou: usar heurística alternativa (ex: if sign > 0 && stat não é "mesma coisa" do que já tem, contar).
**Esforço**: ~30 min (revisar tooltip de stats no jogo real, confirmar formato)
**Prioridade**: 🟡

### DEBT-13 — `db.ts`, `log.ts`, `formulas.ts` usam `path.resolve` relativo ao CWD

**Arquivo**: `apps/bot/src/db.ts`, `apps/bot/src/log.ts`, `apps/bot/src/formulas.ts`
**Problema**: Os 3 arquivos usam `path.resolve('data/...')` ou `path.resolve('logs')` relativos ao CWD de runtime. O PR 3 (TypeScript) preservou esse comportamento intencionalmente para não quebrar DEC-30. A alternativa correta — `path.resolve(new URL(import.meta.url).pathname, '..', 'data/...')` ou `__dirname`-equivalent via `fileURLToPath` — foi descartada do PR 3 por ser refactor fora do escopo de rename. Bot continua funcional desde que rodado via `pnpm tick` (CWD = `apps/bot/`), mas qualquer caller fora desse padrão quebra silenciosamente.
**Impacto**: 🟠 Médio — falha de IO silenciosa se CWD errado; mitigado por DEC-30 e feedback `feedback_monorepo_cwd.md`.
**Ação**: Migrar os 3 arquivos para `fileURLToPath(new URL('.', import.meta.url))` como base de path, eliminando dependência de CWD. Candidato natural para PR 4 ou hotfix isolado.
**Esforço**: ~30 min
**Prioridade**: 🟠

### DEBT-05 — Mapeamento de `loc`/`stage` por nível do char

**Arquivo**: `apps/bot/src/actions/expedition.ts`, `apps/bot/src/actions/dungeon.ts`, `.env`, `.env.example`
**Problema**: Os IDs `loc=N` (e `stage=N` dentro de cada loc) persistem na URL, mas a região e o monstro mapeados mudam conforme o char destrava novas regiões do mapa global. Hoje só sabemos os nomes da região atual via captura manual de `mod=location&loc=N` / `mod=dungeon&loc=N`. Se o user subir nível e migrar de região, o `.env` precisa ser revisitado.
**Impacto**: 🟢 Baixo — afeta só configuração, não código. Sem efeito até aqui foram só comentários stale.
**Ação**: Adicionar parser de listing de monstros em `mod=location&loc=N` (5 stages com nome+nível) e expor na UI um picker que escreve no `.env`. Mesmo pra dungeon. Enquanto isso fica manual.
**Esforço**: ~1h
**Prioridade**: 🟢

---

## Resolvidos

| ID | Descrição | Data | Ref |
|---|---|---|---|
| DEBT-01 | Endpoint "Ir!" do trabalho capturado e plugado em `apps/bot/src/actions/work.js` (POST `index.php?mod=work&submod=start` com `jobType`+`timeToWork`) | 2026-04-28 | sessão 2026-04-28 |
| DEBT-02 | Endpoint "Normal" da masmorra capturado e plugado em `apps/bot/src/actions/dungeon.js` (POST `index.php?mod=dungeon&loc=<loc>` com `dif1=Normal`); fix do `isDungeonEntryPage` (input, não button) | 2026-04-28 | sessão 2026-04-28 |
| DEBT-04 | UI vanilla local entregue (Express + `apps/bot/src/ui/public/`, polling 2s, pause/resume/tick-now). Ver DEC-08. | 2026-04-28 | sessão 2026-04-28 |
| DEBT-09 | Parser de "meu lance" via `bidderName` (link `<a mod=player>`) + comparação com `charName` no enrichResult. Sample real capturado em `docs/wip/auction/leilao-after-bid.html`. Ver DEC-21. | 2026-04-29 | sessão 2026-04-29 |
| DEBT-10 | Boss detectado via `<div class="map_label">Chefe` cruzado com `startFight(posi,did)`. Flag `DUNGEON_SKIP_BOSS` (default true) em `config.dungeon.skipBoss` filtra boss de `eligible`; se sobra só boss → `cancelDungeon` (POST `action=cancelDungeon` com `dungeonId` parseado da página) + `restartDungeon` automáticos pra começar masmorra nova com monstros normais. | 2026-04-30 | sessão 2026-04-30 |
