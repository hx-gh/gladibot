// Types for the auction module (Painel 2).

export interface AuctionStatRow {
  label: string;
  color: string | null;
  delta: string | null;
}

export interface AuctionTooltipBlock {
  name: string;
  nameStyle: string;
  stats: AuctionStatRow[];
  level: number | null;
  value: number | null;
  durability: { value: number; max: number } | null;
  conditioning: { value: number; max: number } | null;
  soulbound: string | null;
}

export interface AuctionTooltip {
  item: AuctionTooltipBlock | null;
  equipped: AuctionTooltipBlock | null;
}

export interface AuctionFilter {
  doll: number | null;
  qry: string;
  itemType: number | null;
  itemLevel: number | null;
  itemQuality: number | null;
}

export interface AuctionListing {
  auctionId: number;
  formTtype: number | null;
  itemTypeId: number | null;
  itemType: number | null;
  itemSubtype: number | null;
  basis: string | null;
  hash: string | null;
  level: number | null;
  quality: number | null;
  priceGold: number | null;
  priceMultiplier: number | null;
  measurementX: number | null;
  measurementY: number | null;
  name: string | null;
  baseName: string | null;
  prefix: string | null;
  suffix: string | null;
  hasBids: boolean;
  bidderName: string | null;
  myBid: boolean;
  nextMinBid: number | null;
  minBid: number | null;
  buyoutGold: number | null;
  buyoutRubies: number | null;
  tooltip: AuctionTooltip | null;
  // enriched fields (set post-parse by actions/auction.ts)
  topAny?: boolean;
  topPrefix?: boolean | null;
  topSuffix?: boolean | null;
  category?: string | null;
  comparison?: AuctionComparison | null;
  affixCoverage?: number;
  wastedUps?: number;
  dupOf?: string | null;
  soulbound?: string | null;
}

// Enrichment from itemCompare
export interface AuctionComparison {
  hasComparison: boolean;
  summary?: {
    isUpgrade: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AuctionListResult {
  filter: AuctionFilter;
  globalTimeBucket: string | null;
  itemLevelOptions: number[];
  listings: AuctionListing[];
  totals?: AuctionTotals;
}

export interface AuctionTotals {
  visible: number;
  topAny: number;
  fullyClassified: number;
  upgrades: number;
  withBids: number;
  myBids: number;
}
