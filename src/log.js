import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? 20;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const tag = `[${ts()}] ${level.toUpperCase().padEnd(5)}`;
  console.log(tag, ...args);
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
};
