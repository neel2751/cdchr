"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { getMyProfileImage } from "@/server/officeServer/profileImageServer";

/**
 * The signed-in person's own photo, without asking the database for it on every
 * page.
 *
 * The sidebar footer renders this on every screen, and the answer changes about
 * once a year. Reading it from the database each time is a query per navigation
 * for a value that is almost always the same — so the key is cached in the
 * browser, and the database is consulted only when there is nothing cached, when
 * the copy has aged out, or when the person changes their photo, which tells the
 * cache directly.
 *
 * Two rules this has to obey, both learned from the `selectedAvatar` key it
 * replaces:
 *
 *   1. **Keyed by user.** That one key was shared by everyone who used the
 *      browser, so signing in as somebody else showed you their picture. Here
 *      the entry is `profileImage:<userId>`, and a different account simply
 *      misses the cache.
 *   2. **The cache is a copy, never the record.** It holds a key the server
 *      issued and re-checks on its own schedule. Nothing is authorised by it:
 *      /api/asset still refuses an avatar to anyone outside the company, so a
 *      stale or hand-edited entry buys nothing but a broken image.
 *
 * Built on useSyncExternalStore because that is what localStorage is — state
 * owned outside React, changed by other tabs and by other components. Reading it
 * through a subscription rather than copying it into useState is also what keeps
 * this free of setState-inside-an-effect.
 *
 * Every read and write is wrapped: localStorage throws outright in some privacy
 * modes, and a missing photo must never take the page down with it.
 */

const PREFIX = "profileImage:";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CHANGED_EVENT = "cdchr:profile-image-changed";

// One in-flight lookup per person. Several components use this hook on the same
// screen; without this they would each fire the same request on a cold cache.
const inFlight = new Set();

function entryKey(userId) {
  return `${PREFIX}${userId}`;
}

function readCache(userId) {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(entryKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { key: parsed.key ?? null, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

function writeCache(userId, key) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      entryKey(userId),
      JSON.stringify({ key: key ?? null, at: Date.now() })
    );
  } catch {
    // Private mode, or a full quota. Every read then misses and re-fetches,
    // which is slower but correct.
  }
}

function announce(userId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { userId } }));
}

/**
 * The photo is now this, and I know what it is.
 *
 * Called when a photo is removed — the answer is "none", no lookup needed.
 */
export function publishProfileImage(userId, key) {
  writeCache(userId, key);
  announce(userId);
}

/**
 * The photo changed and I do not know the new key — go and ask.
 *
 * Used after an upload, where the key is minted on the server. Deliberately not
 * `publishProfileImage(userId, null)`: that would record "no photo, freshly
 * checked", and the sidebar would show initials for half a day after somebody
 * set their picture. Dropping the entry is what makes the next read a real one.
 */
export function refreshProfileImage(userId) {
  if (userId && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(entryKey(userId));
    } catch {
      // Nothing to clear, or storage is unavailable.
    }
  }
  announce(userId);
}

/** Ask the server, store the answer, wake every subscriber. */
async function fetchAndCache(userId) {
  if (!userId || inFlight.has(userId)) return;
  inFlight.add(userId);
  try {
    const response = await getMyProfileImage();
    const parsed = response?.data ? JSON.parse(response.data) : null;
    writeCache(userId, parsed?.key || null);
    announce(userId);
  } catch {
    // Leave the cache alone; the initials fallback covers the gap.
  } finally {
    inFlight.delete(userId);
  }
}

function subscribe(onStoreChange) {
  if (typeof window === "undefined") return () => {};
  // The custom event covers this tab — `storage` fires only in the others.
  window.addEventListener(CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/**
 * @returns {{ src: string | null, imageKey: string | null }}
 */
export function useMyProfileImage() {
  const { data: session } = useSession();
  const userId = session?.user?._id || null;

  // Returns a string or null — a primitive, so repeated calls compare equal and
  // this cannot spin.
  const imageKey = useSyncExternalStore(
    subscribe,
    () => (userId ? readCache(userId)?.key ?? null : null),
    () => null
  );

  useEffect(() => {
    if (!userId) return;
    const cached = readCache(userId);
    // The point of the cache: an ordinary navigation does neither of these.
    if (!cached || Date.now() - cached.at > MAX_AGE_MS) {
      fetchAndCache(userId);
    }
  }, [userId]);

  return {
    imageKey,
    src: imageKey ? `/api/asset/${imageKey}` : null,
  };
}
