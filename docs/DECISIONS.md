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

### [DEC-04] Documentação espelhando o sistema do webservices-core

**Data:** 2026-04-28
**Contexto:** O usuário tem um repo (webservices-core) com sistema maduro de docs/memória/contexto. Quer trazer a mesma disciplina pro gladibot.
**Decisão:** Adotar a estrutura `CLAUDE.md` raiz + `docs/{INDEX,PROJECT_STATE,DECISIONS,TECHNICAL_DEBT,CONTRIBUTING,DEVELOPMENT_WORKFLOW,CODE_PATTERNS}.md` + `.claude/{settings.json, commands, agents}` + hook PostToolUse de session log + agent `doc-keeper`. Versão **enxuta** — sem builders de stack (backend/frontend), sem `/implement` etc, porque gladibot é single-package, single-stack, single-dev.
**Alternativas rejeitadas:**
- *Cópia literal do webservices-core*: muitos arquivos seriam inaplicáveis (PAYMENTS_COMPLETION_PLAN, FRONTEND_MAP).
- *Manter só `docs/memory.md` + `flows.md`*: insuficiente — sem ADR, sem débito tracking, sem checkpoint flow.
**Consequências:** Trabalho extra de manter docs sincronizadas. Em troca: continuidade entre sessões do Claude, decisões registradas, débitos visíveis. Quando o projeto crescer (multi-bot, multi-server?), a estrutura escala.
