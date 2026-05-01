// Singleton in-memory state shared between the orchestrator (writer) and the
// UI server (reader). Intentionally a plain object — no events, no framework.
// UI polls; orchestrator mutates. Volatile by design: when the bot restarts,
// everything here is gone (logs go to the file sink for that case).

const RING_MAX = 200;

const botState = {
  startedAt: Date.now(),
  client: null,              // GladiatusClient ref — set by index.js once login completes
  actionsEnabled: true,      // kill switch — initialized from config in index.js
  lastSnapshot: null,        // most recent overview parse
  lastSnapshotAt: null,      // ms epoch
  loop: {
    mode: 'once',            // 'once' | 'loop'
    running: false,          // true once first tick begins
    paused: false,
    ticking: false,          // true while a tick is mid-flight
    lastTickAt: null,        // ms epoch
    lastTickDurationMs: null,
    nextTickAt: null,        // ms epoch — when the current sleep ends
    tickCount: 0,
    tickNowRequested: false, // UI sets, sleep loop consumes
  },
  logs: [],                  // ring buffer of { ts, level, msg }
  myBidAuctionIds: new Set(), // IDs onde demos lance via UI nessa sessão.
                              // Complementa o parser (sem sample pós-bid real).
  lastAuctionBucket: null,    // 'Curto' | 'Médio' | 'Longo' | null. Atualizado
                              // por fetchAuctionList; usado pra gatear lances
                              // (só permitidos em 'Curto', regra do usuário).
  lastAuctionBucketAt: null,  // ms epoch — pra invalidar leitura velha.
};

export function getStateView() {
  return {
    startedAt: botState.startedAt,
    nowMs: Date.now(),
    snapshot: botState.lastSnapshot,
    snapshotAt: botState.lastSnapshotAt,
    loop: { ...botState.loop },
    actionsEnabled: botState.actionsEnabled,
  };
}

export function setActionsEnabled(enabled) {
  botState.actionsEnabled = !!enabled;
}

export function isActionsEnabled() {
  return botState.actionsEnabled;
}

export function setSnapshot(snapshot) {
  botState.lastSnapshot = snapshot;
  botState.lastSnapshotAt = Date.now();
}

export function setClient(client) {
  botState.client = client;
}

export function getClient() {
  return botState.client;
}

export function markTickStart() {
  botState.loop.ticking = true;
  botState.loop.lastTickAt = Date.now();
}

export function markTickEnd() {
  const now = Date.now();
  botState.loop.ticking = false;
  botState.loop.tickCount += 1;
  if (botState.loop.lastTickAt) {
    botState.loop.lastTickDurationMs = now - botState.loop.lastTickAt;
  }
}

export function setLoopMode(mode) {
  botState.loop.mode = mode;
  botState.loop.running = true;
}

export function setNextTickAt(ms) {
  botState.loop.nextTickAt = ms;
}

export function pause() {
  botState.loop.paused = true;
}

export function resume() {
  botState.loop.paused = false;
}

export function isPaused() {
  return botState.loop.paused;
}

export function requestTickNow() {
  botState.loop.tickNowRequested = true;
}

export function consumeTickNowRequest() {
  if (botState.loop.tickNowRequested) {
    botState.loop.tickNowRequested = false;
    return true;
  }
  return false;
}

export function pushLog(level, msg) {
  botState.logs.push({ ts: Date.now(), level, msg });
  if (botState.logs.length > RING_MAX) {
    botState.logs.splice(0, botState.logs.length - RING_MAX);
  }
}

export function markMyBid(auctionId) {
  if (auctionId !== null && auctionId !== undefined) {
    botState.myBidAuctionIds.add(Number(auctionId));
  }
}

export function getMyBidIds() {
  return botState.myBidAuctionIds;
}

export function setLastAuctionBucket(bucket) {
  botState.lastAuctionBucket = bucket || null;
  botState.lastAuctionBucketAt = bucket ? Date.now() : null;
}

export function getLastAuctionBucket(maxAgeMs = 60_000) {
  if (!botState.lastAuctionBucketAt) return null;
  if (Date.now() - botState.lastAuctionBucketAt > maxAgeMs) return null;
  return botState.lastAuctionBucket;
}

export function getLogs({ since = 0, level } = {}) {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = level ? (levels[level] ?? 0) : 0;
  return botState.logs.filter((l) => l.ts > since && (levels[l.level] ?? 0) >= min);
}
