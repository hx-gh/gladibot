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

### [DEC-16] AFK fallback: HP baixo + sem comida → Rapaz do Estábulo 8h

**Data:** 2026-04-29
**Contexto:** Cenário não coberto no orchestrator: HP < `HEAL_THRESHOLD_PCT` **e** inventário sem comida, mas ainda há pontos de expedição/masmorra. Antes, `healIfNeeded` retornava `{ acted: false, reason: 'no food in inventory' }` silenciosamente e o tick seguia atacando — risco de morte. Como pontos de expedição/masmorra **não regeneram com o tempo** (só HP regenera), "dormir o tick esperando reset" não é alternativa: o bot ficaria travado pra sempre.
**Decisão:** Novo passo 1b no `tick`, logo após o pre-heal: se `(state.inventoryFood ?? []).length === 0 && state.hpPercent < config.heal.thresholdPct`, dispara `startWork(client, state, { force: true, jobType: 2, hours: 8 })` e retorna direto pro próximo tick. `startWork` ganhou param `opts = { force, jobType, hours }`: `force` ignora o gate de "ainda tem pontos"; `jobType`/`hours` sobrescrevem o config. Job hardcoded como Rapaz do Estábulo (id=2) por 8h (max do range [1,8]) — tempo suficiente pra HP cheio mesmo em cenário extremo (regen 3.294/h, HP máx 2.736).
**Alternativas rejeitadas:**
- *Dormir o tick (sem ir trabalhar)*: pontos não regeneram, bot trava.
- *Usar o config.work.hours/job sem override*: usuário pode mudar config pra job mais curto pensando em outros cenários; o fallback AFK precisa garantir tempo longo independente.
- *Ferreiro 12h*: longo demais — desperdiça pontos parados após HP regenerar (regen completa em ~50min real em Speed x5, vs 12h shift = 144 min real).
- *Comprar comida via mercado antes de trabalhar*: depende de Painel 3 (Forja/Lojas), ainda não implementado.
**Consequências:**
- Bot deixa de morrer em cenário AFK com inventário vazio.
- Próximo tick detecta `working` via `mod=work` (DEC-09) e dorme até o shift acabar.
- Quando shift termina, HP está cheio mas inventário continua vazio — heal sem efeito, ataques rolam normalmente; se HP cair de novo abaixo do threshold sem food, o ciclo se repete (vai trabalhar de novo).
- `config.work.hours`/`config.work.job` continuam sendo o default do passo 4 (work fallback "pontos zerados"); só o caminho 1b força jobType=2/hours=8.

---

### [DEC-17] Flag `noXhr` em `client.fetchRawHtml` para troca de doll

**Data:** 2026-04-29
**Contexto:** Pra ler stats/gear dos 6 dolls (principal + espelho + 4 mercs) o bot precisa GET `mod=overview&doll=N`. Primeiro teste com `client.fetchRawHtml` retornou **sempre o doll=1** — comparação dos 3 samples mostrou mesmos `data-item-id` e `playername` em todas as URLs. Investigação do JS do jogo (`game.js`): `selectDoll(a){document.location.href=a}` é só uma navegação simples, então o problema estava no header `x-requested-with: XMLHttpRequest` que o `_exec` injeta em **todas** as requests. O servidor PHP do Gladiatus interpreta XHR como AJAX e cai num path que ignora `?doll=N`.
**Decisão:** Adicionar opção `noXhr: true` em `client._exec` (e expor via `fetchRawHtml(path, params, { noXhr: true })`). Quando `true`, **omite** o header `x-requested-with`. `csrf-token` continua. Default do `fetchRawHtml`/outros métodos: `noXhr=false` (envia XHR header como antes — compat preservada). `actions/characters.js` é o único caller atual com `noXhr=true`.
**Alternativas rejeitadas:**
- *Usar `client.getHtml` (page.goto)*: `getHtml` navega a aba do bot, fazendo race com o orchestrator (que roda navigations próprias no tick). Não-iniciante.
- *Sempre omitir o XHR header*: quebraria comportamento dos endpoints AJAX que dependem dele (heal, attack, training).
- *Manter cookie/sessão "current doll" via clique simulado*: complexo, fragiliza, e o `selectDoll` JS já é só `location.href`.
**Consequências:** Trade-off mínimo — flag opt-in, comportamento default inalterado. Endpoint `mod=overview&doll=N` agora funciona corretamente. Documentado em `endpoints.md` como ressalva pra qualquer GET futuro que branche em XHR vs navegação.

---

### [DEC-18] SQLite via `node:sqlite` (built-in) para estado dos chars

**Data:** 2026-04-29
**Contexto:** Painel 4 (Personagens / Mercenários) precisa persistir snapshot de stats + gear equipado dos 6 dolls pra consumo via API/curl. Tentativa inicial com `better-sqlite3` falhou no Windows (requer Python + node-gyp + build tools nativas que não estão presentes). Node 22+ ganhou módulo SQLite **built-in** (`node:sqlite`) que usa libsqlite embedada — sem deps nativas, sem postinstall script. DEC-10 antecipou SQLite como "decisão futura quando fase 2 do leilão entrar"; aqui é a primeira instância concreta.
**Decisão:** Adotar `node:sqlite` (Node 22+; user roda Node 24). Schema mínimo em `src/db.js`:
- `characters (doll PK, role, name, level, hp_value, hp_max, hp_percent, armor, damage, stats_json, updated_at)`
- `equipped_items (doll, slot, ..., PK (doll, slot))` — UNIQUE composite, upsert via ON CONFLICT
- **Sem histórico** — upsert overrides o estado anterior. Se virar requisito, tabela `*_history` separada.

DB file em `data/state.db` (gitignored, junto com `state.db-wal`/`-shm`/`-journal`). WAL mode habilitado. API: `getDb()`, `persistCharacters(chars)`, `readAllCharacters()`.
**Alternativas rejeitadas:**
- *better-sqlite3*: build nativa via node-gyp; bloqueado pelo ambiente do user (Windows sem Python). Reintroduzir só vale se `node:sqlite` virar problema.
- *JSON file (igual `affixes.json`)*: catálogos JSON são versionados (DEC-10) e estáticos. Estado dos chars é dinâmico, dado real-time — JSON daria conflitos de write e seria lento pra buscas.
- *Persistir no `botState.js` (in-memory)*: não sobrevive reboot do bot. User pediu explicitamente "registrado no sqlite".
**Consequências:**
- `node:sqlite` é "experimental" em Node 24 (warning amarelo no startup). API estável, mas pode mudar — porte pra better-sqlite3 é trivial se necessário (mesma API de prepare/run, mas com `db.transaction(fn)` em vez de BEGIN/COMMIT manual).
- Endpoints `/api/characters[/attributes|/items]` aceitam `?from=db` pra ler estado salvo sem refetch — útil pra Claude consumir via curl sem bater no servidor do jogo.
- Bot continua single-package; SQLite mora em `src/db.js` + 1 file binário em `data/`.

---

### [DEC-20] Recomendador v2: score magnitude-weighted + role boost + waste check unificado

**Data:** 2026-04-29
**Contexto:** Recomendador v1 (DEC-19) usava `score = (ups − downs) + lvlDiff/5` — count puro de stats up. Problemas observados rodando contra dados reais:
1. `+21 Força` e `+5 Força` valiam o mesmo `+1 up`. Magnitude perdida.
2. Mercs com stats no cap (Asa de águia: Força 217/217, Const 310/310) recebiam itens cujo benefício era totalmente clamped — flag `wasted` existia mas só ativava em alguns paths.
3. Char principal (Painel 2) NÃO tinha waste check — listings cheias de upgrades "no papel" pra stats já cap.
4. Sem peso por role: +Força num Mestre Druida (caster) pontuava igual a +Força num Escorpião guerreiro (DPS).
5. Sem `cost-effectiveness`: candidatos com score similar mas preços muito diferentes apareciam na ordem errada.
6. Filter `itemLevelMin = char.level − 6` escondia upgrades baratos pra mercs com gear muito atrasado (ex: anel L21 num char L57 — candidato L43 era descartado).
7. `pickRingBaseline` colapsava ring1+ring2 num único baseline → ambos os slots mostravam sugestões idênticas.

**Decisão:** Refatoração completa do score em `src/mercSuggestions.js` + módulo compartilhado com Painel 2:
- **Score weighted**: `Σ (statWeight × roleBoost × Δabs) − Σ(downs ponderados) + lvlDiff/5 + topAffixBonus`. Wasted rows não contribuem.
- **`STAT_VALUE_WEIGHT`** por categoria (str/dex/.../dano/saúde/cr/etc): pesos calibrados pra +1 attribute principal valer ~20× +1 saúde.
- **`roleStatBoost(charStats, prefix)`** via `itemsMax`: stat com cap de items alto = vocação do char (peso 1.6); cap baixo = irrelevante (peso 0.25). Substitui hardcoding de roles por heurística baseada no que o jogo já tem.
- **`enrichListingWithWaste(listing, charStats)`**: helper exposto pra `auction.js` aplicar mesma lógica no Painel 2.
- **Cost effectiveness**: `efficiency = score / (gold + ruby × 1500) × 1000`. Tiebreaker quando score ~ igual.
- **`itemLevelMin`** permissivo: `max(currentSlotLevel + 5, charLevel − 14)` — cobre upgrades baratos pra slots muito atrasados.
- **Baseline = slot atual** (sem `pickRingBaseline`). Cada anel compara contra seu próprio equipado. Dedup é responsabilidade do server: candidato em ring1 + ring2 do mesmo merc ganha `dupOf: 'ring1'` no segundo slot, UI marca com classe `is-dup` (opacity reduzida).
- **Top affix bonus**: +1 score por prefix top, +1 por suffix top (do `data/affixes.json`).
- **`?slots=N`** + **`?refresh=1`** no endpoint pra UX (slots configurável, force fetchAllCharacters).
- **`soulbound`** exposto no candidato (badge UI).

**Alternativas rejeitadas:**
- *Hardcoding de roles ("Druida → +INT")*: frágil — strings PT-BR específicas do servidor, mercs novos requerem update do code. `itemsMax` é dado próprio do jogo, sem hardcoding.
- *Score multiplicativo (efficiency como score primário)*: itens caríssimos com score brutal ficavam invisíveis. User pode pagar quando vale, então score primário e efficiency só desempata.
- *RUBY_TO_GOLD dinâmico via mercado*: 1500g/r é estimativa empírica. Vira ajuste futuro se virar problema.

**Consequências:**
- Score muda de magnitude (12-15 → 30-80 típico). UI mostra direto sem normalizar.
- Painel 2 e Painel 3 agora compartilham a mesma lógica de comparação/ranking via `enrichListingWithWaste`.
- Wasted ups, atCap, topBonus, efficiency e soulbound expostos consistentemente em ambos.
- DB stats stale mitigado por `?refresh=1` + botão UI "↻ stats".
- `wastedUps` no Painel 2 aparece como `auction-cap-chip` no footer do listing.

---

### [DEC-19] Recomendador de upgrade dos mercs faz comparação local (DB), não re-fetch

**Data:** 2026-04-29
**Contexto:** O tooltip duplo do leilão entrega `[item, equipped]`, mas o "equipped" lá é sempre do char ativo (gladiador principal, doll=1). Pra recomendar upgrade pros 4 mercs (dolls 2..6), precisaríamos de uma fonte alternativa do gear equipado. Caminho ingênuo: trocar o doll ativo via `?doll=N` antes de cada `mod=auction` request. Pior cenário: 4 mercs × M slots = N round-trips HTTP por refresh, bloqueando o tick principal.
**Decisão:** Fazer **1 fetch único** do leilão (com `itemType=0`, sem filtro de slot) e **comparar localmente** contra o gear do merc lido do SQLite (`equipped_items.stats_json`). Helper novo `readEquippedBlock(doll, slot)` em `db.js` reconstrói o shape `{name, level, stats}` que `pairStats` espera. Módulo `src/mercSuggestions.js` orquestra: `rankSlots(char)` prioriza slots por gap de level + quality penalty, `buildSuggestions(allListings, mercs)` filtra candidatos por `itemType` localmente e pareia stats reusando `pairStats`/`summarizeRows` (mesmas regras do Painel 2).
**Alternativas rejeitadas:**
- *Trocar doll ativo antes de cada GET*: O(N) round-trips, race com tick (`mod=overview` parser), e expõe o usuário a dolls "fantasma" se o servidor demorar a aplicar a troca.
- *Fetch por slot (1 fetch/itemType × N mercs)*: ainda muitos round-trips, e o filtro do leilão já entrega tudo em "Tudo".
- *Re-parsear o paperdoll de cada merc no fly*: mesmo problema do anterior, e o `equipped_items` já é populado pelo `/api/characters` (Painel 4) — re-aproveitar é grátis.
**Consequências:**
- Painel 3 depende do DB estar populado. Se vazio na primeira chamada, o endpoint faz `fetchAllCharacters` inline e persiste — first-load lento, depois rápido.
- Anéis (ring1/ring2) compartilham `itemType=6`. `pickRingBaseline()` escolhe o anel mais fraco como baseline pra evitar que candidatos que upgrade-iam o anel fraco apareçam como downgrade do forte.
- Stale data: gear do merc no DB pode estar desatualizado se o user equipou algo manualmente entre refreshs. Não é crítico — atualiza no próximo refresh do Painel 4. Documentar como limitação aceita.

---

### [DEC-21] Bid via UI manual + parser de `bidderName` + tracking local de IDs

**Data:** 2026-04-29
**Contexto:** Para chegar à Fase 2 do Painel 2 (sniper + autobuy automático) precisávamos primeiro validar que o `placeBid` funciona end-to-end e dar ao usuário visibilidade dos lances que ele já mandou. `placeBid` em `actions/auction.js` existia gated mas sem caller.

Sub-problemas resolvidos nesta sessão:
1. **Detectar "MEU lance" na listagem**: capturado HTML real pós-bid (`docs/wip/auction/leilao-after-bid.html`). Servidor renderiza `<a href="?mod=player&p=ID"><span style="color:blue;font-weight:bold;">NOME_LICITADOR</span></a>` no `auction_bid_div` em vez de string fixa. Não há "Seu lance"; é o nome do licitador atual.
2. **`currentBid` exato não é exposto**: o "Preço baixo: X" pós-bid é o **próximo mínimo** (~5% acima do lance corrente), não o lance atual. Mesmo o input `bid_amount` vem com esse valor.
3. **`ttype` ambíguo**: aba "Mercenário" usa URL `?ttype=3`, mas os `<form action>` internos vêm com `ttype=2`.

**Decisão:** 
- **Bid 100% manual via UI** (botões "Lance" e "Comprar" por card). `placeBid` plugado via `POST /api/auction/bid` gated por `isActionsEnabled()`. Orchestrator nunca chama `placeBid` automaticamente nessa fase.
- **Parser captura `bidderName` cru** (regex sobre `<a mod=player>...<span>NOME</span>`). `enrichResult` em `actions/auction.js` compara case-insensitive com `charName` do snapshot pra setar `myBid`. Separação parsing × business logic.
- **Tracking local** em `botState.myBidAuctionIds` (Set in-memory, volátil): ao dar lance via UI, o ID é marcado. Cobre edge case (parser falhou ou caracteres especiais no nome divergem).
- **`formTtype` capturado do `<form action>`**: parser extrai `?ttype=N` do action attribute. Frontend usa esse valor (não o da aba) ao montar o POST de bid — fonte de verdade que o próprio jogo gerou.
- **`nextMinBid`** explícito no schema (próximo lance mínimo). `currentBid` (valor exato) **não é coletado** — não está no HTML. UI mostra "próximo mínimo: Xg" no tooltip.

**Alternativas rejeitadas:**
- *Auto-bid já agora*: muito risco — sem sniper validado, sem regras.
- *Persistir `myBidAuctionIds` em SQLite*: volátil é OK; leilão renova, IDs antigos não importam após N horas.
- *Inferir `currentBid` a partir de `nextMinBid / 1.05`*: aproximação imprecisa; melhor não expor valor falso.
- *Usar `ttype` da aba*: risco de POST falhar quando aba ≠ ttype interno.

**Consequências:**
- Fase 2 destravada: usuário pode dar lance/comprar pela UI, ver feedback visual (chip ★ "MEU LANCE" ou ◆ NOME_OUTRO_PLAYER), filtros "só com lances" / "só meus lances".
- Validado em produção: lance de 208g em `auctionId=6816306` (Maçã Poirins, L55) → server retornou `bidderName=AidsEgipicia`, `nextMinBid=219`, `hasBids=true`. Sample salvo em `docs/wip/auction/leilao-after-bid.html`.
- Reset do tracking ao reiniciar bot — aceitável (parser via `bidderName` cobre 99% dos casos; tracking só pra edge cases).
- DEBT-09 fechado nessa sessão.

---

### [DEC-04] Documentação espelhando o sistema do webservices-core

**Data:** 2026-04-28
**Contexto:** O usuário tem um repo (webservices-core) com sistema maduro de docs/memória/contexto. Quer trazer a mesma disciplina pro gladibot.
**Decisão:** Adotar a estrutura `CLAUDE.md` raiz + `docs/{INDEX,PROJECT_STATE,DECISIONS,TECHNICAL_DEBT,CONTRIBUTING,DEVELOPMENT_WORKFLOW,CODE_PATTERNS}.md` + `.claude/{settings.json, commands, agents}` + hook PostToolUse de session log + agent `doc-keeper`. Versão **enxuta** — sem builders de stack (backend/frontend), sem `/implement` etc, porque gladibot é single-package, single-stack, single-dev.
**Alternativas rejeitadas:**
- *Cópia literal do webservices-core*: muitos arquivos seriam inaplicáveis (PAYMENTS_COMPLETION_PLAN, FRONTEND_MAP).
- *Manter só `docs/memory.md` + `flows.md`*: insuficiente — sem ADR, sem débito tracking, sem checkpoint flow.
**Consequências:** Trabalho extra de manter docs sincronizadas. Em troca: continuidade entre sessões do Claude, decisões registradas, débitos visíveis. Quando o projeto crescer (multi-bot, multi-server?), a estrutura escala.

---

### [DEC-22] Comparação de stats no leilão usa math direta — `delta` do tooltip do equipped é intrínseco, não de swap

**Data:** 2026-04-30
**Contexto:** O tooltip do leilão tem 2 blocos: `item` e `equipped`. O bloco `equipped` traz um campo `delta` em cada linha de stat (ex: `"Armadura +1038"` com `delta: "+135"`). DEC-11 e código original interpretavam esse `delta` como **mudança no total do char se o item leiloado fosse equipado** (delta de swap). `itemCompare.js` tinha flag `useGameDelta=true` no Painel 2 confiando nesse campo.

Verificação empírica em 2026-04-30 (lendo `data/raw/auction-glad.json`): o **mesmo item equipado** expõe os **mesmos `delta` em todas as listings do leilão**, independente do item leiloado. Logo `delta` não é função do par (item, equipped) — é uma propriedade intrínseca do equipped (provavelmente bônus de conditioning/qualidade do item ali no slot). Resultado: deltas exibidos na UI estavam **errados** (ex: Armadura +344 vs +609 mostrava `▲ +79`, era o bônus intrínseco do equipped — math direta dá `▲ +265`).

**Decisão:** removida a flag `useGameDelta` inteira. `pairStats` e `consolidateMainStats` sempre calculam delta como math direta `itemValue − equippedValue`. Funções `deltaSign`/`deltaValue` deletadas (não usadas mais). O `delta` continua sendo parseado pelo `parseAuctionTooltipBlock` (não custa nada) mas não é mais lido por nada.

**Alternativas rejeitadas:**
- *Manter `useGameDelta=true` mas só pro Painel 2*: o bug existe nele também — mesmo problema.
- *Reinterpretar `delta` como "bônus intrínseco" e exibir como info adicional*: feature creep — pode entrar depois se o user pedir.

**Consequências:** Deltas batem com `itemValue − equippedValue` em todos os Painéis. DEC-11 fica desatualizada (a parte que afirma `delta` é fonte de verdade pra swap). Comentários em `itemCompare.js` explicam o achado pra evitar regressão.

---

### [DEC-23] Roles de merc com override de pesos por posição + inferência por nome/stats

**Data:** 2026-04-30
**Contexto:** O score do Painel 3 (DEC-20) é magnitude-weighted via `STAT_VALUE_WEIGHT` + `roleBoost(itemsMax)`. Mas `STAT_VALUE_WEIGHT` é genérico — pra um médico, `cura` deveria pesar 1.0 e `dano` 0.0; pra tanque, `valor de bloqueio` deveria pesar 2.0; pra killer, `valor de dano crítico` 2.5. `roleBoost` via `itemsMax` cobre só atributos primários, não esses stats compostos.

Bug correlato descoberto: as keys `'cura crítica'`, `'bloqueio'`, `'bônus de bloqueio'` em `STAT_VALUE_WEIGHT` **nunca batiam** com prefixos reais do parser (`'valor de cura crítica'`, `'valor de bloqueio'`, `'evoluindo o valor'`) — esses stats sempre caíam pro fallback `0.5`.

**Decisão:** introduzido `ROLE_WEIGHT_OVERRIDES` em `src/mercSuggestions.js`:
- **medico** — `cura` 1.0, `valor de cura crítica` 2.5, `inteligência` 1.5; dano/crítico/ameaça zerados.
- **tanque** — `valor de bloqueio` 2.0, `evoluindo o valor` 2.0, `ameaça` 1.5, `constituição` 1.5.
- **killer** — `dano` 0.8, `valor de dano crítico` 2.5, atributos primários 1.0.

`resolveMercRole(char, mercPosition)`:
1. Player main (doll=1) → só inferência por nome/stats; se falhar, retorna `null` (sem override; usa pesos genéricos + roleBoost).
2. Mercs reais → infere por role name (Druida → medico) + stats (≥3 peças com cura/bloqueio); fallback `ROLE_BY_POSITION = ['medico', 'killer', 'tanque', 'killer']` (ordem definida pelo user em 2026-04-30 — primeiro merc sempre médico, depois killer/tanque/killer).

`computeWeightedScore` aceita role e aplica override. `buildSuggestions` resolve role uma vez por char e propaga; output ganha campo `mercRole`. Server filtra player alts (mesmo nome do main, doll≠1) pra não bagunçar o índice posicional.

**Alternativas rejeitadas:**
- *Inferir só por role name*: nomes em PT-BR variam entre servidores; novo merc sem nome conhecido cai no genérico.
- *ML pra inferir role*: overkill — heurística de nome + stats + position cobre 100% dos casos atuais.
- *Pedir o user configurar role manualmente por merc*: friction inútil; user já mapeou a ordem posicional uma vez (essa decisão).

**Consequências:** Score agora reflete vocação real do merc — médico não recebe sugestão de armadura física; killer não recebe sugestão de cura. Keys de `STAT_VALUE_WEIGHT` corrigidas (canônicas). UI ganha badge colorida por role no header de cada merc. Se a ordem dos mercs mudar in-game, `ROLE_BY_POSITION` precisa ser atualizado (constante simples).

---

### [DEC-24] Heartbeat de sessão durante sleep pra evitar redirect silencioso pro lobby

**Data:** 2026-04-30
**Contexto:** Após mudanças de rede ou inatividade (cooldown 177s ou work 8h), o servidor Gameforge pode expirar a sessão silenciosamente. GET requests mantêm a URL e permissões mais altas; POSTs com headers XHR em algumas combinações caem numa rota interna que redireciona pra `browsergamelobby` (response é 200 com HTML, não 401/403 — client retry nunca dispara). A listagem do leilão fica vazia, sem erro detectável. Sintoma reportado: dropdown do leilão volta vazio depois de mudar filtro durante sleep.
**Decisão:** `interruptibleSleep` em `src/index.js` agora recebe `(seconds, stopRef, page, session)` e dispara `readSession(page)` periodicamente — janela [45s, 135s] com jitter uniforme pra mascarar como bot (evita padrão suspeito de exatamente 90s). Cada heartbeat sucesso atualiza `session.sh` e `session.csrf` in-place. Check de segurança: só dispara se sobram >= 5s de sleep — próximo ao fim, o tick natural já vai navegar e renovar.
**Alternativas rejeitadas:**
- *Desligar o bot 24/7 (worker modelo)*: user quer 24/7 automático.
- *Sempre refazer login a cada tick*: custoso, expõe user a captchas/2FA.
- *Heartbeat fixo de 60s*: padrão óbvio de bot; jitter reduz detecção.
**Consequências:** Sleep de cooldown longo agora mantém sessão fresca. POSTs que dependem de CSRF válido (filtro do leilão, bids, training) deixam de cair silenciosamente no lobby. Tick posterior recupera normalmente.

---

### [DEC-25] Dropdown do leilão extraído do HTML real `<select>`, não computado por fórmula

**Data:** 2026-04-30
**Contexto:** `src/formulas.json` contém `"auction-min-level"` e `"auction-max-level"` que aplicam matemática fixa: `min = char.level − 6`, `max = char.level + 6`, subdividos em steps. O code anterior (`auctionLevelRange()`) geraba opções via pura aritmética. Problema: step varia conforme nível. Char lvl 70 (step=7 real do jogo) gerava opções `[52,59,66,73,80]`; code gerava `[48,54,60,66,72,78,84]` — fora da grade aceita pelo servidor.
**Decisão:** `parseAuctionList(html)` agora extrai `itemLevelOptions: number[]` via regex do `<select name="itemLevel">` no HTML cru. Novo helper `fetchAuctionLevelOptions(client, { ttype })` em `src/actions/auction.js` faz GET puro pra capturar o `<select>` (sem enrichment). Endpoint `GET /api/auction/level-options?ttype=...` em `ui/server.js` o expõe. UI (`app.js`) substituiu cache baseado em fórmula (`auctionLevelRangeCache`) por cache baseado em signature (`auctionLevelOptionsCache`) — dropdown se autocorrige a cada `renderAuction` via helper `syncAuctionLevelDropdown(options, {selected})`.
**Alternativas rejeitadas:**
- *Manter a fórmula e aceitar opções erradas*: posting com valor invalido devolve listagem vazia, confunde usuario.
- *Recalcular via backend do bot*: step é dado próprio do jogo, frágil de reproduzir. HTML é fonte de verdade.
**Consequências:** Dropdown sempre exato — não há divergência entre UI e server. Parser ganha novo campo `itemLevelOptions` que a UI consome diretamente. `/api/auction/level-options` é endpoint "puro" — pode ser removido se a UI passar a ler a opção do response de `/api/auction` (onde já vem `itemLevelOptions`).

---

### [DEC-26] Top-off de cura via packages + autobuy pró-ativo no leilão

**Data:** 2026-05-01
**Contexto:** AFK fallback (DEC-16) manda o char pro estábulo 8h quando HP cai com inventário sem comida. Problema: pontos de exp/dung NÃO regeneram durante o trabalho — bot fica idle 8h queimando ciclo onde poderia estar farmando ouro/exp. O usuário tem 2 fontes de comida não-aproveitadas: (a) packages do servidor (drops da masmorra empacotados), (b) leilão de NPCs (itemType=7=Cura) onde food costuma ter ratio gold/HP barato.
**Decisão:** Antes do AFK fallback, orchestrator tenta encher o inventário até `AUTOBUY_HEAL_TARGET` (default 5):
1. **Packages** (`actions/packages.openHealPackages`): drena os com `Usar: Cura X` no tooltip via mesmo POST `mod=inventory&submod=move` (DEC: `from=-packageId` negativo identifica container "package"). Slot livre achado por `findFreeBagSlot(occupied, w, h)` num grid 8×5.
2. **Auction autobuy** (`actions/buyHeal.autoBuyHeal`): só se ainda faltar comida. Filtra `itemType=7`, ignora listings com lance, exige `healNominal/buyoutGold ≥ minRatio` (default 3 — abaixo disso não vale a pena). Buyout-only (lance demora horas; cura é "agora"). Ordena por healNominal desc (encher rápido). Budget per-tick limitado por `AUTOBUY_HEAL_MAX_BUDGET_TICK` (default 50k ouro).
**Alternativas rejeitadas:**
- *Drenar todos os packages indiscriminadamente*: enche bag com lixo (Pó amarelo, Moedas) e empurra comida real pra fora.
- *Lance em vez de buyout*: comida é necessidade imediata; lance de 24h não resolve o "low HP agora".
- *Sniper de subvalorizados pré-emptivo*: complica auto-buy com cache + execução assíncrona; fora do MVP. Aqui é só "compre agora se vale a pena".
**Consequências:** AFK fallback vira último recurso. Packages drenam free (custo zero) primeiro, leilão é o backup pago. Loops de batalha ficam mais contínuos. Bug potencial: se `inventoryGrid` vier desatualizado (raça com tick anterior), POSTs de move podem retornar erro do servidor — caímos no `try/catch` do orchestrator (warn + continua). Slot finder não considera `data-content-size` (stack) — items food ficam todos como 1×1 e não tentam stackar com existing food (cada um ocupa 1 célula).

---

### [DEC-27] Lances no leilão só permitidos com `globalTimeBucket = "Curto"`

**Data:** 2026-05-01
**Contexto:** O leilão Gladiatus mostra um único timer global por filtro (`<span class="description_span_right">Curto/Médio/Longo</span>`) — quanto tempo falta pro batch fechar. Lances dados em "Longo" ficam expostos a outbid por horas; em "Curto" o leilão fecha logo e o lance dificilmente vira. Buyout é instantâneo (sem outbid possível) então não tem restrição.
**Decisão:** `actions/auction.placeBid` recusa requests com `buyout=false` quando o bucket cacheado em `botState.lastAuctionBucket` não é "Curto" (ou está stale, TTL 60s). Cache é atualizado por todo `fetchAuctionList` (UI poll + autoBuyHeal). Buyout não passa por essa checagem. Constante `BID_REQUIRED_BUCKET` em `actions/auction.js` permite mudar a regra (ex: aceitar Médio também) sem mexer em chamadores.
**Alternativas rejeitadas:**
- *Pré-fetch dentro do placeBid*: latência extra em cada clique de UI. O cache via fetchAuctionList resolve sem custo (UI já poll regularmente).
- *Confiar em `bucket` enviado pelo cliente*: spoofable e desnecessário (UI é local-only mas a regra fica mais robusta server-side).
- *Aplicar gate também em buyout*: comprado tem lock instantâneo, não há razão pra restringir — usuário foi explícito sobre "lances".
**Consequências:** `myBidAuctionIds` (DEC-21) cresce só quando bucket é "Curto", reduzindo lances "perdidos". UI deve mostrar `globalTimeBucket` proeminentemente (já mostra) pra usuário entender o gate. Edge case: se a UI ficar 60s+ sem fetchAuctionList (raro: poll de 2s), o cache expira e o próximo lance é refused com `bucket unknown/stale` — usuário re-abre a aba e tenta de novo.
