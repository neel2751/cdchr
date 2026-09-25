/**
 * When to chase an unpaid invoice, and when to stop.
 *
 * Pure, so the ladder can be reasoned about without a mailbox. The job in
 * server/billingServer/dunningJob.js does the sending; everything about *which*
 * reminder is due lives here.
 *
 * Two rules shape the whole thing:
 *
 *   ONE EMAIL PER STAGE, EVER. Not one per run. A job that runs daily against
 *   an invoice that stays overdue must send once and then be quiet — otherwise
 *   the first genuinely late payer gets thirty identical emails and the
 *   customer relationship is the thing that breaks, not the software.
 *
 *   THE LADDER ENDS. After the final stage nothing more is sent automatically.
 *   A debt that is not paid after the last reminder needs a person, not
 *   another copy of the same message, and software that keeps emailing for
 *   ever is software somebody eventually blocks.
 */

/**
 * The ladder, in order. `offsetDays` is relative to the due date: negative is
 * before it.
 *
 * The first stage is a courtesy before anything is late at all, which is the
 * one that actually prevents most chasing — a good proportion of overdue
 * invoices are simply forgotten rather than disputed.
 */
export const DUNNING_STAGES = [
  {
    key: "due-soon",
    offsetDays: -3,
    label: "Due in a few days",
    tone: "courtesy",
  },
  { key: "due", offsetDays: 0, label: "Due today", tone: "courtesy" },
  { key: "overdue-7", offsetDays: 7, label: "A week overdue", tone: "chase" },
  {
    key: "overdue-14",
    offsetDays: 14,
    label: "Two weeks overdue",
    tone: "chase",
  },
  { key: "final", offsetDays: 30, label: "Final reminder", tone: "final" },
];

export const FINAL_STAGE = DUNNING_STAGES[DUNNING_STAGES.length - 1].key;

export function findStage(key) {
  return DUNNING_STAGES.find((s) => s.key === key) || null;
}

const DAY_MS = 86400000;

/** Whole days from `due` to `now`. Positive means overdue. */
export function daysPastDue(dueAt, now = Date.now()) {
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return null;
  return Math.floor((now - due) / DAY_MS);
}

/**
 * Can this invoice be chased at all?
 *
 * Deliberately a separate question from "is a reminder due". Something that
 * must never be chased should read as such whatever the calendar says, and the
 * reason is returned so a screen can explain the silence rather than leaving
 * somebody wondering why nothing is going out.
 */
export function chaseability(invoice) {
  if (!invoice) return { chaseable: false, reason: "no invoice" };
  if (invoice.kind === "credit-note") {
    return { chaseable: false, reason: "credit notes are not chased" };
  }
  if (invoice.status === "draft") {
    return { chaseable: false, reason: "not issued yet" };
  }
  if (invoice.status === "void") {
    return { chaseable: false, reason: "void" };
  }
  if (invoice.status === "paid") {
    return { chaseable: false, reason: "settled" };
  }
  if (invoice.chaseDisabled) {
    return {
      chaseable: false,
      reason: invoice.chaseDisabledReason || "chasing is switched off for this invoice",
    };
  }
  if (!invoice.dueAt) {
    return { chaseable: false, reason: "no due date" };
  }
  if (!invoice.buyer?.email) {
    // Said out loud rather than skipped silently. An invoice nobody can be
    // reminded about is a thing to fix, not a thing to ignore.
    return { chaseable: false, reason: "no billing email on the invoice" };
  }
  return { chaseable: true };
}

/**
 * Which reminder is due now, if any.
 *
 * Works out the stage this invoice's AGE calls for — the latest one whose day
 * has arrived — and returns it only if it has not been sent. It never falls
 * back to an earlier unsent stage, and that is the rule the whole feature
 * rests on.
 *
 * The obvious implementation is "the latest stage that is due AND unsent", and
 * it is wrong in a way that is invisible until it is live: an invoice a week
 * overdue whose seven-day note has gone would fall back to the "due today"
 * stage, send that, then the courtesy note the next day — working backwards
 * down the ladder, a different email every morning. That is the failure this
 * file exists to prevent, and it was caught by the test named after it.
 *
 * Choosing by age also handles the neglected case for free: an invoice
 * unchased for five weeks gets one final reminder, not five in a row catching
 * up through the ladder.
 *
 * @param invoice with `dueAt` and `reminders: [{ stage }]`
 */
export function dueReminder(invoice, now = Date.now()) {
  const allowed = chaseability(invoice);
  if (!allowed.chaseable) return null;

  const age = daysPastDue(invoice.dueAt, now);
  if (age === null) return null;

  // The stage this age calls for, whether or not it has already gone.
  let current = null;
  for (const stage of DUNNING_STAGES) {
    if (age >= stage.offsetDays) current = stage;
  }
  if (!current) return null;

  const sent = new Set((invoice.reminders || []).map((r) => r.stage));
  return sent.has(current.key) ? null : current;
}

/** Everything a screen needs to explain what will happen and when. */
export function dunningSummary(invoice, now = Date.now()) {
  const allowed = chaseability(invoice);
  const sent = (invoice?.reminders || []).map((r) => r.stage);
  const age = daysPastDue(invoice?.dueAt, now);

  if (!allowed.chaseable) {
    return { chaseable: false, reason: allowed.reason, sent, daysPastDue: age };
  }

  const next = dueReminder(invoice, now);
  if (next) {
    return {
      chaseable: true,
      sent,
      daysPastDue: age,
      due: next.key,
      message: `${next.label} — will send on the next run`,
    };
  }

  if (sent.includes(FINAL_STAGE) || age >= DUNNING_STAGES.at(-1).offsetDays) {
    return {
      chaseable: true,
      sent,
      daysPastDue: age,
      message: "Final reminder sent. Nothing further is automatic.",
    };
  }

  const upcoming = DUNNING_STAGES.find(
    (s) => !sent.includes(s.key) && age !== null && age < s.offsetDays,
  );
  return {
    chaseable: true,
    sent,
    daysPastDue: age,
    message: upcoming
      ? `Next: ${upcoming.label.toLowerCase()}, in ${upcoming.offsetDays - age} day(s)`
      : "Nothing due",
  };
}
