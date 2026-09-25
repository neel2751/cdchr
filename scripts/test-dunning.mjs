/**
 * The chasing ladder.
 *
 * Pure, and the tests are mostly about restraint rather than delivery. The
 * failure that matters here is not a missed reminder — it is thirty identical
 * emails to a good customer who is a fortnight late, and the relationship that
 * breaks is not fixed by a patch afterwards.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-dunning.mjs
 */
import assert from "node:assert";

import {
  DUNNING_STAGES,
  FINAL_STAGE,
  chaseability,
  daysPastDue,
  dueReminder,
  dunningSummary,
  findStage,
} from "@/lib/dunning";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 25, 9, 0, 0);

/** An issued, unpaid, chaseable invoice due `daysAgo` days ago. */
const invoice = (daysAgo, extra = {}) => ({
  kind: "invoice",
  status: "issued",
  number: "INV-2026-0001",
  grossPence: 12000,
  payments: [],
  dueAt: new Date(NOW - daysAgo * DAY),
  buyer: { name: "Acme", email: "accounts@acme.example" },
  reminders: [],
  ...extra,
});

/* ------------------------------------------------------------- the ladder */

check("the ladder is ordered and ends", () => {
  const offsets = DUNNING_STAGES.map((s) => s.offsetDays);
  assert.deepEqual(
    offsets,
    [...offsets].sort((a, b) => a - b),
    "stages are out of order",
  );
  assert.equal(DUNNING_STAGES.at(-1).key, FINAL_STAGE);
  assert.ok(findStage(FINAL_STAGE));
  assert.equal(findStage("nonsense"), null);
});

check("days past due counts the right way round", () => {
  assert.equal(daysPastDue(new Date(NOW - 7 * DAY), NOW), 7);
  assert.equal(daysPastDue(new Date(NOW + 3 * DAY), NOW), -3);
  assert.equal(daysPastDue(null, NOW), null);
  assert.equal(daysPastDue("rubbish", NOW), null);
});

check("a courtesy note goes out before anything is late", () => {
  // The stage that prevents most chasing: plenty of overdue invoices are
  // simply forgotten rather than disputed.
  const due = dueReminder(invoice(-3), NOW);
  assert.equal(due?.key, "due-soon");
});

check("nothing goes out earlier than the first stage", () => {
  assert.equal(dueReminder(invoice(-10), NOW), null);
});

check("the ladder climbs as it ages", () => {
  const expect = [
    [0, "due"],
    [7, "overdue-7"],
    [14, "overdue-14"],
    [30, "final"],
  ];
  for (const [age, key] of expect) {
    assert.equal(dueReminder(invoice(age), NOW)?.key, key, `at ${age} days`);
  }
});

/* ---------------------------------------------------------- the restraint */

check("ONE EMAIL PER STAGE, NOT ONE PER RUN", () => {
  // The whole point. A daily job against an invoice that stays overdue must
  // send once and then be quiet.
  const sent = invoice(7, { reminders: [{ stage: "overdue-7" }] });
  assert.equal(dueReminder(sent, NOW), null, "it would have sent again");

  // And the day after, and the day after that.
  for (const age of [8, 9, 10, 11, 12, 13]) {
    const still = invoice(age, { reminders: [{ stage: "overdue-7" }] });
    assert.equal(dueReminder(still, NOW), null, `sent again at ${age} days`);
  }
});

check("THE LADDER STOPS AFTER THE FINAL REMINDER", () => {
  // Software that keeps emailing for ever is software somebody blocks.
  const done = invoice(365, { reminders: [{ stage: FINAL_STAGE }] });
  assert.equal(dueReminder(done, NOW), null);
  assert.match(dunningSummary(done, NOW).message, /nothing further/i);
});

check("A NEGLECTED INVOICE GETS ONE REMINDER, NOT FIVE", () => {
  // The job was off for a month, or the address was wrong. Sending the whole
  // ladder in one morning is the worst possible catch-up.
  const neglected = invoice(45);
  const due = dueReminder(neglected, NOW);
  assert.equal(due.key, "final", "it did not jump to the latest stage");

  // And after that one goes, nothing else is owed.
  neglected.reminders = [{ stage: "final" }];
  assert.equal(dueReminder(neglected, NOW), null);
});

check("a skipped stage is not sent retrospectively", () => {
  // Somebody chased manually at two weeks; the seven-day note is moot now.
  const chased = invoice(20, { reminders: [{ stage: "overdue-14" }] });
  assert.equal(dueReminder(chased, NOW), null);
});

/* -------------------------------------------------- what is never chased */

check("nothing that is not owed is ever chased", () => {
  const cases = [
    [invoice(30, { status: "paid" }), /settled/],
    [invoice(30, { status: "void" }), /void/],
    [invoice(30, { status: "draft" }), /not issued/],
    [invoice(30, { kind: "credit-note" }), /credit note/],
    [invoice(30, { dueAt: null }), /due date/],
    [invoice(30, { buyer: { name: "Acme" } }), /billing email/],
  ];
  for (const [inv, pattern] of cases) {
    const out = chaseability(inv);
    assert.equal(out.chaseable, false, JSON.stringify(inv.status ?? inv.kind));
    assert.match(out.reason, pattern);
    assert.equal(dueReminder(inv, NOW), null);
  }
});

check("a part-paid invoice IS still chased", () => {
  // Money owed is money owed. Only "paid" stops it.
  const partly = invoice(7, {
    status: "part-paid",
    payments: [{ amountPence: 5000 }],
  });
  assert.equal(chaseability(partly).chaseable, true);
  assert.equal(dueReminder(partly, NOW)?.key, "overdue-7");
});

check("the per-invoice stop switch is obeyed, with its reason", () => {
  // A payment plan, a dispute, an account somebody is handling by phone.
  const held = invoice(30, {
    chaseDisabled: true,
    chaseDisabledReason: "on a payment plan",
  });
  const out = chaseability(held);
  assert.equal(out.chaseable, false);
  assert.match(out.reason, /payment plan/);
  assert.equal(dueReminder(held, NOW), null);
});

check("a missing email is reported, not silently skipped", () => {
  // An invoice nobody can be reminded about is a thing to fix.
  const summary = dunningSummary(invoice(30, { buyer: { name: "Acme" } }), NOW);
  assert.equal(summary.chaseable, false);
  assert.match(summary.reason, /billing email/);
});

/* ------------------------------------------------------------- the summary */

check("the summary says what happens next", () => {
  const soon = dunningSummary(invoice(-5), NOW);
  assert.equal(soon.chaseable, true);
  assert.match(soon.message, /in 2 day/);

  const now = dunningSummary(invoice(0), NOW);
  assert.equal(now.due, "due");
  assert.match(now.message, /next run/i);
});

check("the summary lists what has already gone", () => {
  const some = invoice(20, {
    reminders: [{ stage: "due-soon" }, { stage: "due" }],
  });
  const summary = dunningSummary(some, NOW);
  assert.deepEqual(summary.sent, ["due-soon", "due"]);
  assert.equal(summary.daysPastDue, 20);
});

check("nothing throws on a half-built invoice", () => {
  for (const bad of [null, undefined, {}, { kind: "invoice" }]) {
    assert.equal(chaseability(bad).chaseable, false);
    assert.equal(dueReminder(bad, NOW), null);
    assert.ok(dunningSummary(bad, NOW));
  }
});

const failed = results.filter(([s]) => s !== "pass");
for (const [status, name] of results) {
  if (status !== "pass") console.log(`  ${status}  ${name}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} FAILED` : ""),
);
process.exitCode = failed.length ? 1 : 0;
