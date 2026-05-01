import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { pushLog } from './botState.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? 20;

const LOG_DIR = path.resolve('logs');
const LOG_FILE = path.join(LOG_DIR, 'session.log');

let fileFd = null;
function ensureFile() {
  if (fileFd !== null) return fileFd;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    // Truncate session log on startup. ftruncate on a fd opened with 'a' is
    // EPERM on Windows; doing it via writeFileSync('') sidesteps that.
    writeFileSync(LOG_FILE, '');
    fileFd = openSync(LOG_FILE, 'a');
  } catch {
    fileFd = -1;
  }
  return fileFd;
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const stamp = ts();
  const tag = `[${stamp}] ${level.toUpperCase().padEnd(5)}`;
  const msg = args.map(formatArg).join(' ');

  console.log(tag, ...args);
  pushLog(level, msg);

  const fd = ensureFile();
  if (fd && fd !== -1) {
    try { writeSync(fd, `${tag} ${msg}\n`); } catch { /* non-fatal */ }
  }
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
};

process.on('exit', () => {
  if (fileFd && fileFd !== -1) {
    try { closeSync(fileFd); } catch { /* ignore */ }
  }
});
