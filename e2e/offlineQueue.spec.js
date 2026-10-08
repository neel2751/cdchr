import { expect, test } from "@playwright/test";

import { ACCOUNTS, signIn } from "./helpers";

/**
 * The offline queue, in a real browser.
 *
 * scripts/test-offline-sync.mjs covers what the server does with a replayed
 * tap. This covers the half that cannot be tested in Node at all: IndexedDB
 * surviving a reload, and the queue draining when the connection returns.
 *
 * The last assertion is the one that matters — a queued tap must be cleared
 * once the server has *decided* about it, accepted or refused. Clearing only
 * on success means a tap the server has already said no to gets retried for
 * ever, on every page load, silently.
 */
test.describe("offline queue", () => {
  test("a queued tap survives a reload and drains when back online", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.acmeSuper);
    // Any page in the app — the queue is per-origin, not per-route.
    await page.goto("/admin/dashboard");

    // Put two taps in the queue the way a dead-signal tap does.
    const queued = await page.evaluate(async () => {
      // The app's module graph is not reachable from an evaluate(), so this
      // drives IndexedDB directly with the same shape lib/offlineQueue.js
      // writes. If that shape ever changes, this test should change with it.
      return await new Promise((resolve) => {
        const req = indexedDB.open("cdchr-clock", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("pending")) {
            db.createObjectStore("pending", { keyPath: "id", autoIncrement: true });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("pending", "readwrite");
          const store = tx.objectStore("pending");
          store.add({
            uid: "04AABBCCDDEE80",
            action: "clockIn",
            capturedAt: new Date(Date.now() - 30 * 60000).toISOString(),
            queuedSeq: Date.now(),
          });
          store.add({
            uid: "04AABBCCDDEE80",
            action: "breakIn",
            capturedAt: new Date(Date.now() - 20 * 60000).toISOString(),
            queuedSeq: Date.now() + 1,
          });
          tx.oncomplete = () => {
            const count = db.transaction("pending").objectStore("pending").count();
            count.onsuccess = () => {
              db.close();
              resolve(count.result);
            };
          };
        };
        req.onerror = () => resolve(-1);
      });
    });
    expect(queued, "IndexedDB did not accept the entries").toBe(2);

    // It has to survive the tab going away — a phone in a pocket is a closed
    // tab, not a paused one.
    await page.reload();
    const survived = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("cdchr-clock", 1);
          req.onsuccess = () => {
            const db = req.result;
            const count = db.transaction("pending").objectStore("pending").count();
            count.onsuccess = () => {
              db.close();
              resolve(count.result);
            };
          };
          req.onerror = () => resolve(-1);
        }),
    );
    expect(survived, "the queue did not survive a reload").toBe(2);

    // Now open the tap page, which drains on arrival. The tag does not exist
    // in this database, so the server refuses both — and a refusal is still a
    // decision, so both must be cleared.
    await page.goto("/clock?tag=04AABBCCDDEE80");
    await expect(page.getByText(/This tag|Hi,/).first()).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                const req = indexedDB.open("cdchr-clock", 1);
                req.onsuccess = () => {
                  const db = req.result;
                  const count = db
                    .transaction("pending")
                    .objectStore("pending")
                    .count();
                  count.onsuccess = () => {
                    db.close();
                    resolve(count.result);
                  };
                };
                req.onerror = () => resolve(-1);
              }),
          ),
        {
          timeout: 25_000,
          message:
            "the queue was not cleared — a decided tap that stays queued is retried for ever",
        },
      )
      .toBe(0);
  });
});
