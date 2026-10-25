# Risk matrix: items for the matrix owners to clarify

SafeComm applies the two imported risk matrices (`knowledge/sources/`) word for
word. Where a criterion leaves room for interpretation, SafeComm does **not**
rewrite it: it applies the narrowest reading the document itself supports,
leaves the rest undetermined for an officer, and records the question here.
The encoded conditions are in `lib/riskMatrices.ts`.

The VAWC scale is a *proposed operational risk-stratification framework*. It is
not an official five-level classification prescribed by Philippine law, the
DILG, PCW, PNP or DSWD, and none of these readings is a legal determination.

---

## 1. VAWC Level 4 — "Physical assault" (open)

**What the document says.** Level 4 is headed **"CRITICAL – Violence
Occurring / Imminent"**. Its indicators are: *Physical assault;
strangulation/choking; weapon displayed; forced confinement; severe beating;
sexual assault; active pursuit of a victim; credible imminent threat to kill.*
Its Suggested Action begins *"Treat as an emergency."* "Physical assault" is
not qualified by severity anywhere in the document.

**What went wrong.** SafeComm used to encode "Physical assault" as *any
physical force, at any time*. The force terms include *tinulak* (pushed), so
"Tinulak ako ng asawa ko." (one push, timing unknown) was Level 4 and queued
as Critical. A separate legacy rule (H3, "harm within a household → at least
High") would have set High on the relationship alone.

**How SafeComm reads it now.**
- "Physical assault" meets Level 4 when the violence is **occurring or
  imminent** — what the level's own heading says (`force` + `imminent`).
- When force is reported but the report does not say it is still happening,
  the level is **left undetermined**, the case is marked for officer review,
  and the resident is asked *"Kailan ito nangyari? Nangyayari pa ba ito
  ngayon?"* along with the other relevant questions.
- When the report says it has **ended**, the level stays undetermined and an
  officer decides: the document does not say how an ended assault is
  classified.
- The relationship (spouse, partner, family) never sets a level by itself.

**Questions for the matrix owners.**
1. How should a physical assault that **has ended** be classified — Level 3
   ("escalating intimate-partner violence" requires repetition), Level 4, or
   another level?
2. Does "Physical assault" at Level 4 cover **any** physical contact (a push, a
   slap), or only assault of some severity? The Blotter matrix distinguishes
   *"minor physical altercations without severe injury"* (Level 3) from
   *"serious physical assault"* (Level 4); the VAWC matrix does not.
3. Does the heading *"Violence Occurring / Imminent"* apply to **every** Level 4
   indicator (e.g. a past strangulation)? SafeComm currently applies it only
   to "Physical assault", the one indicator with no severity of its own;
   strangulation, severe beating and the others are applied as written.

Until these are answered and the document is revised, the readings above
stand, and every affected case says so to the officer handling it.

## 2. "Isolated" indicators (resolved in code)

*"isolated rude behavior"* (VAWC L1) and *"isolated pet nuisances"* (Blotter L1)
are now met only when the report says it happened once — not when nothing is
said about repetition. An unknown history is not an isolated incident.
