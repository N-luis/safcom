/**
 * The "How complete is the information" bar - it moves with each answer, never
 * says more than the server's reading, and animates. Run with:  npm run test:completenessbar
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import CompletenessBar, { questionProgress, blockFills } from '../components/forms/CompletenessBar';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

console.log('\nIt moves with the questions');
const steps = [0, 1, 2, 3, 4].map(n => questionProgress(n, 1, true));
ok('each answer moves it forward', steps.every((p, i) => i === 0 || p > steps[i - 1]), steps.map(p => p.toFixed(2)).join(' '));
ok('it is never full while questions remain', steps.every(p => p < 1) && questionProgress(10, 2, false) < 1);
ok('full once nothing is left to ask', questionProgress(3, 0, false) === 1 && questionProgress(0, 0, false) === 1);
ok('while the next reading loads it still counts the answer just sent', questionProgress(3, 0, true) > questionProgress(2, 1, false) && questionProgress(3, 0, true) < 1);

console.log('\nIt never says more than the reading');
const low = blockFills('INSUFFICIENT', 0.5);
ok('"not enough yet": only the first block fills, by the questions', low[0] > 0.15 && low[0] < 1 && low[1] === 0 && low[2] === 0, low.join());
ok('before any answer the first block still shows', blockFills('INSUFFICIENT', 0)[0] === 0.15);
ok('"not enough yet" with nothing left to ask: the first block full, nothing more', blockFills('INSUFFICIENT', 1).join() === '1,0,0');
const mid = blockFills('PARTIAL', 0.4);
ok('"partial": the first block full, the second filling', mid[0] === 1 && mid[1] > 0.15 && mid[1] < 1 && mid[2] === 0, mid.join());
ok('"enough": all three full, whatever the questions', blockFills('SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT', 0).join() === '1,1,1');

console.log('\nOn screen');
const html = renderToStaticMarkup(<CompletenessBar level="PARTIAL" progress={0.5} loading label="Gaano kakumpleto ang impormasyon: Bahagya" />);
ok('a progressbar a screen reader can read, with the level in words', html.includes('role="progressbar"') && html.includes('aria-valuetext="Gaano kakumpleto ang impormasyon: Bahagya"')
  && /aria-valuenow="\d+"/.test(html) && html.includes('aria-busy="true"'));
ok('the fills are drawn as widths', /data-fills="1.00,0.5[78],0.00"/.test(html), html.match(/data-fills="[^"]*"/)?.[0]);
const src = fs.readFileSync('components/forms/CompletenessBar.tsx', 'utf8');
ok('width and colour animate; a shimmer while the next reading loads; both off for reduced motion', /transition: 'width 600ms/.test(src) && /background-color 400ms/.test(src)
  && src.includes('animation: `${shimmer}') && (src.match(/prefers-reduced-motion: reduce/g) ?? []).length === 2);
const assistant = fs.readFileSync('components/forms/IntakeAssistant.tsx', 'utf8');
ok('the assistant uses it, fed by the answers and the questions left', assistant.includes('<CompletenessBar level={result.informationCompleteness} progress={progress} loading={loading}')
  && assistant.includes('const answered = aiMode ? turns.length : answers.length;'));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
