import 'dotenv/config';

function bool(s, def = false) {
  if (s === undefined) return def;
  return /^(1|true|yes|on)$/i.test(s);
}

export const config = {
  baseUrl: process.env.BASE_URL || 'https://s62-br.gladiatus.gameforge.com',
  lobbyUrl: process.env.LOBBY_URL || 'https://lobby.gladiatus.gameforge.com/',
  browser: {
    userDataDir: process.env.USER_DATA_DIR || './browser-data',
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: bool(process.env.HEADLESS, false),
  },
  expedition: {
    location: parseInt(process.env.EXPEDITION_LOCATION || '2', 10),
    stage: parseInt(process.env.EXPEDITION_STAGE || '2', 10),
  },
  heal: {
    thresholdPct: parseInt(process.env.HEAL_THRESHOLD_PCT || '20', 10),
  },
  work: {
    job: parseInt(process.env.WORK_JOB || '2', 10),
    hours: parseInt(process.env.WORK_HOURS || '8', 10),
  },
  loop: {
    tickMinMs: parseInt(process.env.LOOP_TICK_MIN_MS || '2000', 10),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};
