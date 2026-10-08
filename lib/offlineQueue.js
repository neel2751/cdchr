/**
 * Clock actions taken with no signal.
 *
 * Construction sites are dead zones. Someone taps a tag at 7am in a cutting
 * with no bars, the request never leaves the phone, and the choice is between
 * losing the clock-in and keeping it somewhere until the signal comes back.
 *
 * ONLY TAG TAPS ARE QUEUEABLE. A reception QR code lives thirty seconds by
 * design, so a queued scan would be worthless by the time it replayed — and an
 * NTAG 424 DNA tap does not have that problem: the chip signs and counts
 * offline exactly as it does on, so a queued tap is still cryptographically
 * verified when it finally arrives.
 *
 * IndexedDB rather than localStorage: the queue must survive the tab being
 * closed and the phone being locked in a pocket for an hour, and localStorage
 * is synchronous on the main thread.
 *
 * Replayed in the foreground — on load and when the connection returns —
 * rather than through Background Sync. Background Sync is Chrome-on-Android
 * only, and a clock-in that works on half the workforce's phones is worse than
 * one that works slowly on all of them.
 */

const DB_NAME = "cdchr-clock";
const STORE = "pending";
const DB_VERSION = 1;

/** How long a queued tap stays worth sending. Mirrors the server's window. */
export const MAX_OFFLINE_AGE_HOURS = 24;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("No IndexedDB here"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Keep a tap for later.
 *
 * `capturedAt` is the phone's own clock. The server treats it as a claim
 * rather than a fact — see server/clockServer/offlineSync.js — and every
 * record made from one is flagged for a human to confirm.
 */
export async function queueTap(entry) {
  try {
    const db = await openDb();
    await tx(db, "readwrite", (store) =>
      store.add({
        ...entry,
        capturedAt: new Date().toISOString(),
        // Tie-break for taps queued inside the same second, so they replay in
        // the order they happened rather than whatever order the store yields.
        queuedSeq: Date.now(),
      }),
    );
    db.close();
    return true;
  } catch (error) {
    console.log("Could not queue that tap:", error?.message);
    return false;
  }
}

/** Everything waiting, oldest first. */
export async function listQueued() {
  try {
    const db = await openDb();
    const all = await tx(db, "readonly", (store) => store.getAll());
    db.close();
    return (all || []).sort(
      (a, b) =>
        new Date(a.capturedAt) - new Date(b.capturedAt) ||
        a.queuedSeq - b.queuedSeq,
    );
  } catch {
    return [];
  }
}

export async function removeQueued(ids) {
  try {
    const db = await openDb();
    await tx(db, "readwrite", (store) => {
      for (const id of ids) store.delete(id);
    });
    db.close();
  } catch (error) {
    console.log("Could not clear queued taps:", error?.message);
  }
}

/** Drop anything too old to be worth sending, and say how many went. */
export async function pruneExpired() {
  const cutoff = Date.now() - MAX_OFFLINE_AGE_HOURS * 60 * 60 * 1000;
  const all = await listQueued();
  const stale = all.filter((e) => new Date(e.capturedAt).getTime() < cutoff);
  if (stale.length) await removeQueued(stale.map((e) => e.id));
  return stale.length;
}

/**
 * Send everything waiting.
 *
 * @param send an async function taking the queued entries and returning
 *             `{ results: [{ index, success, message }] }`
 *
 * Entries are removed when the server has *decided* about them — accepted or
 * refused. A refusal is a decision: retrying a tap the server has already said
 * no to would queue it forever. Only a failure to reach the server at all
 * leaves the queue untouched.
 */
export async function flushQueue(send) {
  const pruned = await pruneExpired();
  const pending = await listQueued();
  if (!pending.length) return { sent: 0, pruned, results: [] };

  let response;
  try {
    response = await send(
      pending.map(({ id, queuedSeq, ...entry }) => entry),
    );
  } catch {
    // Still offline, or the server is down. Keep everything.
    return { sent: 0, pruned, offline: true, results: [] };
  }

  if (!response?.success) {
    return { sent: 0, pruned, offline: true, results: [] };
  }

  const results = response.results || [];
  const decided = pending.filter((_, i) => results[i]);
  if (decided.length) await removeQueued(decided.map((e) => e.id));

  return { sent: decided.length, pruned, results };
}

/** How many taps are waiting — for a line of text on the screen. */
export async function queuedCount() {
  return (await listQueued()).length;
}
