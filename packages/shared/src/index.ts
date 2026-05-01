// @gladibot/shared — canonical type exports.
// All types are interface-only (no runtime values). Import as:
//   import type { BotSnapshot } from '@gladibot/shared';

export type {
  HpInfo,
  PoolInfo,
  InventoryFoodItem,
  StatDetail,
  StatBlock,
  BuffEntry,
  BuffsBlock,
  InventoryCell,
  InventoryGrid,
  BotSnapshot,
} from './snapshot.js';

export type {
  AuctionStatRow,
  AuctionTooltipBlock,
  AuctionTooltip,
  AuctionFilter,
  AuctionListing,
  AuctionListResult,
} from './auction.js';

export type {
  DollId,
  MercRole,
  AuctionStatRowLike,
  EquippedItemRow,
  CharacterRow,
} from './characters.js';

export type { WorkStatus } from './work.js';

export type {
  LoopStatus,
  BotStateView,
  TickResponse,
  AuctionListResponse,
  BidRequest,
  BidResponse,
  AuctionLevelOptionsResponse,
  TrainRequest,
  TrainResponse,
  CharactersResponse,
  MercSuggestion,
  MercCandidate,
  MercSuggestionsResponse,
} from './api.js';
