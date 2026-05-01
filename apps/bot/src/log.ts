import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { pushLog } from './botState.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = (LEVELS as Record<string, number>)[config.logLevel] ?? 20;

const LOG_DIR = path.resolve('logs');
const LOG_FILE = path.join(LOG_DIR, 'session.log');

let fileFd: number | null = null;
function ensureFile(): number | null {
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

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function emit(level: LogLevel, args: unknown[]): void {
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
  debug: (...a: unknown[]): void => emit('debug', a),
  info:  (...a: unknown[]): void => emit('info',  a),
  warn:  (...a: unknown[]): void => emit('warn',  a),
  error: (...a: unknown[]): void => emit('error', a),
};

process.on('exit', () => {
  if (fileFd && fileFd !== -1) {
    try { closeSync(fileFd); } catch { /* ignore */ }
  }
});
