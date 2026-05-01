// Singleton in-memory state shared between the orchestrator (writer) and the
// UI server (reader). Intentionally a plain object — no events, no framework.
// UI polls; orchestrator mutates. Volatile by design: when the bot restarts,
// everything here is gone (logs go to the file sink for that case).

import type { BotSnapshot, BotStateView, LoopStatus } from '@gladibot/shared';

// GladiatusClient is imported lazily to avoid circular deps — we only store a ref.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

const RING_MAX = 200;

const botState = {
  startedAt: Date.now(),
  client: null as AnyClient | null,
  actionsEnabled: true,
  lastSnapshot: null as BotSnapshot | null,
  lastSnapshotAt: null as number | null,
  loop: {
    mode: 'once' as 'once' | 'loop',
    running: false,
    paused: false,
    ticking: false,
    lastTickAt: null as number | null,
    lastTickDurationMs: null as number | null,
    nextTickAt: null as number | null,
    tickCount: 0,
    tickNowRequested: false,
  },
  logs: [] as LogEntry[],
  myBidAuctionIds: new Set<number>(),
  lastAuctionBucket: null as string | null,
  lastAuctionBucketAt: null as number | null,
};

export function getStateView(): BotStateView {
  return {
    startedAt: botState.startedAt,
    nowMs: Date.now(),
    snapshot: botState.lastSnapshot,
    snapshotAt: botState.lastSnapshotAt,
    loop: { ...botState.loop } as LoopStatus,
    actionsEnabled: botState.actionsEnabled,
  };
}

export function setActionsEnabled(enabled: boolean): void {
  botState.actionsEnabled = !!enabled;
}

export function isActionsEnabled(): boolean {
  return botState.actionsEnabled;
}

export function setSnapshot(snapshot: BotSnapshot): void {
  botState.lastSnapshot = snapshot;
  botState.lastSnapshotAt = Date.now();
}

export function setClient(client: AnyClient): void {
  botState.client = client;
}

export function getClient(): AnyClient | null {
  return botState.client;
}

export function markTickStart(): void {
  botState.loop.ticking = true;
  botState.loop.lastTickAt = Date.now();
}

export function markTickEnd(): void {
  const now = Date.now();
  botState.loop.ticking = false;
  botState.loop.tickCount += 1;
  if (botState.loop.lastTickAt) {
    botState.loop.lastTickDurationMs = now - botState.loop.lastTickAt;
  }
}

export function setLoopMode(mode: 'once' | 'loop'): void {
  botState.loop.mode = mode;
  botState.loop.running = true;
}

export function setNextTickAt(ms: number | null): void {
  botState.loop.nextTickAt = ms;
}

export function pause(): void {
  botState.loop.paused = true;
}

export function resume(): void {
  botState.loop.paused = false;
}

export function isPaused(): boolean {
  return botState.loop.paused;
}

export function requestTickNow(): void {
  botState.loop.tickNowRequested = true;
}

export function consumeTickNowRequest(): boolean {
  if (botState.loop.tickNowRequested) {
    botState.loop.tickNowRequested = false;
    return true;
  }
  return false;
}

export function pushLog(level: LogLevel, msg: string): void {
  botState.logs.push({ ts: Date.now(), level, msg });
  if (botState.logs.length > RING_MAX) {
    botState.logs.splice(0, botState.logs.length - RING_MAX);
  }
}

export function markMyBid(auctionId: number | null | undefined): void {
  if (auctionId !== null && auctionId !== undefined) {
    botState.myBidAuctionIds.add(Number(auctionId));
  }
}

export function getMyBidIds(): Set<number> {
  return botState.myBidAuctionIds;
}

export function setLastAuctionBucket(bucket: string | null | undefined): void {
  botState.lastAuctionBucket = bucket || null;
  botState.lastAuctionBucketAt = bucket ? Date.now() : null;
}

export function getLastAuctionBucket(maxAgeMs = 60_000): string | null {
  if (!botState.lastAuctionBucketAt) return null;
  if (Date.now() - botState.lastAuctionBucketAt > maxAgeMs) return null;
  return botState.lastAuctionBucket;
}

const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function getLogs({ since = 0, level }: { since?: number; level?: string } = {}): LogEntry[] {
  const min = level ? (LOG_LEVELS[level as LogLevel] ?? 0) : 0;
  return botState.logs.filter(
    (l) => l.ts > since && (LOG_LEVELS[l.level] ?? 0) >= min
  );
}
