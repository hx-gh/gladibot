import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/bot/src/config.ts -> repo root = three levels up
const repoRoot = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

function bool(s: string | undefined, def = false): boolean {
  if (s === undefined) return def;
  return /^(1|true|yes|on)$/i.test(s);
}

export interface Config {
  baseUrl: string;
  lobbyUrl: string;
  browser: {
    userDataDir: string;
    channel: string;
    headless: boolean;
  };
  expedition: {
    location: number;
    stage: number;
  };
  dungeon: {
    location: number;
    skipBoss: boolean;
  };
  heal: {
    thresholdPct: number;
    autobuy: {
      enabled: boolean;
      target: number;
      minRatio: number;
      maxBudgetPerTick: number;
    };
  };
  packages: {
    enabled: boolean;
  };
  work: {
    job: number;
    hours: number;
  };
  loop: {
    tickMinMs: number;
  };
  actions: {
    enabled: boolean;
  };
  ui: {
    enabled: boolean;
    port: number;
    autoOpen: boolean;
  };
  logLevel: string;
}

export const config: Config = {
  baseUrl: process.env.BASE_URL || 'https://s62-br.gladiatus.gameforge.com',
  lobbyUrl: process.env.LOBBY_URL || 'https://lobby.gladiatus.gameforge.com/',
  browser: {
    userDataDir: process.env.USER_DATA_DIR || path.join(repoRoot, "browser-data"),
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: bool(process.env.HEADLESS, false),
  },
  expedition: {
    location: parseInt(process.env.EXPEDITION_LOCATION || '3', 10),
    stage: parseInt(process.env.EXPEDITION_STAGE || '2', 10),
  },
  dungeon: {
    location: parseInt(process.env.DUNGEON_LOCATION || '1', 10),
    // Quando true, pula o boss (div.map_label "Chefe") e fica idle se só ele
    // sobrar. Default true: evita queimar pontos em boss mais forte que o char.
    skipBoss: bool(process.env.DUNGEON_SKIP_BOSS, true),
  },
  heal: {
    thresholdPct: parseInt(process.env.HEAL_THRESHOLD_PCT || '20', 10),
    autobuy: {
      enabled: bool(process.env.AUTOBUY_HEAL_ENABLED, true),
      target: parseInt(process.env.AUTOBUY_HEAL_TARGET || '5', 10),
      minRatio: parseFloat(process.env.AUTOBUY_HEAL_MIN_RATIO || '3'),
      maxBudgetPerTick: parseInt(process.env.AUTOBUY_HEAL_MAX_BUDGET_TICK || '50000', 10),
    },
  },
  packages: {
    enabled: bool(process.env.PACKAGES_ENABLED, true),
  },
  work: {
    job: parseInt(process.env.WORK_JOB || '2', 10),
    hours: parseInt(process.env.WORK_HOURS || '8', 10),
  },
  loop: {
    tickMinMs: parseInt(process.env.LOOP_TICK_MIN_MS || '2000', 10),
  },
  actions: {
    // Master kill switch. When false, every action (heal/exp/dung/work) is a
    // no-op — bot still parses overview and updates UI, just doesn't write.
    enabled: bool(process.env.ACTIONS_ENABLED, true),
  },
  ui: {
    enabled: bool(process.env.UI_ENABLED, true),
    port: parseInt(process.env.UI_PORT || '3000', 10),
    autoOpen: bool(process.env.UI_AUTO_OPEN, true),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};
