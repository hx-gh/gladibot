// Mini evaluator do catálogo `data/formulas.json`. Lê uma vez na inicialização
// e expõe `evalFormula(id, vars)` + helpers pra fórmulas usadas em mais de um
// lugar. Avaliação via `new Function(...inputs, "return (expression)")` — OK
// porque a fonte é o JSON versionado (não input do usuário).
//
// Task #9 do roadmap: adicione mais helpers conforme aplicar valores derivados
// na UI (DPS estimado, EHP, hit chance, regen real, caps).

import fs from 'node:fs';
import path from 'node:path';

const formulasPath = path.resolve('data/formulas.json');
const json = JSON.parse(fs.readFileSync(formulasPath, 'utf8'));
const byId = new Map(json.formulas.map((f) => [f.id, f]));

const cache = new Map(); // id → compiled fn

function compile(id) {
  const f = byId.get(id);
  if (!f) throw new Error(`formula ${id} not found in data/formulas.json`);
  if (!f.expression) throw new Error(`formula ${id} has no scalar expression (branches not supported here)`);
  const inputs = f.inputs || [];
  const fn = new Function(...inputs, `"use strict"; return (${f.expression});`);
  cache.set(id, { fn, inputs });
  return cache.get(id);
}

export function evalFormula(id, vars = {}) {
  const compiled = cache.get(id) || compile(id);
  const args = compiled.inputs.map((k) => vars[k]);
  return compiled.fn(...args);
}

export function auctionLevelRange(playerLevel) {
  if (!Number.isFinite(playerLevel) || playerLevel < 1) {
    return { min: null, max: null, playerLevel: null };
  }
  return {
    playerLevel,
    min: evalFormula('auction-min-level', { playerLevel }),
    max: evalFormula('auction-max-level', { playerLevel }),
  };
}
