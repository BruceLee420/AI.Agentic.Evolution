#!/usr/bin/env node
/**
 * Early-adopter price ladder.
 *
 *   node pricing.mjs [base] [tierSize] [increasePct] [--tiers N]
 *   node pricing.mjs 300 12 12 --tiers 10
 *
 * Same math as workers/api/src/index.ts ladder() — change one, change both.
 */
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = Number(args[0] ?? 300);
const tierSize = Number(args[1] ?? 12);
const pct = Number(args[2] ?? 12);
const i = process.argv.indexOf('--tiers');
const tiers = i > -1 ? Number(process.argv[i + 1]) : 10;

export const priceAt = (sold) =>
  Math.round(base * (1 + pct / 100) ** Math.floor(sold / tierSize) * 100) / 100;

let cumulative = 0;
console.log(`Base $${base} · +${pct}% every ${tierSize} sold\n`);
console.log('Tier | Units      | Price     | Tier rev   | Cumulative');
console.log('-----|------------|-----------|------------|-----------');
for (let t = 0; t < tiers; t++) {
  const price = priceAt(t * tierSize);
  const rev = price * tierSize;
  cumulative += rev;
  const units = `${t * tierSize + 1}–${(t + 1) * tierSize}`;
  console.log(
    `${String(t + 1).padStart(4)} | ${units.padEnd(10)} | $${price.toFixed(2).padStart(8)} | $${rev.toFixed(0).padStart(9)} | $${cumulative.toFixed(0)}`
  );
}
