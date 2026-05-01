// Request/response shapes for the Express UI API (/api/*).
// Consumed by apps/bot/src/ui/server.js and (future) apps/web.

import type { BotSnapshot } from './snapshot.js';
import type { AuctionListResult, AuctionListing } from './auction.js';
import type { CharacterRow } from './characters.js';
import type { MercRole } from './characters.js';

// --- /api/state ---

export interface LoopStatus {
  mode: 'once' | 'loop';
  running: boolean;
  paused: boolean;
  ticking: boolean;
  lastTickAt: number | null;
  lastTickDurationMs: number | null;
  nextTickAt: number | null;
  tickCount: number;
  tickNowRequested: boolean;
}

export interface BotStateView {
  startedAt: number;
  nowMs: number;
  snapshot: BotSnapshot | null;
  snapshotAt: number | null;
  loop: LoopStatus;
  actionsEnabled: boolean;
}

// --- /api/tick ---

export interface TickResponse {
  queued: boolean;
}

// --- /api/auction ---

export type AuctionListResponse = AuctionListResult;

// --- /api/auction/bid ---

export interface BidRequest {
  auctionId: number;
  ttype: number;
  amount: number;
  buyout: boolean;
}

export interface BidResponse {
  ok: boolean;
  listing?: AuctionListing | null;
  error?: string;
}

// --- /api/auction/level-options ---

export interface AuctionLevelOptionsResponse {
  options: number[];
}

// --- /api/train ---

export interface TrainRequest {
  skillToTrain: number;
}

export interface TrainResponse {
  ok: boolean;
  error?: string;
}

// --- /api/characters ---

export type CharactersResponse = CharacterRow[];

// --- /api/mercs/suggestions ---

export interface MercSuggestion {
  doll: number;
  slot: string;
  mercRole: MercRole;
  score: number;
  efficiency: number;
  candidates: MercCandidate[];
}

export interface MercCandidate {
  listing: AuctionListing;
  score: number;
  efficiency: number;
  wasted: boolean;
  dupOf?: string | null;
  soulbound?: string | null;
}

export interface MercSuggestionsResponse {
  suggestions: MercSuggestion[];
  updatedAt: number;
}
