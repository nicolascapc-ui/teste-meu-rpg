import type { RollOutcome, SheetBlock } from '../types/vtt';

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface DiceEvaluation {
  formula: string;
  resolvedFormula: string;
  total: number;
  summary: string;
  breakdown: string;
  outcome: RollOutcome;
}

function normalizeKey(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function resolveSheetFormula(formula: string, blocks: SheetBlock[] = []): string {
  if (!formula.includes('{')) return formula.trim();

  const lookup = new Map<string, number>();
  for (const b of blocks) {
    const key = normalizeKey(b.label);
    if (b.type === 'attribute' && typeof b.value === 'number') {
      lookup.set(key, b.value);
    } else if (b.type === 'bar' && typeof b.current === 'number') {
      lookup.set(key, b.current);
    } else if (b.type === 'counter' && typeof b.count === 'number') {
      lookup.set(key, b.count);
    }
  }

  return formula
    .replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
      const val = lookup.get(normalizeKey(rawName));
      return typeof val === 'number' ? String(val) : '0';
    })
    .replace(/\+\s*-/g, '- ')
    .replace(/-\s*-/g, '+ ')
    .trim();
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function rollDiceGroup(
  count: number,
  sides: number,
  options: { explode?: boolean; keepHighest?: number; keepLowest?: number } = {}
): { all: number[]; kept: number[]; exploded: number[] } {
  const safeCount = Math.min(Math.max(count, 1), 100);
  const safeSides = Math.min(Math.max(sides, 2), 1000);
  const all: number[] = [];
  const exploded: number[] = [];

  for (let i = 0; i < safeCount; i++) {
    let val = rollDie(safeSides);
    all.push(val);
    if (options.explode && safeSides > 1) {
      let guard = 0;
      while (val === safeSides && guard < 20) {
        val = rollDie(safeSides);
        all.push(val);
        exploded.push(val);
        guard++;
      }
    }
  }

  let kept = [...all];
  if (typeof options.keepHighest === 'number' && options.keepHighest > 0 && options.keepHighest < all.length) {
    kept = [...all].sort((a, b) => b - a).slice(0, options.keepHighest);
  } else if (typeof options.keepLowest === 'number' && options.keepLowest > 0 && options.keepLowest < all.length) {
    kept = [...all].sort((a, b) => a - b).slice(0, options.keepLowest);
  }

  return { all, kept, exploded };
}

export function isDiceFormula(input: string): boolean {
  const clean = input.trim().toLowerCase();
  if (clean.startsWith('/r ') || clean.startsWith('/roll ')) return true;
  return /^-?\d*d\d+/i.test(clean);
}

export function evaluateDiceFormula(
  rawInput: string,
  options: {
    blocks?: SheetBlock[];
    mode?: RollMode;
    forceExplode?: boolean;
  } = {}
): DiceEvaluation {
  const trimmed = rawInput.trim().replace(/^\/(roll|r)\s+/i, '');
  const resolved = resolveSheetFormula(trimmed, options.blocks || []);
  const compact = resolved.replace(/\s+/g, '');

  // 1. Target d100 comparison: e.g. 1d100<=65 or d100<=40
  const d100Match = compact.match(/^(\d*)d100(<=|<)(\d+)$/i);
  if (d100Match) {
    const target = Number(d100Match[3]);
    const strictLess = d100Match[2] === '<';
    let roll = rollDie(100);
    let modeNote = '';

    if (options.mode === 'advantage' || options.mode === 'disadvantage') {
      const alt = rollDie(100);
      const chosen = options.mode === 'advantage' ? Math.min(roll, alt) : Math.max(roll, alt);
      modeNote = `${options.mode === 'advantage' ? 'Vantagem' : 'Desvantagem'} [${roll}, ${alt}] -> `;
      roll = chosen;
    }

    const passed = strictLess ? roll < target : roll <= target;
    let outcome: RollOutcome = passed ? 'success' : 'failure';
    let label = passed ? 'Sucesso' : 'Falha';

    if (roll === 1) {
      outcome = 'crit';
      label = 'Sucesso Crítico (01)';
    } else if (roll === 100 || (target < 50 && roll >= 96)) {
      outcome = 'fumble';
      label = 'Desastre';
    } else if (passed && roll <= Math.max(1, Math.floor(target / 5))) {
      outcome = 'crit';
      label = 'Sucesso Extremo';
    } else if (passed && roll <= Math.max(1, Math.floor(target / 2))) {
      outcome = 'success';
      label = 'Sucesso Bom';
    }

    return {
      formula: trimmed,
      resolvedFormula: resolved,
      total: roll,
      summary: `${roll} / alvo ${target} · ${label}`,
      breakdown: `${modeNote}d100 = [${roll}] vs <= ${target}`,
      outcome,
    };
  }

  // 2. Dice Pool (Vampire / Storyteller / Shadowrun): e.g. 6d10>=6 or 5d10!>=8
  const poolMatch = compact.match(/^(-?\d+)d(\d+)(!?)(>=|>)(\d+)$/i);
  if (poolMatch) {
    const rawCount = Number(poolMatch[1]);
    const count = Math.max(1, rawCount);
    const sides = Number(poolMatch[2]);
    const explode = Boolean(poolMatch[3]) || Boolean(options.forceExplode);
    const op = poolMatch[4];
    const threshold = Number(poolMatch[5]);

    const { all, exploded } = rollDiceGroup(count, sides, { explode });
    const successes = all.filter((v) => (op === '>=' ? v >= threshold : v > threshold)).length;
    const ones = all.filter((v) => v === 1).length;
    const crits = all.filter((v) => v === sides).length;

    let outcome: RollOutcome = successes > 0 ? 'success' : 'failure';
    let note = `${successes} sucesso${successes === 1 ? '' : 's'}`;

    if (successes === 0 && ones > 0) {
      outcome = 'fumble';
      note = `Falha Crítica (${ones}x "1")`;
    } else if (crits >= 2 && successes > 0) {
      outcome = 'crit';
      note = `${successes} sucessos · Crítico (${crits}x ${sides})`;
    }

    const explodeNote = exploded.length > 0 ? ` · ${exploded.length} explosões` : '';

    return {
      formula: trimmed,
      resolvedFormula: resolved,
      total: successes,
      summary: `${note}${explodeNote}`,
      breakdown: `[${all.join(', ')}] (alvo ${op}${threshold})`,
      outcome,
    };
  }

  // 3. Standard additive/subtractive dice expression (with !, khN, klN, advantage/disadvantage)
  // Handle 0d20kh1 (e.g. Ordem Paranormal attribute 0 -> roll 2d20kl1)
  let expr = compact.replace(/^0d20kh1/i, '2d20kl1');
  if (
    (options.mode === 'advantage' || options.mode === 'disadvantage') &&
    /^1?d20(?![a-z])/i.test(expr)
  ) {
    expr = expr.replace(/^1?d20/i, options.mode === 'advantage' ? '2d20kh1' : '2d20kl1');
  }

  const tokenRegex = /([+-]?)(\d*d\d+!?(?:k[hl]\d+)?|\d+)/gi;
  const parts: string[] = [];
  let total = 0;
  let outcome: RollOutcome = 'normal';
  let matchedAnything = false;

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(expr)) !== null) {
    matchedAnything = true;
    const sign = match[1] === '-' ? -1 : 1;
    const token = match[2];

    const dieMatch = token.match(/^(\d*)d(\d+)(!?)(?:k([hl])(\d+))?$/i);
    if (dieMatch) {
      const parsedCount = dieMatch[1] ? Number(dieMatch[1]) : 1;
      const count = Math.max(1, parsedCount);
      const sides = Number(dieMatch[2]);
      const explode = Boolean(dieMatch[3]) || Boolean(options.forceExplode);
      const keepDir = dieMatch[4]?.toLowerCase();
      const keepCount = dieMatch[5] ? Number(dieMatch[5]) : undefined;

      const { all, kept, exploded } = rollDiceGroup(count, sides, {
        explode,
        keepHighest: keepDir === 'h' ? keepCount : undefined,
        keepLowest: keepDir === 'l' ? keepCount : undefined,
      });

      const subtotal = kept.reduce((acc, v) => acc + v, 0);
      total += sign * subtotal;

      if (sides === 20 && kept.length === 1) {
        if (kept[0] === 20) outcome = 'crit';
        else if (kept[0] === 1) outcome = 'fumble';
      } else if (exploded.length > 0 && outcome === 'normal') {
        outcome = 'crit';
      }

      const prefix = parts.length === 0 ? (sign < 0 ? '-' : '') : sign < 0 ? ' - ' : ' + ';
      const keepTag = keepDir ? (keepDir === 'h' ? ' Maior' : ' Menor') : '';
      const expTag = exploded.length > 0 ? '!' : '';
      const detail =
        kept.length !== all.length
          ? `[${all.join(', ')} -> ${kept.join(', ')}]${keepTag}`
          : `[${all.join(', ')}]${expTag}`;
      parts.push(`${prefix}${detail}`);
    } else {
      const num = Number(token);
      if (!Number.isNaN(num)) {
        total += sign * num;
        const prefix = parts.length === 0 ? (sign < 0 ? '-' : '') : sign < 0 ? ' - ' : ' + ';
        parts.push(`${prefix}${num}`);
      }
    }
  }

  if (!matchedAnything) {
    return {
      formula: trimmed,
      resolvedFormula: trimmed,
      total: 0,
      summary: trimmed,
      breakdown: '',
      outcome: 'chat',
    };
  }

  const outcomeSuffix =
    outcome === 'crit' ? ' · Crítico' : outcome === 'fumble' ? ' · Desastre' : '';

  return {
    formula: trimmed,
    resolvedFormula: resolved,
    total,
    summary: `Total ${total}${outcomeSuffix}`,
    breakdown: parts.join(''),
    outcome,
  };
}
