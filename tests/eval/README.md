# Classification evaluation

A fixed set of reports with reviewed expected outcomes, run through the same
pipeline the resident filing route uses, so changes to the rules, the Groq
prompts or the matrix retrieval can be measured instead of guessed at.

This is **evaluation, not training**. Nothing here changes the model. SafeComm
uses Groq's hosted model as it is; improvements are made to the prompts, the
retrieval, the checks and the rules, and then measured again here.

## Files

| File | What it is |
|---|---|
| `classificationDataset.json` | The cases: narrative, who it is for, optional answers, and the expected desk, case type, level, urgency and whether clarification is needed, each with the matrix wording it rests on (`basis`). |
| `metrics.ts` | Confusion matrices, per-class precision / recall / F1, level agreement. Tested in `tests/aiStaged.test.ts`. |
| `results/` | One `.md` and one `.json` per run, timestamped. Kept, so runs can be compared. |
| `../../scripts/eval-classification.ts` | The runner. |
| `../../scripts/review-outcomes.ts` | Counts of preliminary readings vs. officials' decisions in the live database - no narratives. |

## Running

```bash
npm run eval:classification -- --mode rules        # the rules alone; no AI, no cost
npm run eval:classification -- --mode ai           # live Groq; uses the day's free quota
npm run eval:classification -- --mode ai-down      # Groq unreachable (failure path)
npm run eval:classification -- --mode ai-invalid   # Groq answers out of shape
npm run eval:classification -- --mode ai --tags long --label after-fix
```

A live run costs about 4,500-6,500 tokens per short or medium case and more
for a long one read in stages; Groq's free plan allows about 200,000 a day. The
runner stops calling Groq before the day's budget is gone (`--reserve`, default
20,000 tokens) and reports the remaining cases as skipped rather than scoring
them as failures. It waits between cases to stay under the per-minute cap, so a
full run takes about 40 minutes.

## How the labels were set - and what they are not

Every expected label was **proposed by the developer** from the two imported
matrices (`knowledge/sources/`) and SafeComm's documented readings
(`knowledge/MATRIX_REVIEW.md`). They have **not yet been confirmed by qualified
barangay or VAWC desk reviewers**. Until they are, a result measures agreement
with these proposed labels, not accuracy. To review them:

1. For each case, read the narrative and the `basis`, and confirm or correct
   `desk`, `caseTypes`, `level` and `urgent`.
2. Record who reviewed the set and when in the file's `reviewStatus`.
3. Run `--mode rules` and `--mode ai` again; results from before the review are
   against the old labels.

The rules for each field are in the dataset's `labelRules`. In short: the
level is the matrix's level for the expected desk, or `null` when the matrix
cannot be applied yet or has no criterion for it; `acceptableDesks` and
`acceptableLevels` record outcomes a reviewer would also accept, and the
report shows both the strict and the lenient score.

## Adding cases

Use **fictional or properly de-identified** narratives only. Do not copy a
resident's report into this file - not even with the name changed - without
authorisation, privacy safeguards and the barangay's data-governance approval.
`scripts/review-outcomes.ts` shows where officials most often change
SafeComm's reading (counts only); write a fictional case that reproduces the
pattern instead of using the real report.

Good additions: reports where an official changed the category or level;
Tagalog/Taglish phrasing the rules do not know; long reports with the decisive
detail late; reports that should be asked about rather than classified.

## What the numbers do and do not show

- 38 cases is enough to find recurring errors, not to estimate accuracy with
  any precision: one case is about 2.6 percentage points. Confidence intervals
  would be wide; none are claimed.
- Groq's output varies slightly between runs even at temperature 0, so a live
  run can differ by a case or two from the previous one with no code change.
- No confidence percentage is produced anywhere in SafeComm. Category
  confidence is qualitative (high / medium / low) and is not calibrated.
