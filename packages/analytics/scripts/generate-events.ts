/**
 * Generates the typed event catalogue from 11_Analytics_Event_Taxonomy.csv.
 *
 * The CSV is the delivered contract (AN-01-01: "metric definitions match event taxonomy"), so
 * it stays the source of truth and the TypeScript is derived from it. CI regenerates and fails
 * on any diff, which is what stops the code and the contract drifting apart.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(here, '../../../docs/spec/11_Analytics_Event_Taxonomy.csv');
const OUT_PATH = resolve(here, '../src/events.generated.ts');

interface EventSpec {
  name: string;
  actor: string;
  trigger: string;
  required: string[];
  optional: string[];
}

function splitProps(cell: string): string[] {
  return cell
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function parseCsv(raw: string): EventSpec[] {
  const lines = raw.trim().split(/\r?\n/);
  const rows = lines.slice(1);

  return rows.map((line) => {
    const cells = line.split(',');
    if (cells.length < 4) {
      throw new Error(`Malformed taxonomy row: ${line}`);
    }
    return {
      name: cells[0]!.trim(),
      actor: cells[1]!.trim(),
      trigger: cells[2]!.trim(),
      required: splitProps(cells[3] ?? ''),
      optional: splitProps(cells[4] ?? ''),
    };
  });
}

function quoteUnion(values: string[]): string {
  return values.length === 0 ? 'never' : values.map((v) => `'${v}'`).join(' | ');
}

function render(events: EventSpec[]): string {
  const lines: string[] = [];

  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Source: 11_Analytics_Event_Taxonomy.csv');
  lines.push('// Regenerate: pnpm --filter @ai-review/analytics generate');
  lines.push('');
  lines.push('export const EVENT_NAMES = [');
  for (const e of events) lines.push(`  '${e.name}',`);
  lines.push('] as const;');
  lines.push('');
  lines.push('export type EventName = (typeof EVENT_NAMES)[number];');
  lines.push('');
  lines.push('export interface EventSpec {');
  lines.push('  readonly actor: string;');
  lines.push('  readonly trigger: string;');
  lines.push('  readonly required: readonly string[];');
  lines.push('  readonly optional: readonly string[];');
  lines.push('}');
  lines.push('');
  lines.push('export const EVENT_SPECS = {');
  for (const e of events) {
    lines.push(`  '${e.name}': {`);
    lines.push(`    actor: '${e.actor}',`);
    lines.push(`    trigger: ${JSON.stringify(e.trigger)},`);
    lines.push(`    required: [${e.required.map((p) => `'${p}'`).join(', ')}],`);
    lines.push(`    optional: [${e.optional.map((p) => `'${p}'`).join(', ')}],`);
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<EventName, EventSpec>;');
  lines.push('');
  lines.push('/** Property keys each event requires, as a literal union per event. */');
  lines.push('export interface EventRequiredProps {');
  for (const e of events) {
    lines.push(`  '${e.name}': ${quoteUnion(e.required)};`);
  }
  lines.push('}');
  lines.push('');
  lines.push('/** Property keys each event may additionally carry. */');
  lines.push('export interface EventOptionalProps {');
  for (const e of events) {
    lines.push(`  '${e.name}': ${quoteUnion(e.optional)};`);
  }
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

const specs = parseCsv(readFileSync(CSV_PATH, 'utf8'));
writeFileSync(OUT_PATH, render(specs), 'utf8');
console.warn(`Generated ${specs.length} events -> ${OUT_PATH}`);
