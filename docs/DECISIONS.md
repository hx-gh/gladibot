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

### [DEC-04] Documentação espelhando o sistema do webservices-core

**Data:** 2026-04-28
**Contexto:** O usuário tem um repo (webservices-core) com sistema maduro de docs/memória/contexto. Quer trazer a mesma disciplina pro gladibot.
**Decisão:** Adotar a estrutura `CLAUDE.md` raiz + `docs/{INDEX,PROJECT_STATE,DECISIONS,TECHNICAL_DEBT,CONTRIBUTING,DEVELOPMENT_WORKFLOW,CODE_PATTERNS}.md` + `.claude/{settings.json, commands, agents}` + hook PostToolUse de session log + agent `doc-keeper`. Versão **enxuta** — sem builders de stack (backend/frontend), sem `/implement` etc, porque gladibot é single-package, single-stack, single-dev.
**Alternativas rejeitadas:**
- *Cópia literal do webservices-core*: muitos arquivos seriam inaplicáveis (PAYMENTS_COMPLETION_PLAN, FRONTEND_MAP).
- *Manter só `docs/memory.md` + `flows.md`*: insuficiente — sem ADR, sem débito tracking, sem checkpoint flow.
**Consequências:** Trabalho extra de manter docs sincronizadas. Em troca: continuidade entre sessões do Claude, decisões registradas, débitos visíveis. Quando o projeto crescer (multi-bot, multi-server?), a estrutura escala.
