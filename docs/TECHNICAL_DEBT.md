---
date: 2026-04-28
updated: 2026-04-29
---

# Gladibot — Technical Debt

> Débitos abertos com IDs únicos (`DEBT-XX`). Quando resolver, mover para §Resolvidos com data e referência (commit/sessão).

## Prefixos

- **DEBT** — débito genérico (mais comum num bot single-package)

Quando o projeto crescer e justificar, separar em prefixos finos (`SEC`, `INFRA`, `BACK`, ...).

---

## Abertos

### DEBT-03 — Refresh de sessão expirada não-automático

**Arquivo**: `src/browser.js`, `src/index.js`
**Problema**: Em 401/403, o cliente já tenta uma vez re-extrair `sh+csrf` via `refreshSession`. Se isso também falhar (ex: cookie de login expirou de fato), o bot exit code 2 e pede pra usuário re-rodar. Não há recovery automático que dispare novo flow de login.
**Impacto**: 🟡 Baixo — login Google expira raramente (semanas?). Aceitável pedir intervenção manual.
**Ação** (se virar prioridade): detectar redirect para `login.gameforge.com` e abrir o browser não-headless mesmo se o `.env` pediu headless, esperar o usuário concluir, retomar.
**Esforço**: ~1h
**Prioridade**: 🟡

### DEBT-06 — Catálogo de sufixos só em EN; leilão BR usa PT-BR

**Arquivo**: `data/affixes.json`, `src/affixCatalog.js`
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

**Arquivo**: `src/itemCompare.js`, `consolidateMainStats`
**Problema**: Hardcoded em `CONSOLIDATABLE_STATS` = {força, destreza, agilidade, constituição, carisma, inteligência}. Se o jogo adicionar novos atributos ou modificar a consolidação, o código fica defasado.
**Impacto**: 🟡 Baixo — atributos estão estáveis no jogo (parece não haver plano pra adicionar).
**Ação**: Ao atualizar `data/affixes.json` (próximo patch do jogo), revisar lista de atributos principais em `CONSOLIDATABLE_STATS`.
**Esforço**: ~5 min (uma linha de grep/map)
**Prioridade**: 🟢

### DEBT-08 — `analyzeRecommendation` na UI só analisa stats com max conhecido

**Arquivo**: `src/ui/app.js`, `analyzeRecommendation`
**Problema**: Função que calcula `isRecommended` depende de `charSnapshot.stats[statKey].max` — valor de cap do atributo. Stats cujo max não é extraído do parser (ex: `max === null`) são ignorados na análise de gap. Resultado: item que preenche Dano (stat sem max no snapshot) não sai recomendado mesmo sendo upgrade.
**Impacto**: 🟡 Médio — stats secundários (Dano, Cura, Regen) tendem a ter cap booleano (0 ou não-0), não intervalo descoberto. `analyzeRecommendation` pode ser muito conservador.
**Ação**: Estender parser de stats para capturar `max` mesmo pra stats secundários (se tooltip do char expõe). Ou: usar heurística alternativa (ex: if sign > 0 && stat não é "mesma coisa" do que já tem, contar).
**Esforço**: ~30 min (revisar tooltip de stats no jogo real, confirmar formato)
**Prioridade**: 🟡

### DEBT-10 — Skip do boss da masmorra quando char não consegue vencer

**Arquivo**: `src/actions/dungeon.js`, `src/config.js`, `.env.example`
**Problema**: Bot ataca todos os fights por ordem de `posi` (menor primeiro). Em masmorras onde o boss é mais forte que o char, o bot encadeia derrotas no boss e drena pontos de masmorra à toa. Não há flag pra pular o boss e ficar idle (ou resetar pra Normal) até o player decidir lutar manualmente.
**Bloqueador**: Detecção do boss não pode ser por `posi` fixa — varia por masmorra (cada uma tem fases definidas por missões até liberar o boss). Precisa ser via texto/marcador no HTML (ex: a palavra "chefe" perto do `<img onclick="startFight(...)">`, ou indicador de fase/missão concluída na página).
**Ação**:
1. Capturar sample HTML da página da masmorra **na fase do boss** em `docs/wip/dungeon-boss-sample.html` (e idealmente outro sample na fase de monstros normais pra comparar).
2. Desenhar parser que retorne `isBoss: bool` por fight em `parseDungeonFights`.
3. Adicionar flag `DUNGEON_SKIP_BOSS` em `config.js` + `.env.example`. Quando true e o único fight disponível for boss, retornar `{ acted: false, reason: 'boss skipped' }` (deixa o ponto pra reset manual). Comportamento de "reset automático ao chegar no boss" fica pra fase 2, depois de validar que `restartDungeon` funciona com boss vivo.
4. Opcional: toggle a quente na UI (similar a `ACTIONS_ENABLED`).
**Impacto**: 🟠 Médio — sem isso, qualquer ramp de zona nova queima pontos até o player perceber e desligar manualmente o bot.
**Esforço**: ~30 min (após sample HTML em mãos); ~0 sem o sample.
**Prioridade**: 🟠

### DEBT-05 — Mapeamento de `loc`/`stage` por nível do char

**Arquivo**: `src/actions/expedition.js`, `src/actions/dungeon.js`, `.env`, `.env.example`
**Problema**: Os IDs `loc=N` (e `stage=N` dentro de cada loc) persistem na URL, mas a região e o monstro mapeados mudam conforme o char destrava novas regiões do mapa global. Hoje só sabemos os nomes da região atual via captura manual de `mod=location&loc=N` / `mod=dungeon&loc=N`. Se o user subir nível e migrar de região, o `.env` precisa ser revisitado.
**Impacto**: 🟢 Baixo — afeta só configuração, não código. Sem efeito até aqui foram só comentários stale.
**Ação**: Adicionar parser de listing de monstros em `mod=location&loc=N` (5 stages com nome+nível) e expor na UI um picker que escreve no `.env`. Mesmo pra dungeon. Enquanto isso fica manual.
**Esforço**: ~1h
**Prioridade**: 🟢

---

## Resolvidos

| ID | Descrição | Data | Ref |
|---|---|---|---|
| DEBT-01 | Endpoint "Ir!" do trabalho capturado e plugado em `src/actions/work.js` (POST `index.php?mod=work&submod=start` com `jobType`+`timeToWork`) | 2026-04-28 | sessão 2026-04-28 |
| DEBT-02 | Endpoint "Normal" da masmorra capturado e plugado em `src/actions/dungeon.js` (POST `index.php?mod=dungeon&loc=<loc>` com `dif1=Normal`); fix do `isDungeonEntryPage` (input, não button) | 2026-04-28 | sessão 2026-04-28 |
| DEBT-04 | UI vanilla local entregue (Express + `src/ui/public/`, polling 2s, pause/resume/tick-now). Ver DEC-08. | 2026-04-28 | sessão 2026-04-28 |
| DEBT-09 | Parser de "meu lance" via `bidderName` (link `<a mod=player>`) + comparação com `charName` no enrichResult. Sample real capturado em `docs/wip/auction/leilao-after-bid.html`. Ver DEC-21. | 2026-04-29 | sessão 2026-04-29 |
