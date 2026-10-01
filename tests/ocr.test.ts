/**
 * The document reader, against two real images.
 *
 * The clear one guards accuracy. The blurry one guards the thing that matters
 * more: that an unsure reading is marked [?] rather than passed on as fact.
 *
 * It also pins the `blocks: true` option. Without it Tesseract returns the text
 * with no per-word confidence, every read scores zero, and the evidence guard
 * then withholds risk factors from perfectly good scans - a silent failure a
 * version bump could reintroduce.
 *
 * Run with:  npm run test:ocr
 */
import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';

const WORD_FLOOR = 65, HIGH = 82, MEDIUM = 62;
type W = { text: string; confidence: number };

function collect(data: unknown): W[] {
  const d = data as { words?: W[]; blocks?: { paragraphs?: { lines?: { words?: W[] }[] }[] }[] };
  if (Array.isArray(d?.words) && d.words.length) return d.words;
  const out: W[] = [];
  for (const b of d?.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) out.push(w);
  return out;
}

const fixture = (n: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', n));

let pass = 0; const fails: string[] = [];
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

async function read(file: string) {
  const worker = await createWorker(['eng', 'fil'], 1);
  try {
    const { data } = await worker.recognize(fixture(file), {}, { blocks: true, text: true });
    const words = collect(data).filter(w => (w.text ?? '').trim());
    const mean = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
    return {
      text: (data.text ?? '').replace(/\s+/g, ' ').trim(),
      words,
      mean,
      band: mean >= HIGH ? 'high' : mean >= MEDIUM ? 'medium' : 'low',
      unclear: words.filter(w => w.confidence < WORD_FLOOR).map(w => w.text.trim()),
    };
  } finally {
    await worker.terminate();
  }
}

async function main() {
  console.log('1. a clear barangay document');
  const clear = await read('blotter-entry.png');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  const expected = 'barangay binang blotter entry petsa oktubre reklamo tungkol sa ingay tuwing gabi walang nasaktan sa pangyayari'.split(' ');
  const got = norm(clear.text);
  const hits = expected.filter(w => got.includes(w));

  // The regression this file exists for.
  ok('per-word confidence is returned (blocks: true)', clear.words.length > 0, `${clear.words.length} words`);
  ok('at least 85% of the words are recovered', hits.length / expected.length >= 0.85, `${hits.length}/${expected.length}`);
  ok('Tagalog is read, not just English', got.includes('tungkol') && got.includes('walang'));
  ok('a clear scan is high confidence', clear.band === 'high', `${clear.mean.toFixed(1)} -> ${clear.band}`);
  ok('a clear scan has few unclear words', clear.unclear.length <= 2, clear.unclear.join(','));

  console.log('\n2. a degraded photo');
  const blurry = await read('blotter-blurry.png');
  ok('not reported as high confidence', blurry.band !== 'high', `${blurry.mean.toFixed(1)} -> ${blurry.band}`);
  ok('unsure words are flagged', blurry.unclear.length > 0, `${blurry.unclear.length} flagged`);

  console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
  process.exit(fails.length === 0 ? 0 : 1);
}
main();
