const REFRESH_MS = 2000;

const STAT_KEYS = ['strength', 'dexterity', 'agility', 'constitution', 'charisma', 'intelligence'];
const STAT_LABELS = {
  strength: 'Força',
  dexterity: 'Destreza',
  agility: 'Agilidade',
  constitution: 'Constituição',
  charisma: 'Carisma',
  intelligence: 'Inteligência',
};
const STAT_TRAIN_ID = {
  strength: 1, dexterity: 2, agility: 3,
  constitution: 4, charisma: 5, intelligence: 6,
};

const els = {
  liveDot: document.getElementById('liveDot'),
  modeLabel: document.getElementById('modeLabel'),
  btnTick: document.getElementById('btnTick'),
  btnPause: document.getElementById('btnPause'),
  btnResume: document.getElementById('btnResume'),
  btnDisable: document.getElementById('btnDisable'),
  btnEnable: document.getElementById('btnEnable'),
  actionsPill: document.getElementById('actionsPill'),
  // banners
  workingBanner: document.getElementById('workingBanner'),
  workingJob: document.getElementById('workingJob'),
  workingTime: document.getElementById('workingTime'),
  buffsBanner: document.getElementById('buffsBanner'),
  // hero
  heroAvatar: document.getElementById('heroAvatar'),
  heroName: document.getElementById('heroName'),
  heroLevel: document.getElementById('heroLevel'),
  heroXp: document.getElementById('heroXp'),
  heroHpFill: document.getElementById('heroHpFill'),
  heroHp: document.getElementById('heroHp'),
  // resources
  statGold: document.getElementById('statGold'),
  statRubies: document.getElementById('statRubies'),
  statExp: document.getElementById('statExp'),
  barExp: document.getElementById('barExp'),
  cdExp: document.getElementById('cdExp'),
  statDung: document.getElementById('statDung'),
  barDung: document.getElementById('barDung'),
  cdDung: document.getElementById('cdDung'),
  statFood: document.getElementById('statFood'),
  statXp: document.getElementById('statXp'),
  snapAge: document.getElementById('snapAge'),
  // loop
  loopPill: document.getElementById('loopPill'),
  loopLast: document.getElementById('loopLast'),
  loopDur: document.getElementById('loopDur'),
  loopCount: document.getElementById('loopCount'),
  loopNext: document.getElementById('loopNext'),
  // combined attributes & training
  combinedRows: document.getElementById('combinedRows'),
  trainingPoints: document.getElementById('trainingPoints'),
  btnRefreshTraining: document.getElementById('btnRefreshTraining'),
  // characters tab (mercs)
  charTabs: document.querySelectorAll('.char-tab'),
  tabPanes: document.querySelectorAll('.char-card .tab-pane'),
  tabInfos: document.querySelectorAll('.char-tab-info'),
  mercsGrid: document.getElementById('mercsGrid'),
  btnRefreshChars: document.getElementById('btnRefreshChars'),
  // mercs suggestions (now inside the auction card)
  mercsSuggestBody: document.getElementById('mercsSuggestBody'),
  auctionViewTabs: document.getElementById('auctionViewTabs'),
  aucMercSlots: document.getElementById('aucMercSlots'),
  btnRefreshMercsStats: document.getElementById('btnRefreshMercsStats'),
  btnAuctionLegend: document.getElementById('btnAuctionLegend'),
  auctionLegend: document.getElementById('auctionLegend'),
  // auction
  auctionTabs: document.getElementById('auctionTabs'),
  auctionRows: document.getElementById('auctionRows'),
  auctionTimeBucket: document.getElementById('auctionTimeBucket'),
  btnRefreshAuction: document.getElementById('btnRefreshAuction'),
  aucItemType: document.getElementById('aucItemType'),
  aucItemLevel: document.getElementById('aucItemLevel'),
  aucItemQuality: document.getElementById('aucItemQuality'),
  aucQry: document.getElementById('aucQry'),
  aucOnlyTop: document.getElementById('aucOnlyTop'),
  aucOnlyUpgrades: document.getElementById('aucOnlyUpgrades'),
  aucOnlyWithBids: document.getElementById('aucOnlyWithBids'),
  aucOnlyMyBids: document.getElementById('aucOnlyMyBids'),
  // logs
  logBox: document.getElementById('logBox'),
  logLevel: document.getElementById('logLevel'),
  autoscroll: document.getElementById('autoscroll'),
  // drawer
  auxDrawer: document.getElementById('auxDrawer'),
  btnLoopPanel: document.getElementById('btnLoopPanel'),
  btnLogsPanel: document.getElementById('btnLogsPanel'),
  btnCloseDrawer: document.getElementById('btnCloseDrawer'),
  drawerTabs: document.querySelectorAll('.drawer-tab'),
  drawerPanes: document.querySelectorAll('.drawer-pane'),
};

let lastLogTs = 0;
let lastTraining = null;
let lastSnapshot = null;
let actionsEnabled = true;

// Mapeamento dos prefixos do `statKey` (em pt-BR, lowercase, sem acento
// removido — bate exatamente com o que sai do parseStatLabel) pra chave
// canônica usada em `snapshot.stats`.
const STAT_KEY_PT_TO_EN = {
  'força': 'strength',
  'destreza': 'dexterity',
  'agilidade': 'agility',
  'constituição': 'constitution',
  'carisma': 'charisma',
  'inteligência': 'intelligence',
};

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('pt-BR');
}
function fmtSecs(s) {
  if (s === null || s === undefined) return '—';
  if (s <= 0) return 'pronto';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function fmtAge(ms, now) {
  if (!ms) return '—';
  const sec = Math.floor((now - ms) / 1000);
  if (sec < 5) return 'agora';
  if (sec < 60) return `${sec}s atrás`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m atrás`;
  return `${Math.floor(m / 60)}h atrás`;
}
function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('pt-BR');
}
function setBar(el, pct) {
  el.style.width = `${Math.max(0, Math.min(100, pct ?? 0))}%`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  })[c]);
}
function initials(name) {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderHero(snap) {
  if (!snap) {
    els.heroAvatar.textContent = '—';
    els.heroName.textContent = '—';
    els.heroLevel.textContent = '—';
    els.heroXp.textContent = '—';
    els.heroHp.textContent = '—';
    setBar(els.heroHpFill, 0);
    return;
  }
  els.heroAvatar.textContent = initials(snap.charName);
  els.heroName.textContent = snap.charName || '—';
  els.heroLevel.textContent = snap.level ?? '—';
  els.heroXp.textContent = snap.expPercent !== null ? `XP ${snap.expPercent}%` : '—';
  const hp = snap.hp;
  els.heroHp.textContent = hp ? `${fmtNum(hp.value)} / ${fmtNum(hp.max)}` : `${snap.hpPercent ?? '?'}%`;
  setBar(els.heroHpFill, snap.hpPercent);
}

function renderResources(snap) {
  if (!snap) {
    els.statGold.textContent = '—';
    els.statRubies.textContent = '—';
    els.statExp.textContent = '—';
    els.cdExp.textContent = '—';
    els.statDung.textContent = '—';
    els.cdDung.textContent = '—';
    els.statFood.textContent = '—';
    if (els.statXp) els.statXp.textContent = '—';
    setBar(els.barExp, 0);
    setBar(els.barDung, 0);
    return;
  }
  els.statGold.textContent = fmtNum(snap.gold);
  els.statRubies.textContent = fmtNum(snap.rubies);

  const exp = snap.expedition;
  els.statExp.textContent = `${exp.points ?? '?'} / ${exp.max ?? '?'}`;
  setBar(els.barExp, exp.max ? (exp.points / exp.max) * 100 : 0);
  els.cdExp.textContent = `cd ${fmtSecs(exp.cooldownSec)}`;

  const dung = snap.dungeon;
  els.statDung.textContent = `${dung.points ?? '?'} / ${dung.max ?? '?'}`;
  setBar(els.barDung, dung.max ? (dung.points / dung.max) * 100 : 0);
  els.cdDung.textContent = `cd ${fmtSecs(dung.cooldownSec)}`;

  els.statFood.textContent = `${snap.inventoryFood?.length ?? 0} itens`;
  if (els.statXp) els.statXp.textContent = snap.expPercent !== null ? `${snap.expPercent}%` : '—';
}

function renderCombined(snap) {
  if (!snap || !snap.stats) {
    els.combinedRows.innerHTML = '<div class="muted" style="text-align:center;padding:10px">sem dados</div>';
    return;
  }
  const trainingByKey = {};
  if (lastTraining?.skills) {
    for (const sk of lastTraining.skills) trainingByKey[sk.key] = sk;
  }
  els.trainingPoints.textContent = `${lastTraining?.skillPoints ?? 0} pts`;

  const currentGold = snap.gold ?? 0;
  const html = STAT_KEYS.map((key) => {
    const s = snap.stats[key];
    const t = trainingByKey[key];
    if (!s) {
      return `<div class="combined-row">
        <span class="cs-name">${STAT_LABELS[key]}</span>
        <span class="muted" style="grid-column:2/-1">sem dados</span>
      </div>`;
    }
    const pct = s.max > 0 ? (s.total / s.max) * 100 : 0;
    const bonusPart = s.bonus ? `+${s.bonus}b` : '';
    const breakdown = `${s.base ?? '?'}+${s.items ?? 0}${bonusPart ? '+' + bonusPart : ''}`;
    const cost = t?.cost;
    const canAffordByGold = cost !== null && cost !== undefined && currentGold >= cost;
    const canTrainBtn = !!(t?.canTrain) && actionsEnabled && canAffordByGold;
    const reason = !t ? 'aguardando custos…'
                 : !actionsEnabled ? 'actions desativadas'
                 : !canAffordByGold ? 'sem ouro suficiente'
                 : '';
    const costClass = cost === null || cost === undefined ? 'empty'
                    : canAffordByGold ? 'cheap' : '';
    return `
      <div class="combined-row ${canAffordByGold ? '' : 'cant-afford'}">
        <span class="cs-name">${STAT_LABELS[key]}</span>
        <span class="cs-value">${s.total}<span class="max"> / ${s.max}</span></span>
        <div class="cs-bar"><div style="width:${pct.toFixed(1)}%"></div></div>
        <span class="cs-breakdown">${breakdown}</span>
        <span class="cs-cost ${costClass}">${cost !== null && cost !== undefined ? fmtNum(cost) : '—'}</span>
        <button class="btn btn-train" data-skill="${STAT_TRAIN_ID[key]}" ${canTrainBtn ? '' : 'disabled'} title="${reason}">Treinar</button>
      </div>`;
  }).join('');
  els.combinedRows.innerHTML = html;

  els.combinedRows.querySelectorAll('.btn-train:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => onTrainClick(parseInt(btn.dataset.skill, 10)));
  });
}

function renderBuffs(snap) {
  if (!snap || !snap.buffs) {
    els.buffsBanner.hidden = true;
    return;
  }
  const { global = [], personal = [] } = snap.buffs;
  if (global.length === 0 && personal.length === 0) {
    els.buffsBanner.hidden = true;
    return;
  }
  const now = Date.now();
  // Tolerate two formats: { endsAtMs } (new, decrements live) and
  // { endsInSec | timeLeftSec } (legacy snapshots before bot restart — frozen).
  const remainSec = (b, legacyKey) => {
    if (typeof b.endsAtMs === 'number') {
      return Math.max(0, Math.floor((b.endsAtMs - now) / 1000));
    }
    const v = b[legacyKey];
    return typeof v === 'number' ? Math.max(0, v) : null;
  };
  const chips = [];
  for (const b of global) {
    const sec = remainSec(b, 'endsInSec');
    chips.push(`<span class="buff-chip global"><span class="buff-chip-icon">★</span><span class="buff-chip-name">${escapeHtml(b.title)}</span><span class="buff-chip-time">${sec !== null ? fmtSecs(sec) : '—'}</span></span>`);
  }
  for (const b of personal) {
    const sec = remainSec(b, 'timeLeftSec');
    const label = b.effect || b.name || '?';
    chips.push(`<span class="buff-chip personal" title="${escapeHtml(b.name || '')}"><span class="buff-chip-icon">◆</span><span class="buff-chip-name">${escapeHtml(label)}</span><span class="buff-chip-time">${sec !== null ? fmtSecs(sec) : '—'}</span></span>`);
  }
  els.buffsBanner.innerHTML = chips.join('');
  els.buffsBanner.hidden = false;
}

function renderWorking(snap) {
  if (snap?.working?.active) {
    els.workingBanner.hidden = false;
    els.workingJob.textContent = snap.working.jobName || 'job desconhecido';
    els.workingTime.textContent = fmtSecs(snap.working.secondsLeft);
  } else {
    els.workingBanner.hidden = true;
  }
}

async function onTrainClick(skillId) {
  if (!skillId) return;
  if (!confirm(`Treinar atributo? Vai gastar ouro.`)) return;
  try {
    const res = await fetch('/api/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      alert(`Falha: ${data.reason || data.error || res.status}`);
      return;
    }
    if (data.training) lastTraining = data.training;
    // re-render with current state's gold
    poll();
  } catch (e) {
    alert(`Erro: ${e.message}`);
  }
}

const QUALITY_LABEL = { 0: 'verde', 1: 'azul', 2: 'roxo' };
const MERC_ROLE_LABEL = { medico: 'médico', tanque: 'tanque', killer: 'killer' };
let aucTtype = ''; // '' = aba default (gladiador), '3' = mercenário
let aucOnlyUpgrades = false;
let aucOnlyWithBids = false;
let aucOnlyMyBids = false;
let aucView = 'listing'; // 'listing' | 'mercs'
const auctionExpanded = new Set(); // auctionIds expandidos (preserva entre re-renders)

// Popula o `<select aucItemLevel>` com as opções que o jogo realmente aceita,
// extraídas do HTML do leilão (endpoint `/api/auction/level-options`). Antes
// a gente computava pela fórmula `auction-{min,max}-level` em data/formulas.json
// + assumia step=6, mas o step varia (ex: lvl 70 → step=7) e mandar valor fora
// da grade do servidor faz a listing voltar vazia. Cache invalidada quando o
// signature das opções muda — refetch automático após level up.
let auctionLevelOptionsCache = null;  // string "52,59,66,73,80"
function syncAuctionLevelDropdown(options, opts = {}) {
  if (!Array.isArray(options) || options.length === 0) return;
  const sig = options.join(',');
  if (auctionLevelOptionsCache === sig && !opts.force) return;
  auctionLevelOptionsCache = sig;
  const previous = parseInt(els.aucItemLevel.value, 10);
  els.aucItemLevel.innerHTML = options.map((l) =>
    `<option value="${l}">Lvl ${l}+</option>`,
  ).join('');
  // Mantém escolha prévia se ainda válida; senão pega a default sugerida
  // (selected do servidor) ou a opção mais baixa.
  if (Number.isFinite(previous) && options.includes(previous)) {
    els.aucItemLevel.value = String(previous);
  } else if (Number.isFinite(opts.selected) && options.includes(opts.selected)) {
    els.aucItemLevel.value = String(opts.selected);
  } else {
    els.aucItemLevel.value = String(options[0]);
  }
}
async function ensureAuctionLevelOptions() {
  try {
    const params = aucTtype ? `?ttype=${encodeURIComponent(aucTtype)}` : '';
    const data = await fetchJson(`/api/auction/level-options${params}`);
    syncAuctionLevelDropdown(data?.options, { selected: data?.selected });
    return data;
  } catch (e) {
    return null;
  }
}

async function refreshAuctionListing() {
  els.auctionRows.innerHTML = '<div class="muted" style="text-align:center;padding:10px">Carregando…</div>';
  const params = new URLSearchParams();
  if (aucTtype) params.set('ttype', aucTtype);
  params.set('itemType', els.aucItemType.value);
  params.set('itemLevel', els.aucItemLevel.value);
  params.set('itemQuality', els.aucItemQuality.value);
  if (els.aucQry.value) params.set('qry', els.aucQry.value);
  if (els.aucOnlyTop.checked) params.set('onlyTop', '1');
  try {
    const data = await fetchJson(`/api/auction?${params}`);
    renderAuction(data);
  } catch (e) {
    els.auctionRows.innerHTML = `<div class="muted" style="text-align:center;padding:10px">falha: ${escapeHtml(e.message)}</div>`;
  }
}

let pendingRefreshStats = false;

async function refreshMercSuggestionsView() {
  els.mercsSuggestBody.innerHTML = '<div class="muted" style="text-align:center;padding:14px">Buscando leilão e comparando…</div>';
  const params = new URLSearchParams();
  if (aucTtype) params.set('ttype', aucTtype);
  params.set('itemLevel', els.aucItemLevel.value);
  params.set('itemQuality', els.aucItemQuality.value);
  if (els.aucMercSlots) params.set('slots', els.aucMercSlots.value);
  if (pendingRefreshStats) {
    params.set('refresh', '1');
    pendingRefreshStats = false;
  }
  try {
    const data = await fetchJson(`/api/mercs/suggestions?${params}`);
    renderMercSuggestions(data);
  } catch (e) {
    els.mercsSuggestBody.innerHTML = `<div class="muted" style="text-align:center;padding:14px">falha: ${escapeHtml(e.message)}</div>`;
  }
}

async function refreshAuction() {
  els.btnRefreshAuction.disabled = true;
  try {
    await ensureAuctionLevelOptions();
    if (aucView === 'mercs') {
      await refreshMercSuggestionsView();
    } else {
      await refreshAuctionListing();
    }
  } finally {
    setTimeout(() => (els.btnRefreshAuction.disabled = false), 300);
  }
}

// Aplica visibilidade de filtros e panes conforme a view ativa.
function applyAuctionView() {
  document.querySelectorAll('[data-view-pane]').forEach((el) => {
    el.hidden = el.dataset.viewPane !== aucView;
  });
  document.querySelectorAll('[data-view-only]').forEach((el) => {
    const show = el.dataset.viewOnly === aucView;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
      el.style.display = show ? '' : 'none';
    } else {
      el.hidden = !show;
    }
  });
  els.auctionViewTabs.querySelectorAll('.auction-view-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === aucView),
  );
}

function affixChip(value, catalog) {
  if (!value) return '';
  if (!catalog) {
    return `<span class="auction-affix" title="não-classificado">${escapeHtml(value)}</span>`;
  }
  const tip = catalog.rawStats || (catalog.effects || []).map((e) => `${e.stat} ${e.value > 0 ? '+' : ''}${e.value}${e.percent ? '%' : ''}`).join(', ');
  const cls = catalog.top ? 'auction-affix is-top' : 'auction-affix is-known';
  const prefix = catalog.top ? '⭐ ' : '';
  return `<span class="${cls}" title="${escapeHtml(tip)} · lvl ${catalog.level ?? '?'}">${prefix}${escapeHtml(value)}</span>`;
}

function deltaText(row) {
  if (row.deltaLabel) return row.deltaLabel;
  if (row.itemValue == null) return `${row.equippedValue > 0 ? '-' : '+'}${Math.abs(row.equippedValue)}`;
  if (row.equippedValue == null) return `+${row.itemValue}`;
  const d = row.itemValue - row.equippedValue;
  if (d === 0) return '0';
  return d > 0 ? `+${d}` : `${d}`;
}

function signGlyph(sign) {
  if (sign > 0) return '<span class="cmp-sign up">▲</span>';
  if (sign < 0) return '<span class="cmp-sign down">▼</span>';
  return '<span class="cmp-sign same">•</span>';
}

// Análise de "RECOMENDADO": só faz sentido com snapshot do char. Pra cada
// linha de stat que o item ganha (sign > 0), checa se o stat principal
// correspondente está abaixo do max do char. Se sim, conta como "gap
// preenchido". Recomendado = isUpgrade + ao menos 1 gap preenchido.
//
// Stats não-principais (dano range, armadura, saúde, cura) não têm `max`
// no snapshot — esses valem como bônus mas sozinhos não disparam recomendação.
function analyzeRecommendation(listing, snapStats) {
  const cmp = listing.comparison;
  if (!cmp || !cmp.hasComparison || !snapStats) {
    return { isRecommended: false, fillsGaps: [] };
  }
  const fillsGaps = [];
  for (const r of cmp.rows) {
    if (r.sign <= 0) continue;
    if (!r.itemLabel) continue;
    const prefix = (r.key.split('-')[0] || '').toLowerCase();
    const charKey = STAT_KEY_PT_TO_EN[prefix];
    if (!charKey) continue;
    const s = snapStats[charKey];
    if (!s || s.max == null || s.total == null) continue;
    const gap = s.max - s.total;
    if (gap <= 0) continue;
    fillsGaps.push({
      stat: charKey,
      prefix,
      gap,
      delta: r.deltaLabel || `+${(r.itemValue ?? 0) - (r.equippedValue ?? 0)}`,
    });
  }
  return {
    isRecommended: cmp.summary.isUpgrade && fillsGaps.length > 0,
    fillsGaps,
  };
}

function renderCompareTable(comparison) {
  if (!comparison) return '';
  if (!comparison.hasComparison) {
    return `<div class="auction-compare-empty muted">sem item equipado pra comparar</div>`;
  }
  const equippedHead = comparison.equippedName
    ? `${escapeHtml(comparison.equippedName)}${comparison.equippedLevel ? ` · Lvl ${comparison.equippedLevel}` : ''}`
    : '—';
  const rows = comparison.rows.map((r) => {
    const baseCls = r.sign > 0 ? 'is-up' : r.sign < 0 ? 'is-down' : 'is-same';
    const wasted = r.wasted ? ' is-wasted' : '';
    const wastedHint = r.wasted ? ' <span class="cmp-cap-tag" title="stat já no max do merc — ganho será clamped">cap</span>' : '';
    return `
      <tr class="${baseCls}${wasted}">
        <td class="cmp-eq">${r.equippedLabel ? escapeHtml(r.equippedLabel) : '<span class="muted">—</span>'}</td>
        <td class="cmp-it">${r.itemLabel ? escapeHtml(r.itemLabel) : '<span class="muted">—</span>'}${wastedHint}</td>
        <td class="cmp-dt">${signGlyph(r.sign)} ${escapeHtml(deltaText(r))}</td>
      </tr>`;
  }).join('');
  return `
    <div class="auction-compare-head">
      <span class="cmp-vs-equip" title="${escapeHtml(comparison.equippedName || '')}">vs ${equippedHead}</span>
    </div>
    <table class="cmp-table">
      <thead>
        <tr><th>Equipado</th><th>Leilão</th><th>Δ</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAuctionRow(l) {
  const qLabel = l.quality !== null ? QUALITY_LABEL[l.quality] || `q${l.quality}` : '';
  const qClass = l.quality !== null ? `auction-q-${l.quality}` : '';
  const buyoutBits = [];
  if (l.buyoutGold !== null) buyoutBits.push(`${fmtNum(l.buyoutGold)}<span class="muted">g</span>`);
  if (l.buyoutRubies !== null) buyoutBits.push(`${fmtNum(l.buyoutRubies)}<span class="muted">r</span>`);
  const topMark = l.topAny ? '<span class="auction-top-flag" title="prefix/suffix top">⭐</span>' : '';

  const cmp = l.comparison;
  const sum = cmp?.summary;
  const rec = analyzeRecommendation(l, lastSnapshot?.stats);
  const upgradeTooltip = sum
    ? `score ${sum.score} (${sum.up}↑ ${sum.down}↓${sum.lvlDiff ? `, lvl Δ${sum.lvlDiff > 0 ? '+' : ''}${sum.lvlDiff}` : ''})`
    : '';
  let topBadge = '';
  if (rec.isRecommended) {
    const gaps = rec.fillsGaps.map((g) => `${g.prefix} ${g.delta} (gap ${g.gap})`).join('\n');
    topBadge = `<span class="auction-recommend-badge" title="preenche gap em:\n${escapeHtml(gaps)}">✨ RECOMENDADO</span>`;
  } else if (sum?.isUpgrade) {
    topBadge = `<span class="auction-upgrade-badge" title="${upgradeTooltip}">↑ UPGRADE</span>`;
  }
  const wastedChip = cmp?.hasComparison && sum?.wastedUps > 0
    ? `<span class="auction-cap-chip" title="${sum.wastedUps} stat(s) já no max do char: ${(sum.atCap || []).join(', ')}">${sum.wastedUps}⌃cap</span>`
    : '';
  const summaryChip = cmp?.hasComparison
    ? `<span class="auction-cmp-chip ${sum.isUpgrade ? 'is-up' : sum.up < sum.down ? 'is-down' : ''}" title="${upgradeTooltip}">${sum.up}↑ ${sum.down}↓${sum.same ? ' ' + sum.same + '=' : ''}${sum.lvlDiff ? ` · lvlΔ${sum.lvlDiff > 0 ? '+' : ''}${sum.lvlDiff}` : ''}</span>`
    : `<span class="auction-cmp-chip muted-chip">sem comparação</span>`;
  // O servidor não expõe valor exato do lance atual — só o `nextMinBid` (próximo
  // mínimo, ~5% acima do lance corrente). Quando há lance, mostra quem é.
  const bidChip = l.myBid
    ? `<span class="auction-bid-chip is-mine" title="você é o licitador atual · próximo mínimo: ${fmtNum(l.nextMinBid)}g">★ meu lance</span>`
    : l.hasBids
      ? `<span class="auction-bid-chip is-has-bid" title="licitador: ${escapeHtml(l.bidderName || '?')} · próximo mínimo: ${fmtNum(l.nextMinBid)}g">◆ ${escapeHtml(l.bidderName || 'com lance')}</span>`
      : `<span class="auction-bid-chip is-no-bid">sem lance</span>`;
  const category = l.category
    ? `<span class="auction-cat-chip">${escapeHtml(l.category)}</span>`
    : '';
  const expanded = auctionExpanded.has(l.auctionId);

  // Botões de ação. Disabled visualmente quando actions off (mensagem explicativa).
  const actDisabled = !actionsEnabled;
  const actTitle = actDisabled ? 'actions desabilitadas — habilite no topbar' : '';
  const bidActions = `
    <div class="auction-bid-actions" data-actions-for="${l.auctionId}">
      <button class="auction-bid-btn auction-action-bid" data-auction-id="${l.auctionId}" data-min="${l.minBid ?? ''}" ${actDisabled ? 'disabled' : ''} title="${actTitle || 'Dar lance'}">Lance</button>
      <button class="auction-bid-btn is-buyout auction-action-buyout" data-auction-id="${l.auctionId}" ${actDisabled || l.buyoutGold === null ? 'disabled' : ''} title="${actTitle || 'Comprar imediato'}">Comprar</button>
      <span class="auction-bid-status muted" data-status-for="${l.auctionId}"></span>
    </div>`;
  return `
    <article class="auction-row ${qClass} ${l.topAny ? 'is-top' : ''} ${rec.isRecommended ? 'is-recommended' : sum?.isUpgrade ? 'is-upgrade' : ''} ${expanded ? 'is-expanded' : ''} ${l.myBid ? 'is-mine' : ''}" data-auction-id="${l.auctionId}">
      <header class="auction-row-head">
        <div class="auction-row-title">
          <span class="auction-name" title="${escapeHtml(l.name || '')}">${topMark}${escapeHtml(l.name || l.baseName || '?')}</span>
          <div class="auction-row-tags">
            ${category}
            <span class="auction-lvl-chip">Lvl ${l.level ?? '?'}</span>
            ${qLabel ? `<span class="auction-q-pill ${qClass}">${qLabel}</span>` : ''}
            ${topBadge}
          </div>
        </div>
        <button class="auction-expand" data-toggle="${l.auctionId}" aria-expanded="${expanded}" title="${expanded ? 'Recolher' : 'Comparar com equipado'}">${expanded ? '⌃' : '⌄'}</button>
      </header>
      <div class="auction-row-affixes">
        ${affixChip(l.prefix, l.prefixCatalog)}
        ${affixChip(l.suffix, l.suffixCatalog)}
      </div>
      <footer class="auction-row-foot">
        ${summaryChip}
        ${wastedChip}
        ${bidChip}
        <div class="auction-prices">
          <span class="auction-price-bid"><span class="muted">min</span> ${fmtNum(l.minBid)}<span class="muted">g</span></span>
          <span class="auction-price-buy"><span class="muted">buy</span> ${buyoutBits.join(' + ') || '—'}</span>
        </div>
      </footer>
      ${bidActions}
      <div class="auction-compare" ${expanded ? '' : 'hidden'}>${expanded ? renderCompareTable(cmp) : ''}</div>
    </article>`;
}

let lastAuctionData = null;

function renderAuction(data) {
  lastAuctionData = data;
  // Toda resposta do leilão já traz `itemLevelOptions` parseado do HTML cru —
  // aproveita pra manter o dropdown em dia sem precisar de outro fetch.
  if (data?.itemLevelOptions?.length) {
    syncAuctionLevelDropdown(data.itemLevelOptions, { selected: data.filter?.itemLevel ?? null });
  }
  const t = data.totals || {};
  let listings = data.listings;
  if (aucOnlyUpgrades) {
    listings = listings.filter((l) => l.comparison?.summary?.isUpgrade);
  }
  if (aucOnlyWithBids) {
    listings = listings.filter((l) => l.hasBids);
  }
  if (aucOnlyMyBids) {
    listings = listings.filter((l) => l.myBid);
  }
  const upBits = t.upgrades ? ` · ${t.upgrades}↑` : '';
  const bidBits = t.withBids ? ` · ${t.withBids}◆${t.myBids ? ` (${t.myBids}★)` : ''}` : '';
  const summary = data.globalTimeBucket
    ? `${data.globalTimeBucket} · ${listings.length}/${data.listings.length} itens · ${t.topAny ?? 0}⭐${upBits}${bidBits}`
    : `${listings.length}/${data.listings.length} itens · ${t.topAny ?? 0}⭐${upBits}${bidBits}`;
  els.auctionTimeBucket.textContent = summary;
  if (!listings.length) {
    let msg;
    if (aucOnlyUpgrades && data.listings.length) {
      msg = 'nenhum upgrade nessa busca';
    } else if (!data.listings.length) {
      const qVal = parseInt(els.aucItemQuality.value, 10);
      const qHint = qVal === 1 ? ' (azul+)' : qVal === 2 ? ' (roxo)' : qVal === 0 ? ' (verde+)' : '';
      msg = `nenhum item${qHint} nesse filtro · tente outra qualidade ou level`;
    } else {
      msg = 'sem itens';
    }
    els.auctionRows.innerHTML = `<div class="muted" style="text-align:center;padding:10px">${msg}</div>`;
    return;
  }
  els.auctionRows.innerHTML = listings.map(renderAuctionRow).join('');
}

// Bid actions: clica em "Lance" → troca o painel de actions por um form
// inline (input + Confirmar/Cancelar). "Comprar" → confirm() + POST direto.
function setBidStatus(auctionId, msg, kind = '') {
  const el = els.auctionRows.querySelector(`[data-status-for="${auctionId}"]`);
  if (!el) return;
  el.textContent = msg || '';
  el.className = `auction-bid-status ${kind ? `is-${kind}` : 'muted'}`;
}

function buildFilterEcho() {
  return {
    qry: els.aucQry.value || '',
    itemType: parseInt(els.aucItemType.value, 10),
    itemLevel: parseInt(els.aucItemLevel.value, 10),
    itemQuality: parseInt(els.aucItemQuality.value, 10),
  };
}

async function doPlaceBid(auctionId, opts) {
  // O action= do form vem com ttype específico — usamos esse como fonte de
  // verdade. Aba só fallback quando o parser não capturou (sample antigo).
  const listing = lastAuctionData?.listings.find((x) => x.auctionId === auctionId);
  const ttype = listing?.formTtype ?? (aucTtype ? parseInt(aucTtype, 10) : 1);
  const body = {
    auctionId,
    ttype,
    filterEcho: buildFilterEcho(),
    ...opts,
  };
  setBidStatus(auctionId, 'enviando…');
  try {
    const res = await fetch('/api/auction/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      setBidStatus(auctionId, data.reason || data.error || `HTTP ${res.status}`, 'error');
      return;
    }
    setBidStatus(auctionId, opts.buyout ? 'comprado!' : 'lance enviado', 'ok');
    setTimeout(() => refreshAuction(), 600);
  } catch (e) {
    setBidStatus(auctionId, e.message, 'error');
  }
}

function showBidForm(auctionId, defaultMin) {
  const container = els.auctionRows.querySelector(`[data-actions-for="${auctionId}"]`);
  if (!container) return;
  container.innerHTML = `
    <div class="auction-bid-form">
      <span class="muted">lance:</span>
      <input type="number" min="0" step="1" value="${defaultMin || 0}" data-bid-input="${auctionId}" />
      <button class="auction-bid-btn auction-bid-confirm" data-confirm="${auctionId}">Confirmar</button>
      <button class="auction-bid-btn is-cancel auction-bid-cancel" data-cancel="${auctionId}">Cancelar</button>
    </div>
    <span class="auction-bid-status muted" data-status-for="${auctionId}"></span>`;
  const input = container.querySelector(`[data-bid-input="${auctionId}"]`);
  if (input) { input.focus(); input.select(); }
}

function restoreBidActions(auctionId) {
  if (!lastAuctionData) return;
  const l = lastAuctionData.listings.find((x) => x.auctionId === auctionId);
  if (!l) return;
  const container = els.auctionRows.querySelector(`[data-actions-for="${auctionId}"]`);
  if (!container) return;
  const actDisabled = !actionsEnabled;
  const actTitle = actDisabled ? 'actions desabilitadas — habilite no topbar' : '';
  container.innerHTML = `
    <button class="auction-bid-btn auction-action-bid" data-auction-id="${auctionId}" data-min="${l.minBid ?? ''}" ${actDisabled ? 'disabled' : ''} title="${actTitle || 'Dar lance'}">Lance</button>
    <button class="auction-bid-btn is-buyout auction-action-buyout" data-auction-id="${auctionId}" ${actDisabled || l.buyoutGold === null ? 'disabled' : ''} title="${actTitle || 'Comprar imediato'}">Comprar</button>
    <span class="auction-bid-status muted" data-status-for="${auctionId}"></span>`;
}

// Event delegation: clicar no botão de expandir alterna a comparação inline.
els.auctionRows.addEventListener('click', (e) => {
  // Bid action: abrir form inline
  const bidBtn = e.target.closest('.auction-action-bid');
  if (bidBtn) {
    const id = parseInt(bidBtn.dataset.auctionId, 10);
    if (Number.isFinite(id)) {
      const min = parseInt(bidBtn.dataset.min, 10) || 0;
      showBidForm(id, min);
    }
    return;
  }
  // Buyout: confirma e dispara
  const buyBtn = e.target.closest('.auction-action-buyout');
  if (buyBtn) {
    const id = parseInt(buyBtn.dataset.auctionId, 10);
    if (!Number.isFinite(id)) return;
    const l = lastAuctionData?.listings.find((x) => x.auctionId === id);
    const priceLabel = l
      ? `${fmtNum(l.buyoutGold)}g${l.buyoutRubies ? ` + ${fmtNum(l.buyoutRubies)}r` : ''}`
      : '';
    if (!confirm(`Comprar agora?\n${l?.name || `auction ${id}`}\nPreço: ${priceLabel}`)) return;
    doPlaceBid(id, { buyout: true });
    return;
  }
  // Confirma o bid (form inline)
  const confirmBtn = e.target.closest('.auction-bid-confirm');
  if (confirmBtn) {
    const id = parseInt(confirmBtn.dataset.confirm, 10);
    if (!Number.isFinite(id)) return;
    const input = els.auctionRows.querySelector(`[data-bid-input="${id}"]`);
    const value = input ? parseInt(input.value, 10) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setBidStatus(id, 'valor inválido', 'error');
      return;
    }
    doPlaceBid(id, { buyout: false, bidAmount: value });
    return;
  }
  // Cancela o form inline
  const cancelBtn = e.target.closest('.auction-bid-cancel');
  if (cancelBtn) {
    const id = parseInt(cancelBtn.dataset.cancel, 10);
    if (Number.isFinite(id)) restoreBidActions(id);
    return;
  }
  // Expand
  const btn = e.target.closest('.auction-expand');
  if (!btn) return;
  const id = parseInt(btn.dataset.toggle, 10);
  if (!Number.isFinite(id)) return;
  const article = btn.closest('.auction-row');
  if (!article) return;
  const compareEl = article.querySelector('.auction-compare');
  const wasOpen = auctionExpanded.has(id);
  if (wasOpen) {
    auctionExpanded.delete(id);
    article.classList.remove('is-expanded');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '⌄';
    btn.title = 'Comparar com equipado';
    compareEl.hidden = true;
    compareEl.innerHTML = '';
  } else {
    auctionExpanded.add(id);
    article.classList.add('is-expanded');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = '⌃';
    btn.title = 'Recolher';
    // Lazy-render: evita HTML pesado quando o usuário não abriu nada.
    // O dado de comparação fica num data-attribute? Não — re-renderizamos a
    // tabela buscando o listing pelo último data fetch. Pra evitar isso,
    // pedimos um refresh leve: simplesmente refreshAuction() atualiza tudo.
    // Mas isso causa flicker. Solução: cache do último data globalmente.
    if (lastAuctionData) {
      const l = lastAuctionData.listings.find((x) => x.auctionId === id);
      if (l) compareEl.innerHTML = renderCompareTable(l.comparison);
    }
    compareEl.hidden = false;
  }
});

els.btnRefreshAuction.addEventListener('click', refreshAuction);
[els.aucItemType, els.aucItemLevel, els.aucItemQuality, els.aucOnlyTop].forEach((el) =>
  el.addEventListener('change', refreshAuction)
);
els.aucOnlyUpgrades.addEventListener('change', () => {
  aucOnlyUpgrades = els.aucOnlyUpgrades.checked;
  if (lastAuctionData) renderAuction(lastAuctionData);
});
els.aucOnlyWithBids.addEventListener('change', () => {
  aucOnlyWithBids = els.aucOnlyWithBids.checked;
  if (lastAuctionData) renderAuction(lastAuctionData);
});
els.aucOnlyMyBids.addEventListener('change', () => {
  aucOnlyMyBids = els.aucOnlyMyBids.checked;
  if (lastAuctionData) renderAuction(lastAuctionData);
});
els.aucQry.addEventListener('keydown', (e) => { if (e.key === 'Enter') refreshAuction(); });
els.auctionTabs.querySelectorAll('.auction-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.auctionTabs.querySelectorAll('.auction-tab').forEach((b) => b.classList.toggle('active', b === btn));
    aucTtype = btn.dataset.ttype || '';
    refreshAuction();
  });
});

async function refreshTraining() {
  els.btnRefreshTraining.disabled = true;
  try {
    const res = await fetch('/api/training');
    if (!res.ok) throw new Error(`${res.status}`);
    lastTraining = await res.json();
    poll();
  } catch (e) {
    els.trainingGrid.innerHTML = `<div class="training-empty muted">falha: ${escapeHtml(e.message)}</div>`;
  } finally {
    setTimeout(() => (els.btnRefreshTraining.disabled = false), 500);
  }
}

function renderActions(state) {
  actionsEnabled = state.actionsEnabled;
  els.actionsPill.className = `pill ${actionsEnabled ? 'live' : 'observe'}`;
  els.actionsPill.textContent = actionsEnabled ? 'actions on' : 'observe only';
  els.btnDisable.hidden = !actionsEnabled;
  els.btnEnable.hidden = actionsEnabled;
}

function renderLoop(state) {
  const loop = state.loop;
  const now = state.nowMs;

  els.modeLabel.textContent = loop.mode === 'loop' ? 'modo loop' : 'modo once';

  let pillClass = '';
  let pillText = 'idle';
  let dotClass = 'live';
  if (loop.paused) { pillClass = 'paused'; pillText = 'paused'; dotClass = 'paused'; }
  else if (loop.ticking) { pillClass = 'ticking'; pillText = 'ticking'; }
  else if (loop.running) { pillClass = 'running'; pillText = 'running'; }
  else { dotClass = 'stopped'; pillText = 'stopped'; }
  els.loopPill.className = `pill ${pillClass}`;
  els.loopPill.textContent = pillText;
  els.liveDot.className = `dot ${dotClass}`;

  els.btnPause.hidden = loop.paused;
  els.btnResume.hidden = !loop.paused;

  els.loopLast.textContent = fmtTime(loop.lastTickAt);
  els.loopDur.textContent = loop.lastTickDurationMs
    ? `${(loop.lastTickDurationMs / 1000).toFixed(1)}s`
    : '—';
  els.loopCount.textContent = loop.tickCount;

  if (loop.paused) els.loopNext.textContent = '— (paused)';
  else if (loop.ticking) els.loopNext.textContent = 'agora';
  else if (loop.nextTickAt) {
    const remaining = Math.max(0, Math.ceil((loop.nextTickAt - now) / 1000));
    els.loopNext.textContent = fmtSecs(remaining);
  } else els.loopNext.textContent = '—';
}

function renderLogs(logs) {
  if (!logs.length) return;
  const wasAtBottom =
    els.logBox.scrollHeight - els.logBox.scrollTop - els.logBox.clientHeight < 40;
  for (const l of logs) {
    const line = document.createElement('span');
    line.className = `log-line ${l.level}`;
    const ts = new Date(l.ts).toLocaleTimeString('pt-BR');
    line.innerHTML =
      `<span class="ts">${ts}</span>` +
      `<span class="lvl">${l.level.toUpperCase()}</span>` +
      escapeHtml(l.msg);
    els.logBox.appendChild(line);
    els.logBox.appendChild(document.createTextNode('\n'));
    lastLogTs = Math.max(lastLogTs, l.ts);
  }
  while (els.logBox.childElementCount > 500) {
    els.logBox.removeChild(els.logBox.firstChild);
    if (els.logBox.firstChild && els.logBox.firstChild.nodeType === Node.TEXT_NODE) {
      els.logBox.removeChild(els.logBox.firstChild);
    }
  }
  if (els.autoscroll.checked && wasAtBottom) {
    els.logBox.scrollTop = els.logBox.scrollHeight;
  }
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function poll() {
  try {
    const state = await fetchJson('/api/state');
    const snap = state.snapshot;
    lastSnapshot = snap;

    els.snapAge.textContent = state.snapshotAt ? fmtAge(state.snapshotAt, state.nowMs) : 'sem dados';

    renderHero(snap);
    renderResources(snap);
    renderWorking(snap);
    renderBuffs(snap);
    renderCombined(snap);
    renderLoop(state);
    renderActions(state);

    const level = els.logLevel.value || undefined;
    const params = new URLSearchParams();
    if (lastLogTs) params.set('since', lastLogTs);
    if (level) params.set('level', level);
    const { logs } = await fetchJson(`/api/logs?${params}`);
    renderLogs(logs);
  } catch (e) {
    els.liveDot.className = 'dot stopped';
    els.modeLabel.textContent = 'desconectado';
  }
}

els.btnTick.addEventListener('click', async () => {
  els.btnTick.disabled = true;
  try { await fetchJson('/api/tick', { method: 'POST' }); }
  finally { setTimeout(() => (els.btnTick.disabled = false), 500); }
});
els.btnPause.addEventListener('click', () =>
  fetchJson('/api/pause', { method: 'POST' }).then(poll)
);
els.btnResume.addEventListener('click', () =>
  fetchJson('/api/resume', { method: 'POST' }).then(poll)
);
els.btnDisable.addEventListener('click', () => {
  if (!confirm('Desligar todas as actions? Bot só vai observar (sem heal/exp/dung/work/train).')) return;
  fetchJson('/api/actions/disable', { method: 'POST' }).then(poll);
});
els.btnEnable.addEventListener('click', () =>
  fetchJson('/api/actions/enable', { method: 'POST' }).then(poll)
);
els.btnRefreshTraining.addEventListener('click', refreshTraining);

// ─── Tabs Atributos / Mercenários (card Personagem) ───
function showCharTab(tab) {
  els.charTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  els.tabPanes.forEach((p) => { p.hidden = p.dataset.pane !== tab; });
  els.tabInfos.forEach((el) => { el.hidden = el.dataset.showTab !== tab; });
}
els.charTabs.forEach((t) => t.addEventListener('click', () => showCharTab(t.dataset.tab)));

const SLOT_ORDER = ['helmet', 'weapon', 'offhand', 'armor', 'pants', 'boots', 'amulet', 'ring1', 'ring2'];
const SLOT_SHORT_LABEL = {
  helmet: 'Capacete', weapon: 'Arma', offhand: 'Off-hand', armor: 'Armadura',
  pants: 'Calças', boots: 'Sapatos', amulet: 'Amuleto', ring1: 'Anel 1', ring2: 'Anel 2',
};

function renderMercSlot(it, slot, charLevel) {
  const lbl = SLOT_SHORT_LABEL[slot] || slot;
  if (!it || it.empty) {
    return `
      <div class="merc-slot-line is-empty">
        <span class="merc-slot-q empty"></span>
        <span class="merc-slot-name">${lbl}</span>
        <span class="merc-slot-val muted">vazio</span>
        <span class="merc-slot-lvl"></span>
        <span class="merc-slot-delta"></span>
      </div>`;
  }
  const qClass = it.quality !== null && it.quality !== undefined ? `q${it.quality}` : 'q-none';
  const lvlDelta = charLevel != null && it.level != null ? it.level - charLevel : null;
  const deltaClass = lvlDelta == null ? ''
    : lvlDelta <= -10 ? 'is-bad'
    : lvlDelta <= -5 ? 'is-warn'
    : 'is-ok';
  const deltaText = lvlDelta == null ? '' : (lvlDelta >= 0 ? `+${lvlDelta}` : `${lvlDelta}`);
  return `
    <div class="merc-slot-line">
      <span class="merc-slot-q ${qClass}" title="${it.quality === 0 ? 'verde' : it.quality === 1 ? 'azul' : it.quality === 2 ? 'roxo' : 'sem cor'}"></span>
      <span class="merc-slot-name muted">${lbl}</span>
      <span class="merc-slot-val" title="${escapeHtml(it.name || '')}">${escapeHtml(it.name || '?')}</span>
      <span class="merc-slot-lvl">L${it.level ?? '?'}</span>
      <span class="merc-slot-delta ${deltaClass}">${deltaText}</span>
    </div>`;
}

function renderMercs(chars) {
  if (!chars || chars.length === 0) {
    els.mercsGrid.innerHTML = '<div class="muted" style="text-align:center;padding:14px">sem dados</div>';
    return;
  }
  els.mercsGrid.innerHTML = chars.map((c) => {
    const hpPct = c.hp && c.hp.max ? (c.hp.value / c.hp.max) * 100 : (c.hpPercent ?? 0);
    const hpText = c.hp ? `${fmtNum(c.hp.value)} / ${fmtNum(c.hp.max)}` : `${c.hpPercent ?? '?'}%`;
    const statsHtml = STAT_KEYS.map((k) => {
      const s = c.stats?.[k];
      const totalStr = s?.total ?? '?';
      const maxStr = s?.max ?? '?';
      const pct = s && s.max > 0 ? Math.min(100, (s.total / s.max) * 100) : 0;
      const lbl = STAT_LABELS[k].slice(0, 3);
      return `
        <div class="merc-stat" title="${STAT_LABELS[k]}: ${totalStr} / ${maxStr}">
          <span class="merc-stat-lbl">${lbl}</span>
          <span class="merc-stat-val">${totalStr}</span>
          <span class="merc-stat-bar"><span class="merc-stat-fill" style="width:${pct.toFixed(0)}%"></span></span>
        </div>`;
    }).join('');
    const equippedByslot = {};
    for (const it of c.equipped || []) equippedByslot[it.slot] = it;
    const eqHtml = SLOT_ORDER.map((slot) => renderMercSlot(equippedByslot[slot], slot, c.level)).join('');
    return `
      <div class="merc-card">
        <div class="merc-card-head">
          <div class="merc-doll">d${c.doll}</div>
          <div class="merc-meta">
            <div class="merc-name">${escapeHtml(c.name || '?')} <span class="merc-card-lvl">L${c.level ?? '?'}</span></div>
            <div class="merc-role muted">${escapeHtml(c.role || '?')}</div>
          </div>
          <div class="merc-combat" title="Armadura · Dano">
            <span class="merc-combat-armor">${fmtNum(c.armor || 0)} ⛨</span>
            <span class="merc-combat-dmg">${escapeHtml(c.damage || '—')}</span>
          </div>
        </div>
        <div class="merc-hp">
          <div class="merc-hp-track"><div class="bar-fill bar-hp" style="width:${hpPct.toFixed(1)}%"></div></div>
          <span class="merc-hp-text">${hpText}</span>
        </div>
        <div class="merc-stats">${statsHtml}</div>
        <div class="merc-slots">${eqHtml}</div>
      </div>`;
  }).join('');
}

async function refreshChars() {
  els.btnRefreshChars.disabled = true;
  els.mercsGrid.innerHTML = '<div class="muted" style="text-align:center;padding:14px">carregando…</div>';
  try {
    const data = await fetchJson('/api/characters');
    renderMercs(data.characters);
  } catch (e) {
    els.mercsGrid.innerHTML = `<div class="muted" style="text-align:center;padding:14px">falha: ${escapeHtml(e.message)}</div>`;
  } finally {
    setTimeout(() => (els.btnRefreshChars.disabled = false), 500);
  }
}
els.btnRefreshChars.addEventListener('click', refreshChars);

// ─── Sugestões Mercs (Painel 3) ───
const SLOT_LABEL_SHORT = {
  helmet: 'Capacete', weapon: 'Arma', offhand: 'Off-hand', armor: 'Armadura',
  ring1: 'Anel 1', ring2: 'Anel 2', pants: 'Calças', boots: 'Sapatos', amulet: 'Amuleto',
};

function fmtBuyout(c) {
  const bits = [];
  if (c.buyoutGold !== null && c.buyoutGold !== undefined) bits.push(`${fmtNum(c.buyoutGold)}<span class="muted">g</span>`);
  if (c.buyoutRubies) bits.push(`${fmtNum(c.buyoutRubies)}<span class="muted">r</span>`);
  if (!bits.length && c.minBid !== null && c.minBid !== undefined) bits.push(`<span class="muted">min</span> ${fmtNum(c.minBid)}<span class="muted">g</span>`);
  return bits.join(' · ') || '—';
}

const mercExpanded = new Set(); // chave "doll-slot-auctionId" pra preservar estado

function renderCandidateExpanded(c) {
  if (!c.comparison) {
    return `<div class="auction-compare-empty muted">
      sem <code>comparison</code> na resposta — provavelmente o bot precisa ser reiniciado pra carregar <code>src/mercSuggestions.js</code> atualizado.
    </div>`;
  }
  if (!Array.isArray(c.comparison.rows) || c.comparison.rows.length === 0) {
    return `<div class="auction-compare-empty muted">
      comparação chegou sem linhas — item provavelmente sem stats parseáveis.
    </div>`;
  }
  return renderCompareTable(c.comparison);
}

function candidateKey(merc, slot, c) {
  return `${merc.doll}-${slot}-${c.auctionId}`;
}

function renderCandidate(merc, slot, c) {
  const qClass = c.quality !== null ? `auction-q-${c.quality}` : 'auction-q-none';
  const sum = c.summary;
  const lvlDelta = sum.lvlDiff ? `lvl <b>${sum.lvlDiff > 0 ? '+' : ''}${sum.lvlDiff}</b>` : '';
  const score = sum.score >= 0 ? `+${sum.score}` : `${sum.score}`;
  const ups = `<span class="cand-up" title="${sum.up} stat(s) em que o item é melhor que o equipado (excluindo os no cap)">${sum.up}↑</span>`;
  const downs = sum.down > 0
    ? `<span class="cand-down" title="${sum.down} stat(s) em que perde vs equipado (subtrai magnitude × peso do score)">${sum.down}↓</span>`
    : '';
  const wasted = sum.wastedUps > 0
    ? `<span class="cand-cap" title="${sum.wastedUps} stat(s) já no max do merc: ${(sum.atCap || []).join(', ')}">${sum.wastedUps}⌃cap</span>`
    : '';
  const top = sum.topAffixBonus > 0
    ? `<span class="cand-top" title="prefix/suffix top">⭐</span>` : '';
  const eff = sum.efficiency
    ? `<span class="cand-eff" title="score por 1k gold equivalente (1r ≈ 1500g)">${sum.efficiency}/k</span>` : '';
  const sb = c.soulbound
    ? `<span class="cand-sb" title="soulbound">🔒</span>` : '';
  const dupBadge = c.dupOf
    ? `<span class="cand-dup" title="também listado em ${c.dupOf} desse merc">↻ ${c.dupOf}</span>` : '';
  const bidMark = c.hasBids ? '<span class="cand-bid" title="já tem lance">◆</span>' : '';
  const key = candidateKey(merc, slot, c);
  const expanded = mercExpanded.has(key);
  const dupClass = c.dupOf ? 'is-dup' : '';
  return `
    <div class="merc-suggest-candidate ${qClass} ${expanded ? 'is-expanded' : ''} ${dupClass}" data-cand-key="${key}">
      <button class="merc-suggest-candidate-row" data-toggle="${key}" aria-expanded="${expanded}">
        <span class="cand-arrow">${expanded ? '▼' : '▶'}</span>
        <span class="cand-name" title="${escapeHtml(c.name || '')}">${top}${escapeHtml(c.name || c.baseName || '?')} ${sb} ${dupBadge}</span>
        <span class="cand-meta">
          <span class="cand-lvl">L${c.level ?? '?'}</span>
          ${lvlDelta ? `<span class="cand-lvldelta">${lvlDelta}</span>` : ''}
        </span>
        <span class="cand-stats">${ups} ${downs} ${wasted}</span>
        <span class="cand-score" title="score = Σ(peso × roleBoost × Δ) − downs + lvlΔ/5 + topBonus">${score}</span>
        <span class="cand-buy">${fmtBuyout(c)} ${eff} ${bidMark}</span>
      </button>
      <div class="merc-suggest-candidate-detail" ${expanded ? '' : 'hidden'}>
        ${expanded ? renderCandidateExpanded(c) + renderCandidateBidActions(c, key) : ''}
      </div>
    </div>`;
}

function renderMercSuggestionsBlock(merc) {
  const slotsHtml = merc.suggestions.map((s) => {
    const slotName = SLOT_LABEL_SHORT[s.slot] || s.slot;
    const currentBits = s.currentName
      ? `${escapeHtml(s.currentName)} <span class="muted">L${s.currentLevel ?? '?'}</span>`
      : `<span class="muted">slot vazio</span>`;
    const slotPriority = s.priority >= 999 ? '<span class="slot-flag empty">VAZIO</span>'
      : s.priority >= 10 ? '<span class="slot-flag urgent">URGENTE</span>'
      : '';
    if (!s.candidates.length) {
      return `
        <div class="merc-suggest-slot-row">
          <div class="merc-suggest-slot-head">
            <span class="merc-suggest-slot-lbl">${slotName}</span>
            ${slotPriority}
            <span class="merc-suggest-slot-current">${currentBits}</span>
          </div>
          <div class="merc-suggest-empty-row">sem candidatos no leilão</div>
        </div>`;
    }
    const candHtml = s.candidates.map((c) => renderCandidate(merc, s.slot, c)).join('');
    return `
      <div class="merc-suggest-slot-row">
        <div class="merc-suggest-slot-head">
          <span class="merc-suggest-slot-lbl">${slotName}</span>
          ${slotPriority}
          <span class="merc-suggest-slot-current">${currentBits}</span>
        </div>
        <div class="merc-suggest-candidates">${candHtml}</div>
      </div>`;
  }).join('');
  const roleBadge = merc.mercRole
    ? `<span class="merc-role-badge merc-role-${merc.mercRole}" title="role aplicada nos pesos">${MERC_ROLE_LABEL[merc.mercRole] || merc.mercRole}</span>`
    : '';
  return `
    <div class="merc-suggest-block">
      <div class="merc-suggest-block-head">
        <span class="merc-doll-pill">d${merc.doll}</span>
        <span class="merc-name">${escapeHtml(merc.name || `doll ${merc.doll}`)}</span>
        <span class="muted">L${merc.level ?? '?'}</span>
        ${roleBadge}
        <span class="muted merc-role">${escapeHtml(merc.role || '?')}</span>
      </div>
      ${slotsHtml || '<div class="merc-suggest-empty-row">sem slots avaliados</div>'}
    </div>`;
}

let lastMercData = null;

function renderMercSuggestions(data) {
  lastMercData = data;
  const mercs = data.mercs || [];
  if (!mercs.length) {
    els.mercsSuggestBody.innerHTML = '<div class="muted" style="text-align:center;padding:14px">DB sem mercs — atualiza a aba Mercenários primeiro.</div>';
    els.auctionTimeBucket.textContent = '—';
    return;
  }
  const totalCandidates = mercs.reduce(
    (n, m) => n + m.suggestions.reduce((nn, s) => nn + s.candidates.length, 0), 0,
  );
  const rangeBit = data.range ? ` · L${data.range.min}-${data.range.max}` : '';
  const timeBit = data.globalTimeBucket ? `${data.globalTimeBucket} · ` : '';
  els.auctionTimeBucket.textContent =
    `${timeBit}${mercs.length} chars · ${totalCandidates} candidatos · ${data.listingsCount} listings${rangeBit}`;
  els.mercsSuggestBody.innerHTML = mercs.map(renderMercSuggestionsBlock).join('');
}

// Switch entre Listagem ↔ Sugestões Mercs dentro do card Leilão.
els.auctionViewTabs.querySelectorAll('.auction-view-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (aucView === btn.dataset.view) return;
    aucView = btn.dataset.view;
    mercExpanded.clear();
    applyAuctionView();
    refreshAuction();
  });
});

if (els.aucMercSlots) {
  els.aucMercSlots.addEventListener('change', () => {
    if (aucView === 'mercs') refreshAuction();
  });
}
if (els.btnRefreshMercsStats) {
  els.btnRefreshMercsStats.addEventListener('click', () => {
    pendingRefreshStats = true;
    if (aucView !== 'mercs') {
      aucView = 'mercs';
      applyAuctionView();
    }
    refreshAuction();
  });
}
if (els.btnAuctionLegend && els.auctionLegend) {
  els.btnAuctionLegend.addEventListener('click', () => {
    els.auctionLegend.hidden = !els.auctionLegend.hidden;
    els.btnAuctionLegend.classList.toggle('is-active', !els.auctionLegend.hidden);
  });
}

function lookupMercCandidate(key) {
  if (!lastMercData) return null;
  const parts = key.split('-');
  const doll = parseInt(parts[0], 10);
  const slot = parts[1];
  const auctionId = parseInt(parts[2], 10);
  const merc = lastMercData.mercs.find((m) => m.doll === doll);
  const slotData = merc?.suggestions.find((s) => s.slot === slot);
  return slotData?.candidates.find((c) => c.auctionId === auctionId) || null;
}

function renderCandidateBidActions(c, key) {
  const actDisabled = !actionsEnabled;
  const actTitle = actDisabled ? 'actions desabilitadas — habilite no topbar' : '';
  return `
    <div class="merc-cand-bid-actions" data-cand-actions="${key}">
      <button class="auction-bid-btn merc-cand-bid" data-cand-bid="${c.auctionId}" data-cand-key="${key}" data-min="${c.minBid ?? ''}" data-ttype="${c.formTtype ?? ''}" ${actDisabled ? 'disabled' : ''} title="${actTitle || 'Dar lance'}">Lance</button>
      <button class="auction-bid-btn is-buyout merc-cand-buy" data-cand-buy="${c.auctionId}" data-cand-key="${key}" data-ttype="${c.formTtype ?? ''}" ${actDisabled || c.buyoutGold === null ? 'disabled' : ''} title="${actTitle || 'Comprar imediato'}">Comprar</button>
      <span class="auction-bid-status muted" data-cand-status="${key}"></span>
    </div>`;
}

function setMercBidStatus(key, msg, kind = '') {
  const el = els.mercsSuggestBody.querySelector(`[data-cand-status="${key}"]`);
  if (!el) return;
  el.textContent = msg || '';
  el.className = `auction-bid-status ${kind ? `is-${kind}` : 'muted'}`;
}

async function doCandidateBid(c, key, opts) {
  const ttype = c.formTtype ?? (aucTtype ? parseInt(aucTtype, 10) : 1);
  const body = { auctionId: c.auctionId, ttype, filterEcho: buildFilterEcho(), ...opts };
  setMercBidStatus(key, 'enviando…');
  try {
    const res = await fetch('/api/auction/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      setMercBidStatus(key, data.reason || data.error || `HTTP ${res.status}`, 'error');
      return;
    }
    setMercBidStatus(key, opts.buyout ? 'comprado!' : 'lance enviado', 'ok');
    setTimeout(() => refreshMercSuggestionsView(), 600);
  } catch (e) {
    setMercBidStatus(key, e.message, 'error');
  }
}

function showMercBidForm(c, key) {
  const container = els.mercsSuggestBody.querySelector(`[data-cand-actions="${key}"]`);
  if (!container) return;
  container.innerHTML = `
    <div class="auction-bid-form">
      <span class="muted">lance:</span>
      <input type="number" min="0" step="1" value="${c.minBid ?? 0}" data-cand-bid-input="${key}" />
      <button class="auction-bid-btn merc-cand-bid-confirm" data-cand-confirm="${key}">Confirmar</button>
      <button class="auction-bid-btn is-cancel merc-cand-bid-cancel" data-cand-cancel="${key}">Cancelar</button>
    </div>
    <span class="auction-bid-status muted" data-cand-status="${key}"></span>`;
  const input = container.querySelector(`[data-cand-bid-input="${key}"]`);
  if (input) { input.focus(); input.select(); }
}

function restoreMercBidActions(key) {
  const cand = lookupMercCandidate(key);
  if (!cand) return;
  const container = els.mercsSuggestBody.querySelector(`[data-cand-actions="${key}"]`);
  if (!container) return;
  container.outerHTML = renderCandidateBidActions(cand, key);
}

// Click no botão do candidato: alterna expansão inline (mostra tabela cmp + bid).
els.mercsSuggestBody.addEventListener('click', (e) => {
  // Lance — abre form inline
  const bidBtn = e.target.closest('.merc-cand-bid');
  if (bidBtn) {
    e.stopPropagation();
    const key = bidBtn.dataset.candKey;
    const cand = lookupMercCandidate(key);
    if (cand) showMercBidForm(cand, key);
    return;
  }
  // Comprar — confirm + dispara
  const buyBtn = e.target.closest('.merc-cand-buy');
  if (buyBtn) {
    e.stopPropagation();
    const key = buyBtn.dataset.candKey;
    const cand = lookupMercCandidate(key);
    if (!cand) return;
    const priceLabel = `${fmtNum(cand.buyoutGold)}g${cand.buyoutRubies ? ` + ${fmtNum(cand.buyoutRubies)}r` : ''}`;
    if (!confirm(`Comprar agora?\n${cand.name || `auction ${cand.auctionId}`}\nPreço: ${priceLabel}`)) return;
    doCandidateBid(cand, key, { buyout: true });
    return;
  }
  // Confirma bid form
  const confirmBtn = e.target.closest('.merc-cand-bid-confirm');
  if (confirmBtn) {
    e.stopPropagation();
    const key = confirmBtn.dataset.candConfirm;
    const cand = lookupMercCandidate(key);
    if (!cand) return;
    const input = els.mercsSuggestBody.querySelector(`[data-cand-bid-input="${key}"]`);
    const value = input ? parseInt(input.value, 10) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setMercBidStatus(key, 'valor inválido', 'error');
      return;
    }
    doCandidateBid(cand, key, { buyout: false, bidAmount: value });
    return;
  }
  // Cancela bid form
  const cancelBtn = e.target.closest('.merc-cand-bid-cancel');
  if (cancelBtn) {
    e.stopPropagation();
    restoreMercBidActions(cancelBtn.dataset.candCancel);
    return;
  }
  // Expand/colapse normal
  const btn = e.target.closest('.merc-suggest-candidate-row');
  if (!btn) return;
  const key = btn.dataset.toggle;
  if (!key) return;
  const wrapper = btn.closest('.merc-suggest-candidate');
  const detail = wrapper.querySelector('.merc-suggest-candidate-detail');
  const arrow = btn.querySelector('.cand-arrow');
  if (mercExpanded.has(key)) {
    mercExpanded.delete(key);
    wrapper.classList.remove('is-expanded');
    btn.setAttribute('aria-expanded', 'false');
    if (arrow) arrow.textContent = '▶';
    detail.hidden = true;
    detail.innerHTML = '';
  } else {
    mercExpanded.add(key);
    wrapper.classList.add('is-expanded');
    btn.setAttribute('aria-expanded', 'true');
    if (arrow) arrow.textContent = '▼';
    const cand = lookupMercCandidate(key);
    if (cand) {
      detail.innerHTML = renderCandidateExpanded(cand) + renderCandidateBidActions(cand, key);
    } else if (!lastMercData) {
      detail.innerHTML = '<div class="auction-compare-empty muted">lastMercData ainda não foi carregado — clique em ⟳</div>';
    } else {
      detail.innerHTML = `<div class="auction-compare-empty muted">candidato não encontrado em lastMercData</div>`;
    }
    detail.hidden = false;
  }
});
els.logLevel.addEventListener('change', () => {
  els.logBox.innerHTML = '';
  lastLogTs = 0;
  poll();
});

// ─── Drawer (Loop / Logs) ───
function showDrawerTab(tab) {
  els.auxDrawer.hidden = false;
  els.drawerTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  els.drawerPanes.forEach((p) => { p.hidden = p.dataset.pane !== tab; });
}
function closeDrawer() {
  els.auxDrawer.hidden = true;
}
els.btnLoopPanel.addEventListener('click', () => {
  if (!els.auxDrawer.hidden && !document.querySelector('.drawer-pane[data-pane="loop"]').hidden) {
    closeDrawer();
  } else {
    showDrawerTab('loop');
  }
});
els.btnLogsPanel.addEventListener('click', () => {
  if (!els.auxDrawer.hidden && !document.querySelector('.drawer-pane[data-pane="logs"]').hidden) {
    closeDrawer();
  } else {
    showDrawerTab('logs');
  }
});
els.btnCloseDrawer.addEventListener('click', closeDrawer);
els.drawerTabs.forEach((t) => t.addEventListener('click', () => showDrawerTab(t.dataset.tab)));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.auxDrawer.hidden) closeDrawer();
});

poll();
setInterval(poll, REFRESH_MS);
// Lazy-load training on first paint so the section isn't empty
setTimeout(refreshTraining, 1500);
// Popular o select de level do leilão com base no level do char (uma vez).
setTimeout(ensureAuctionLevelOptions, 800);
// Aplicar visibilidade inicial de filtros conforme view (default = listing).
applyAuctionView();
