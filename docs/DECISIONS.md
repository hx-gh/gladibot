---
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Architectural Decision Records

> Decisões permanentes. Registre `DEC-XX` quando uma escolha tiver consequência longa-duração e/ou alternativas reais consideradas e rejeitadas. Numere sequencialmente. Não edite decisões antigas — supersede com nova.

---

### [DEC-01] Playwright só pra sessão; ações via AJAX direto

**Data:** 2026-04-28
**Contexto:** Precisávamos automatizar ações no Gladiatus. Login Google requer OAuth real (browser); ações do jogo são chamadas AJAX bem definidas.
**Decisão:** Usar Playwright `launchPersistentContext` (channel `msedge`) para gerenciar sessão e cookies. Para cada ação, **não** clicar em botões via Playwright — usar `page.request.get/post` que herda os cookies, mas envia HTTP "puro" pros endpoints AJAX que descobrimos.
**Alternativas rejeitadas:**
- *Pure HTTP fetch + cookies em `.env`*: rejeitado porque cookies/CSRF expiram e renovação requer OAuth, e gerenciar isso à mão é frágil.
- *Pure Playwright (clicar tudo)*: rejeitado por ser ~10x mais lento e mais detection-prone.
**Consequências:** Sessão é persistente entre runs. Velocidade é equivalente a HTTP puro. Login Google ainda é manual (1 vez por expiração). Refresh de CSRF é automático em 401/403.

---

### [DEC-02] Heal greedy "não extrapolar"

**Data:** 2026-04-28
**Contexto:** O usuário tem múltiplos itens de cura com valores diferentes. Comer um item de 1.965 quando faltam só 700 HP desperdiça 1.265.
**Decisão:** Quando HP < `HEAL_THRESHOLD_PCT` (default 20%), escolher o **maior item onde `heal_nominal ≤ HP_max - HP_atual`**. Se nenhum couber (ex: HP quase cheio), usar o **menor** (overflow mínimo aceitável).
**Alternativas rejeitadas:**
- *Sempre o maior*: desperdiça itens caros.
- *Stacking até ficar full*: complexo e inútil em prática (~95% já é "full" funcional).
**Consequências:** Em cenários de HP muito baixo (2%), nenhum item supre 100%, mas a regra ainda escolhe o melhor disponível. `heal_aplicado` pode ser menor que `heal_nominal` (modificador de Inteligência); usamos `heal_nominal` como cap por ser conservador.

---

### [DEC-03] Bridge userscript só pra mapeamento, não runtime

**Data:** 2026-04-28
**Contexto:** Controles do tipo `<img onclick="startFight(...)">` não aparecem na árvore de acessibilidade — `browsermcp` não consegue clicar.
**Decisão:** O Tampermonkey userscript `gladibot-bridge.user.js` cria `<a aria-label>` pra cada controle invisível, **apenas durante o desenvolvimento via Claude+browsermcp**. Depois de mapear o endpoint AJAX real (via DevTools Network), o bot Node usa o endpoint diretamente — não depende mais do bridge.
**Alternativas rejeitadas:**
- *Bridge em runtime do bot*: implicaria rodar Tampermonkey + browser visível 24/7 só pra fazer ações.
- *Simular drag-drop com mouse events*: frágil (jQuery UI muda comportamento), lento.
**Consequências:** Bot runtime é puro Node + Playwright + HTTP. O bridge fica como ferramenta de mapeamento — sempre que descobrirmos novo controle invisível, estendemos o bridge, capturamos cURL via DevTools, e plugamos no Node.

---

### [DEC-05] Parser do overview via IDs específicos do DOM

**Data:** 2026-04-28
**Contexto:** Primeira tentativa do parser foi via regex genérico (`(\d+)\s*/\s*(\d+)`) procurando padrões "X/Y" no HTML. Resultado: capturava lixo (`exp=34/8`) porque o HTML tem dezenas de pares numéricos não-relacionados (timers, dimensões CSS, etc).
**Decisão:** Parser usa **IDs e atributos específicos do Gladiatus** observados no HTML real:
- `#sstat_gold_val`, `#sstat_ruby_val` → ouro/rubis
- `#header_values_hp_bar[data-value][data-max-value]` → HP absoluto
- `#expeditionpoints_value_point` + `_pointmax` → pontos de expedição
- `#dungeonpoints_value_point` + `_pointmax` → pontos de masmorra
- Chamadas `new ProgressBar(...)` em JS para extrair cooldowns (timestamps epoch start/current/end)
- `<meta name="csrf-token" content="...">` para o CSRF
- Inventário via `data-content-type="64"` + `data-tooltip` JSON-encoded

**Alternativas rejeitadas:**
- *Regex genérico*: rejeitado pelos falsos positivos.
- *page.evaluate via Playwright*: mais lento (round-trip ao browser), só vale se DOM mudasse muito — não é o caso.
**Consequências:** Parser fica acoplado à estrutura HTML do Gladiatus (BR62). Se patch do jogo mudar IDs, quebra — mas falha clara (campo vira `null`), fácil de detectar e corrigir. Confirmado funcionando: TICK reporta `HP=2736/2736 (100%) gold=11091 exp=24/24 dung=22/24 food=9` com valores reais.

---

### [DEC-06] Lobby URL como entrada (vs `mod=overview` direto)

**Data:** 2026-04-28
**Contexto:** Bot precisa do usuário fazer login Google manualmente. Lobby (`lobby.gladiatus.gameforge.com`) é a entrada natural; usuário escolhe servidor lá. Clicar "Jogar" abre **nova aba** no servidor configurado.
**Decisão:** Bot abre na lobby via `LOBBY_URL` (configurável). `ensureLoggedIn` observa **todas as abas do contexto** via polling em `ctx.pages()` e retorna a aba que aterrisar em `${BASE_URL}/game/index.php`. `index.js` usa essa aba dali pra frente — não a inicial.
**Alternativas rejeitadas:**
- *Abrir direto em `mod=overview`*: o servidor redireciona pra login do Gameforge, fluxo de login fica menos natural. E se sessão expirou, perde o contexto da escolha de servidor.
- *Observar só `page` inicial*: quebra quando "Jogar" abre nova aba (caso real reportado pelo user).
**Consequências:** Usuário deve **deixar a aba do lobby aberta** durante a sessão (fechar pode levar Chromium a derrubar o popup-opener). Bot é robusto a multi-aba mas não é robusto a fechamento prematuro do opener.

---

### [DEC-07] `client.getHtml` via `page.goto` (com JS), não `page.request`

**Data:** 2026-04-28
**Contexto:** Inicialmente `getHtml` usava `page.request.get` (HTTP puro). Resultado: HTML retornado pelo servidor não tinha tooltips JSON nem alguns campos populados via JS — parser falhava.
**Decisão:** `getHtml` agora navega a página real (`page.goto`) e retorna `page.content()`. JS roda, DOM fica completo, parser tem tudo. `getAjax` e `postForm` continuam usando `page.request` (endpoints AJAX retornam dados crus).
**Alternativas rejeitadas:**
- *Manter `page.request` + injetar JS via `page.evaluate`*: complexo demais, gasto de manutenção.
**Consequências:** State fetch fica ~500ms-1s mais lento (navegação completa), mas isso é desprezível ante o cooldown de 60s entre ataques. Side-effect bom: `sh` da URL fica sempre fresco, e cookies são atualizados pelo servidor a cada visita.

---

### [DEC-09] Detectar "trabalhando" via GET separado a `mod=work`

**Data:** 2026-04-28
**Contexto:** Bot disparava `attackDungeon` mesmo com personagem trabalhando (manualmente ou via `startWork`). Análise dos HTMLs reais: `mod=overview` não tem qualquer indicador de trabalho ativo — pontos continuam regenerando, cooldowns ficam zerados. `mod=dungeon&loc=N` retorna a masmorra normal mesmo em trabalho, com `startFight()` clicáveis. A única página com sinal confiável é `mod=work`, que mostra um ticker `data-ticker-time-left="X" data-ticker-type="countdown"` enquanto há trabalho em andamento.
**Decisão:** Orchestrator faz GET extra a `mod=work` no início de cada tick via `client.fetchRawHtml` (HTTP puro, não navega a aba do bot). `parseWork(html)` em `src/state.js` extrai `{ active, secondsLeft, jobName }`. Se `active`, pula heal/exp/dung/work_start e dorme `secondsLeft + 10s slack`. Estado anexado ao snapshot pra UI mostrar banner.
**Alternativas rejeitadas:**
- *Inferir trabalho a partir de overview (ex: pontos zerados + cooldowns prontos)*: heurística frágil — mesma situação acontece quando user simplesmente está dormindo sem trabalhar.
- *Lembrar localmente que mandamos trabalhar*: não cobre o caso do user mandar trabalhar manualmente. Falsos negativos catastróficos (bot ataca durante trabalho).
- *Navegar `mod=work` via `getHtml`*: faria a aba do jogo pular pra essa página, atrapalhando user e race com tick subsequente. `fetchRawHtml` é puro HTTP e não interfere.
**Consequências:** +1 GET por tick (~1KB resposta), desprezível ante o cooldown de 60s entre ações. Bot dorme corretamente até trabalho terminar. Slack de 10s evita race com server (gold credit, status flip). Funciona pra todos os jobs (parser usa o `<h1>` e o ticker, sem hardcoding por jobType).

---

### [DEC-10] Catálogos JSON estáticos (`data/affixes.json` + `data/formulas.json`)

**Data:** 2026-04-28
**Contexto:** Painel 2 (Leilão Fase 1) precisa de catálogos de prefixos/sufixos (affixes) para filterizar a listagem por "⭐ Só top prefix/suffix". Painel será expandido em fase 2 com recomendador de upgrade (comparação item leiloado vs equipado) e executor de regras de autobuy. Paralelamente, formulários de cálculo de damage/defense/healing pedem catálogo de fórmulas (funções do jogo).
**Decisão:** Armazenar catálogos como **JSON estáticos versionados** em `data/`, **não** em SQLite ou memória do bot.
- `data/affixes.json` (335KB): 228 prefixos + 317 sufixos com `{ name, level, top, effects[], rawStats }` — construído via pipeline: curl do fansite (top-prefixes/top-suffixes tabulares) + Playwright render (prefixes/suffixes SPA em React) → parse DOM → json unified.
- `data/formulas.json` (17KB): 38 fórmulas (combat, defense, critical, healing, regen, items, stats, upgrades, experience) com `{ id, key, category, expression, effects[], _review }` — expression é JS-evaluable (ex: `"str + dex / 2"`), permite futura computação de valores derivados.
- Load on-demand (singleton cache em `src/affixCatalog.js` + futuro `src/formulaCatalog.js`); retorno imediato.

**Alternativas rejeitadas:**
- *SQLite*: Fase 2 Leilão pode escalá-lo pra persistir estado de sniper (bids, histórico). Hoje é overkill — JSON é mais portável, versionável, e rápido pra load na memória.
- *Hardcodar em arrays JS*: Ilegível (228 + 317 + 38 entries = impossível review/manutenção).
- *Fetch em runtime do fansite*: Catálogos do fansite são estáticos (patch notes mudam, raramente). Cachear localmente reduz latência e decoupling com infraestrutura externa.

**Consequências:**
- `data/` vira diretório versionado do repo. Atualizações de catálogo = commit + push (rara, mais de 1x por mês é improvável).
- Pipeline scrape (`docs/wip/auction/scrape-affixes.mjs` + `build-affixes.mjs`) fica em scratchpad gitignored — dev roda 1x quando quiser atualizar.
- Parser de Leilão pode enriquecer listings com flags `top`, colorir suffixes desconhecidos.
- **DEBT-06** (sufixos PT↔EN) mitiga o impacto de estar em EN: mapping manual dos 36 top-suffixes é manutenção única, viável.
- Formulas com `_review:true` (4 entries) ficam assinaladas — dev revisita futura se valores não baterem com jogo real.

---

### [DEC-08] UI vanilla local (Express + HTML/CSS/JS) servida pelo próprio bot

**Data:** 2026-04-28
**Contexto:** Loop 24/7 sem visualização força tail de log no terminal. Usuário pediu UI pra monitorar status, controlar pause/resume e disparar ticks manuais. Precisa começar leve antes de evoluir pra catálogo de leilão e regras de autobuy.
**Decisão:** Servidor Express bind em `127.0.0.1:3000` (configurável via `UI_PORT`, sobe junto com `--loop`). Frontend é HTML/CSS/JS puros em `src/ui/public/` — sem React, sem Vite, sem build step. Comunicação por polling fetch a cada 2s. Estado vivo é mantido in-memory em `src/botState.js` (singleton mutável). Ring buffer de logs (200 linhas) — log também escreve em `logs/session.log` truncado a cada startup pra debug fora do browser.
**Alternativas rejeitadas:**
- *React/Vite SPA*: build step + dependências pesadas, exagero pra v0.
- *Electron / TUI*: Electron exagerado; TUI ruim pra tabela grande de leilão (futuro).
- *WebSocket/SSE*: polling de 2s é simples e suficiente; só vira streaming se logs ficarem volumosos.
- *Persistir estado da UI em disco entre runs*: usuário explicitamente pediu reset por sessão pra facilitar debug.
**Consequências:** Bot continua single-package (UI mora em `src/ui/`). `--loop` sempre sobe UI por default; `--no-ui` ou `UI_ENABLED=false` desliga. `--once` continua headless. **Releva regra 5 do CLAUDE.md** ("sem state local persistente do bot") em UM ponto: estado *do jogo* continua vindo do servidor a cada tick (sem cache), mas estado *do bot* (snapshot mais recente, status do loop, logs) vive em memória pra ser servido. SQLite virá em decisão futura quando fase 2 do leilão (catálogo) entrar.

---

### [DEC-11] Parser do leilão: dual-format `[[label, delta], [color1, color2]]` como fonte de verdade

**Data:** 2026-04-29
**Contexto:** Ao parseizar o tooltip do leilão, o jogo envia alguns rows em formato "dual" `[[itemLabel, deltaString], [color1, color2]]` quando há item equipado pra comparar. Exemplo: `[["Força +13% (+20)", "+3% (+4)"], ["#00B712", "#FF0000"]]` — o primeiro array é `[label no item, delta relativo ao equipado]`, o segundo é cores. Antes dessa sessão, esses rows eram parseados mas o `delta` (delta string) era **descartado**, deixando `tooltip.item.stats` incompleto. A comparação cliente então **recalculava** o delta — solução frágil e redundante.
**Decisão:** Reconhecer o formato dual e **preservar o delta** calculado pelo jogo. `parseAuctionTooltipBlock` agora mantém `delta` em cada stat `{ label, color, delta }`. Função `itemCompare.js` usa `deltaSign(delta)` como fonte de verdade quando disponível; só recalcula por valores numéricos quando delta não veio (format simples).
**Alternativas rejeitadas:**
- *Ignorar delta e sempre recalcular*: redundante, não aproveita fonte de verdade do servidor.
- *Diferir parsing pra client*: aumenta complexidade na UI.
**Consequências:** Parser fica mais fidedigno. `itemCompare.js` é mais robusto contra rounding/mudanças de fórmula — confia no jogo como referência.

---

### [DEC-12] Consolidação flat+% pra stats principais (6 atributos)

**Data:** 2026-04-29
**Contexto:** O jogo lista "Força +7" (flat) e "Força +13% (+20)" (percent) como linhas separadas num mesmo item. Pra UI de comparação, isso cria confusão: parecem 2 votos (1↑ flat, 1↓ percent) quando na verdade pra o char importa o efetivo total = 7 + 20 = 27 flat.
**Decisão:** `itemCompare.consolidateMainStats` identifica os 6 atributos principais (Força, Destreza, Agilidade, Constituição, Carisma, Inteligência) e consolida flat+% numa única linha: `"Força +27 (+7 + +20)"`. Stats secundários (Dano range, Armadura, Saúde, Cura, Regen, etc.) ficam sem consolidação. Score `isUpgrade` então vê corretamente 1 up em vez de 2 votos conflitantes.
**Alternativas rejeitadas:**
- *Consolidar todos os stats*: incorreto — Dano, Armadura, Cura têm regras diferentes (não se somam igual).
- *Mostrar flat+% separados na UI*: confunde o usuário na recomendação.
**Consequências:** `itemCompare.js` cresce ~50 linhas. Score `isUpgrade` fica mais acurado. Parser não muda — consolidação é filtragem cliente.

---

### [DEC-13] `itemType` vem de `data-basis`, não `data-content-type`

**Data:** 2026-04-29
**Contexto:** Elemento `.row.item` no leilão tem dois atributos: `data-basis="1-12"` (categoria/tipo do item) e `data-content-type="16"` (slot/container). Antes dessa sessão, `parseAuctionList` capturava `itemTypeId` de `data-content-type`, que é **slot do inventory** (16=Weapon, 32=Armor, etc), não categoria do item real (1=Arma, 2=Escudo, 3=Armadura, etc). Resultado: UI filteriza errado.
**Decisão:** `parseAuctionList` agora captura `data-basis="1-12"`, separa por `-` pra obter `itemType=1` e `itemSubtype=12` (ex: Arma lvl 12). `data-content-type` descartado.
**Alternativas rejeitadas:**
- *Manter `data-content-type`*: confunde slot com categoria.
- *Fazer mapping entre slots e categorias*: desnecessário — `data-basis` já traz a resposta.
**Consequências:** `parseAuctionList` extrair 2 novos campos (`itemType`, `itemSubtype`). `itemCompare.buildComparison` usa `itemType` pra chamar `categoryLabel` e enriquecer com etiqueta "Arma", "Escudo", etc.

---

### [DEC-14] Score `isUpgrade` usa `lvlDiff/5` pra capturar gap de level

**Data:** 2026-04-29
**Contexto:** Antes, `isUpgrade` era puramente contagem de stats: `ups > downs`. Cenário quebrado: item lvl 65 vs equipado lvl 32, item tem 2↑4↓ (score = -2, vira "não-upgrade") — mas na verdade é upgrade claro porque 33 levels acima compensa perder alguns flats velhos.
**Decisão:** `summarizeRows` calcula `score = (ups − downs) + lvlDiff / 5`. Cada 5 levels de gap valem 1 ponto. Item lvl 65 vs 32 = gap 33 = 6.6 pts, score final = (2 - 4) + 6.6 = 4.6 → `isUpgrade = score > 0` → upgrade confirmado.
**Alternativas rejeitadas:**
- *Ignorar level*: deixa heurística incompleta pra itens muitos levels acima.
- *Usar threshold fixo (ex: level diff > 10)*: arbitrário, não escala bem.
**Consequências:** Recomendação fica mais realista. `score` é decimal (ex: 4.6) — UI mostra rounded pra 1 casa. Itens velhos mas muitos levels acima saem como upgrade.

---

### [DEC-15] Badge `RECOMENDADO` é client-side, baseado no snapshot vivo do char

**Data:** 2026-04-29
**Contexto:** `isUpgrade` é feature genérica (sem char context) — item lvl 65 é upgrade contra equipado lvl 32 **em qualquer situação**. Mas "recomendado" deve ser personalizado: qual stat seu char precisa mais? Se seu char tem Força 100 e max 130 (gap 30) e outro item traz +20 Força, é recomendado. Se seu char tem Força 100 e max 100 (gap 0), não faz falta.
**Decisão:** `src/ui/app.js` implementa `analyzeRecommendation(listing, charSnapshot)` pra cada listing. Loop pelos stats principais consolidados; se stat mostra `sign > 0` (upgrade nessa dimensão), calcula `gap = max − total` (onde total é do char). Conta stats com `gap > 0`. `isRecommended = isUpgrade && fillsGaps.length > 0`. Substituir badge `↑ UPGRADE` por `✨ RECOMENDADO` quando aplica.
**Alternativas rejeitadas:**
- *Server-side recomendação*: precisa de char context — server não tem.
- *Machine learning*: overkill; heurística simples de "preenche gap" é suficiente.
**Consequências:** UI precisa manter `lastSnapshot` (do último poll) disponível ao renderizar leilão. Client-side não causa refetch. Badge muda dinamicamente conforme char evolui (sem atualizar leilão).

---

### [DEC-04] Documentação espelhando o sistema do webservices-core

**Data:** 2026-04-28
**Contexto:** O usuário tem um repo (webservices-core) com sistema maduro de docs/memória/contexto. Quer trazer a mesma disciplina pro gladibot.
**Decisão:** Adotar a estrutura `CLAUDE.md` raiz + `docs/{INDEX,PROJECT_STATE,DECISIONS,TECHNICAL_DEBT,CONTRIBUTING,DEVELOPMENT_WORKFLOW,CODE_PATTERNS}.md` + `.claude/{settings.json, commands, agents}` + hook PostToolUse de session log + agent `doc-keeper`. Versão **enxuta** — sem builders de stack (backend/frontend), sem `/implement` etc, porque gladibot é single-package, single-stack, single-dev.
**Alternativas rejeitadas:**
- *Cópia literal do webservices-core*: muitos arquivos seriam inaplicáveis (PAYMENTS_COMPLETION_PLAN, FRONTEND_MAP).
- *Manter só `docs/memory.md` + `flows.md`*: insuficiente — sem ADR, sem débito tracking, sem checkpoint flow.
**Consequências:** Trabalho extra de manter docs sincronizadas. Em troca: continuidade entre sessões do Claude, decisões registradas, débitos visíveis. Quando o projeto crescer (multi-bot, multi-server?), a estrutura escala.
