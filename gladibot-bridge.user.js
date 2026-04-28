// ==UserScript==
// @name         Gladibot Bridge
// @namespace    gladibot
// @version      0.1.0
// @description  Expose onclick-only Gladiatus controls (startFight, ...) as accessible <a> elements so browsermcp can target them by ref.
// @match        https://*.gladiatus.gameforge.com/game/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const BOX_ID = 'gladibot-bridge';

  function ensureBox() {
    let box = document.getElementById(BOX_ID);
    if (box) return box;
    box = document.createElement('div');
    box.id = BOX_ID;
    box.setAttribute('aria-label', 'gladibot-bridge');
    box.style.cssText = [
      'position:fixed', 'top:60px', 'right:10px', 'z-index:99999',
      'background:rgba(0,0,0,0.88)', 'color:#fff', 'padding:6px 8px',
      'border:2px solid #ffd700', 'border-radius:4px',
      'font:11px ui-monospace,Menlo,Consolas,monospace', 'max-width:240px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    ].join(';');
    const title = document.createElement('div');
    title.textContent = 'Gladibot';
    title.style.cssText = 'color:#ffd700;font-weight:bold;margin-bottom:4px';
    box.appendChild(title);
    const list = document.createElement('div');
    list.id = BOX_ID + '-list';
    box.appendChild(list);
    document.body.appendChild(box);
    return box;
  }

  function getSh() {
    const u = new URL(location.href);
    return u.searchParams.get('sh') || '';
  }

  function getCsrfToken() {
    if (window.csrfToken) return window.csrfToken;
    const meta = document.querySelector('meta[name*="csrf" i], meta[name*="token" i]');
    if (meta && meta.content && /^[a-f0-9]{64}$/i.test(meta.content)) return meta.content;
    const m = document.documentElement.outerHTML.match(/csrf[_-]?token['":=\s]+["']?([a-f0-9]{64})/i);
    return m ? m[1] : '';
  }

  function postInventoryMove(params) {
    const sh = getSh();
    const csrf = getCsrfToken();
    const url = '/game/ajax.php?mod=inventory&submod=move' +
      '&from=' + params.from + '&fromX=' + params.fromX + '&fromY=' + params.fromY +
      '&to=8&toX=1&toY=1&amount=1&doll=1';
    const body = '&a=' + Date.now() + '&sh=' + sh;
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body,
    }).then(r => r.text());
  }

  let lastKnownHp = null; // { value, max } — refreshed on init from DOM, then on every heal response

  function readHpFromDom() {
    // The doll/avatar HP tooltip carries "Pontos de vida:","X / Y". Scan all data-tooltip
    // attributes — first match wins. Also covers other tooltips with same shape, but they
    // all encode the same authoritative HP, so any hit is valid.
    const els = document.querySelectorAll('[data-tooltip]');
    for (const el of els) {
      const t = el.getAttribute('data-tooltip') || '';
      const m = t.match(/Pontos de vida[^"]*?"\s*,\s*"(\d+)\s*\\?\/\s*(\d+)"/);
      if (m) return { value: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    }
    return null;
  }

  function updateHpDisplay() {
    const box = document.getElementById(BOX_ID);
    if (!box) return;
    let hpEl = box.querySelector('.gladibot-hp');
    if (!hpEl) {
      hpEl = document.createElement('div');
      hpEl.className = 'gladibot-hp';
      hpEl.setAttribute('aria-label', 'gladibot-hp');
      hpEl.style.cssText = 'color:#ff8;margin-bottom:4px;font-weight:bold';
      box.insertBefore(hpEl, box.querySelector('#' + BOX_ID + '-list'));
    }
    if (lastKnownHp) {
      const pct = Math.round(100 * lastKnownHp.value / lastKnownHp.max);
      hpEl.textContent = 'HP: ' + lastKnownHp.value + '/' + lastKnownHp.max + ' (' + pct + '%)';
    } else {
      hpEl.textContent = 'HP: ?';
    }
  }

  function parseFoodTooltip(jsonStr) {
    // data-tooltip is a JSON-encoded array like [[["Name","color"],["Usar: Cura 1293 de vida","#DDD"], ...]]
    try {
      const arr = JSON.parse(jsonStr);
      const inner = arr[0]; // first tooltip group
      const nameEntry = inner[0];
      const healEntry = inner.find(e => /Usar: Cura\s+\d+/.test(e[0]));
      const name = nameEntry ? String(nameEntry[0]) : '?';
      const heal = healEntry ? parseInt(healEntry[0].match(/\d+/)[0], 10) : 0;
      return { name, heal };
    } catch (_) {
      return { name: '?', heal: 0 };
    }
  }

  function exposeAll() {
    const box = ensureBox();
    const list = box.querySelector('#' + BOX_ID + '-list');
    list.innerHTML = '';
    let fightCount = 0;
    let healCount = 0;

    // 1. Dungeon fight links (img[onclick="startFight(...)"])
    document.querySelectorAll('img[onclick*="startFight"]').forEach((img) => {
      const onclick = img.getAttribute('onclick') || '';
      const m = onclick.match(/startFight\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/);
      if (!m) return;
      const posi = m[1], did = m[2];
      const key = posi + '-' + did;
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.fight = key;
      a.textContent = '⚔ fight-' + key;
      a.setAttribute('aria-label', 'gladibot-fight-' + key);
      a.style.cssText = 'display:block;color:#ffd700;text-decoration:none;padding:2px 0';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          window.startFight(posi, did);
          if (typeof window.showWait === 'function') window.showWait();
        } catch (err) { console.error('[gladibot] startFight failed', err); }
      });
      list.appendChild(a);
      fightCount++;
    });

    // 2. Heal items (food in inventory, data-content-type="64")
    const foods = Array.from(document.querySelectorAll('#inv > div[data-content-type="64"][data-tooltip]'));
    const parsed = foods.map((el) => {
      const { name, heal } = parseFoodTooltip(el.dataset.tooltip);
      return {
        el,
        name,
        heal,
        itemId: el.dataset.itemId,
        from: el.dataset.containerNumber,
        fromX: el.dataset.positionX,
        fromY: el.dataset.positionY,
      };
    }).filter(p => p.heal > 0);

    parsed.sort((a, b) => a.heal - b.heal); // ascending
    parsed.forEach((p) => {
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.heal = p.itemId;
      a.textContent = '🍞 heal-' + p.itemId + ' (' + p.heal + ')';
      a.setAttribute('aria-label', 'gladibot-heal-' + p.itemId + '-' + p.heal);
      a.title = p.name;
      a.style.cssText = 'display:block;color:#7fff7f;text-decoration:none;padding:2px 0;font-size:10px';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        a.style.color = '#999';
        a.textContent += ' …';
        postInventoryMove({ from: p.from, fromX: p.fromX, fromY: p.fromY })
          .then((resp) => {
            console.log('[gladibot] heal response', resp);
            // Parse JSON response; update HP and remove consumed item from both bridge and DOM.
            try {
              const j = JSON.parse(resp);
              const h = j && j.status && j.status.leben;
              if (h && h.value !== undefined) {
                // status.leben.value is HP percentage; absolute is in header.health
                if (j.header && j.header.health) {
                  lastKnownHp = { value: j.header.health.value, max: j.header.health.maxValue };
                }
              } else if (j && j.header && j.header.health) {
                lastKnownHp = { value: j.header.health.value, max: j.header.health.maxValue };
              }
              updateHpDisplay();
            } catch (_) { /* response wasn't JSON, ignore */ }
            // Remove the consumed item from inventory DOM and from bridge box.
            if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
            a.parentNode && a.parentNode.removeChild(a);
            // Update status counter
            const status = document.querySelector('#' + BOX_ID + ' .gladibot-status');
            if (status) {
              const heals = document.querySelectorAll('#' + BOX_ID + '-list a[data-heal]').length;
              const fights = document.querySelectorAll('#' + BOX_ID + '-list a[data-fight]').length;
              status.textContent = fights + ' fight(s), ' + heals + ' heal(s) exposed';
            }
          })
          .catch((err) => {
            console.error('[gladibot] heal err', err);
            a.textContent = '🍞 heal-' + p.itemId + ' ✗';
            a.style.color = '#f55';
          });
      });
      list.appendChild(a);
      healCount++;
    });

    // Status line
    let status = box.querySelector('.gladibot-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'gladibot-status';
      status.style.cssText = 'color:#888;margin-top:4px;font-size:10px';
      box.appendChild(status);
    }
    status.textContent = fightCount + ' fight(s), ' + healCount + ' heal(s) exposed';
  }

  // Single pass on page load. Gladiatus reloads the full page on navigation,
  // so we don't need a MutationObserver here (and a body-wide one was causing
  // feedback loops with the game's own DOM updates).
  exposeAll();
  lastKnownHp = readHpFromDom();
  updateHpDisplay();
})();
