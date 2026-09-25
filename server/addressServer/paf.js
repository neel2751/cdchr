"use server";

import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import {
  ADDRESS_PROVIDERS,
  AddressLookupError,
  findAddressProvider,
} from "@/lib/addressProviders";
import { isValidUkPostcode, normalisePostcode } from "@/lib/postcode";
import {
  openSecret,
  sealSecret,
  secretHint,
  secretsConfigured,
} from "@/lib/secretBox";
import AddressAccountModel from "@/models/addressAccountModel";
import { getServerSideProps } from "../session/session";

/**
 * Turning a postcode into the addresses actually on it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS ACTION SPENDS OUR MONEY, AND CUSTOMERS CALL IT.
 *
 * That is the unusual thing about this file and it drives every decision in
 * it. PAF is licensed per lookup: the key is ours, the invoice is ours, and
 * the person pressing the button works for somebody else. So —
 *
 *   · a malformed postcode never reaches the provider. It cannot have an
 *     answer, and asking costs the same as asking a real question.
 *   · there is a per-company daily ceiling. One customer holding down a
 *     button must not run up our bill.
 *   · identical lookups inside a short window are answered from memory, so a
 *     double click is one charge rather than two.
 *   · and the feature simply does not appear when no account is enabled. The
 *     order form works exactly as it did — typed by hand, with the free
 *     postcodes.io warning — because a licensed extra must never become a
 *     thing you cannot order without.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ON KEEPING WHAT COMES BACK: PAF licences restrict retaining address data
 * beyond the transaction it was fetched for. So the cache below is minutes
 * long and in memory only, and the ONLY address written to the database is the
 * one the customer actually chooses — which is their own address on their own
 * order, and ours to keep. Anyone enabling this should still read their own
 * licence rather than trust this paragraph.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

/** Per-company counters, reset by the calendar day the count was opened on. */
const usage = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function countLookup(tenantId) {
  const key = String(tenantId || "none");
  const current = usage.get(key);
  if (!current || current.day !== today()) {
    usage.set(key, { day: today(), count: 1 });
    return 1;
  }
  current.count += 1;
  return current.count;
}

function peekUsage(tenantId) {
  const current = usage.get(String(tenantId || "none"));
  return current && current.day === today() ? current.count : 0;
}

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (user.role !== "platformAdmin") {
    return { ok: false, message: "Not authorized" };
  }
  return { ok: true, user };
}

/** Read the enabled account, with its key opened. Never leaves this module. */
async function activeAccount() {
  await connect();
  const account = await escapeTenant("address lookup: account", () =>
    AddressAccountModel.findOne({ isEnabled: true }).lean(),
  );
  if (!account) return null;

  const spec = findAddressProvider(account.provider);
  if (!spec) return null;

  const raw =
    account.credentials instanceof Map
      ? Object.fromEntries(account.credentials)
      : account.credentials || {};

  const credentials = {};
  for (const [name, sealed] of Object.entries(raw)) {
    credentials[name] = openSecret(sealed);
  }
  return { account, spec, credentials };
}

/**
 * Is address lookup on at all?
 *
 * Callable by any signed-in admin, because the order form has to know whether
 * to offer the button. Says nothing about who the provider is or what the key
 * is — only whether the feature exists.
 */
export async function addressLookupAvailable() {
  try {
    const { props } = await getServerSideProps();
    if (!props?.session?.user?._id) {
      return { success: true, data: JSON.stringify({ available: false }) };
    }
    await connect();
    const account = await escapeTenant("address lookup: availability", () =>
      AddressAccountModel.findOne({ isEnabled: true }).select("_id").lean(),
    );
    return {
      success: true,
      data: JSON.stringify({ available: Boolean(account) }),
    };
  } catch (error) {
    console.log("Error checking address lookup availability:", error?.message);
    // Unavailable rather than broken: the form falls back to typing.
    return { success: true, data: JSON.stringify({ available: false }) };
  }
}

/**
 * The addresses on a postcode.
 *
 * Returns `{ addresses }` — an empty list is a real answer, meaning the
 * postcode is deliverable but has nothing on it we can see. Never throws at
 * the caller: a failure is a message, and the form keeps working.
 */
export async function findAddresses({ postcode } = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    // Anyone who can place an order can look one up. Not platform-only: the
    // whole point is that the customer uses our licence.
    if (!["superAdmin", "admin"].includes(user?.role)) {
      return { success: false, message: "Not authorized" };
    }

    const normalised = normalisePostcode(postcode);
    if (!isValidUkPostcode(normalised)) {
      // Refused before it costs anything. A malformed postcode cannot have an
      // answer, and a billable lookup is the same price either way.
      return {
        success: false,
        message: `"${normalised || "(none)"}" is not a valid UK postcode.`,
      };
    }

    const found = await activeAccount();
    if (!found) {
      return {
        success: false,
        message: "Address lookup is not switched on. Type the address instead.",
      };
    }

    const cached = cache.get(normalised);
    if (cached && cached.until > Date.now()) {
      return {
        success: true,
        data: JSON.stringify({ addresses: cached.addresses, cached: true }),
      };
    }

    const limit = found.account.dailyLookupLimit ?? 200;
    if (limit > 0 && peekUsage(user.tenantId) >= limit) {
      return {
        success: false,
        message:
          `That is ${limit} address lookups today, which is the daily limit. ` +
          "Type the address in, or ask us to raise it.",
      };
    }

    let addresses;
    try {
      addresses = await found.spec.lookup(normalised, found.credentials);
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof AddressLookupError
            ? error.message
            : "The address service could not be reached.",
      };
    }

    countLookup(user.tenantId);

    // Short and in memory. See the licensing note at the top of this file.
    if (cache.size > 200) cache.clear();
    cache.set(normalised, { addresses, until: Date.now() + CACHE_TTL_MS });

    return {
      success: true,
      data: JSON.stringify({ addresses, cached: false }),
    };
  } catch (error) {
    console.log("Error looking up addresses:", error?.message);
    return { success: false, message: "Could not look that postcode up" };
  }
}

/* ------------------------------------------------------------ platform */

/** The providers, with whether each is set up. Never any credential. */
export async function getAddressAccounts() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const accounts = await escapeTenant("address accounts: list", () =>
      AddressAccountModel.find({}).lean(),
    );
    const byProvider = new Map(accounts.map((a) => [a.provider, a]));

    const asObject = (value) => {
      if (!value) return {};
      return value instanceof Map ? Object.fromEntries(value) : value;
    };

    return {
      success: true,
      data: JSON.stringify({
        sealingReady: secretsConfigured(),
        providers: ADDRESS_PROVIDERS.map((p) => {
          const account = byProvider.get(p.key);
          return {
            key: p.key,
            name: p.name,
            needs: p.needs,
            hints: asObject(account?.hints),
            configured: Object.keys(asObject(account?.credentials)).length > 0,
            isEnabled: Boolean(account?.isEnabled),
            dailyLookupLimit: account?.dailyLookupLimit ?? 200,
            lastTestedAt: account?.lastTestedAt || null,
            lastTestOk: account?.lastTestOk ?? null,
            lastTestMessage: account?.lastTestMessage || "",
          };
        }),
      }),
    };
  } catch (error) {
    console.log("Error loading address accounts:", error?.message);
    return { success: false, message: "Could not load address accounts" };
  }
}

/** Store or change one provider's key, limit, or enabled state. */
export async function saveAddressAccount({
  provider,
  credentials = {},
  isEnabled,
  dailyLookupLimit,
} = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const spec = findAddressProvider(provider);
    if (!spec) return { success: false, message: "Unknown provider" };
    if (!secretsConfigured()) {
      return {
        success: false,
        message: "TAG_KEY_MASTER is not set, so keys cannot be sealed.",
      };
    }

    await connect();
    const existing = await escapeTenant("address accounts: find", () =>
      AddressAccountModel.findOne({ provider }),
    );

    const sealed = existing?.credentials || new Map();
    const hints = existing?.hints || new Map();
    let changed = 0;
    for (const field of spec.needs) {
      const value = (credentials?.[field.name] || "").trim();
      if (!value) continue; // blank leaves the stored key alone
      sealed.set(field.name, sealSecret(value));
      hints.set(field.name, secretHint(value));
      changed++;
    }
    if (!existing && !changed) {
      return { success: false, message: "Enter a key first" };
    }

    // One licence at a time. Two enabled providers would bill us twice for
    // the same question, and which one answered would be a coin toss.
    if (isEnabled) {
      await escapeTenant("address accounts: exclusive enable", () =>
        AddressAccountModel.updateMany(
          { provider: { $ne: provider } },
          { $set: { isEnabled: false } },
        ),
      );
    }

    await escapeTenant("address accounts: save", () =>
      AddressAccountModel.updateOne(
        { provider },
        {
          $set: {
            credentials: sealed,
            hints,
            ...(isEnabled === undefined ? {} : { isEnabled: Boolean(isEnabled) }),
            ...(dailyLookupLimit === undefined
              ? {}
              : {
                  dailyLookupLimit: Math.max(
                    0,
                    Math.round(Number(dailyLookupLimit) || 0),
                  ),
                }),
          },
          $setOnInsert: { provider },
        },
        { upsert: true },
      ),
    );

    await logAuditDirect({
      action: "AddressAccount.save",
      module: "TagOrder",
      description: `Address lookup account ${provider} updated (${changed} key(s) changed)`,
      actor: auth.user,
    }).catch(() => {});

    return { success: true, message: `${spec.name} saved` };
  } catch (error) {
    console.log("Error saving an address account:", error?.message);
    return { success: false, message: "Could not save that account" };
  }
}

/**
 * Prove the key works.
 *
 * Costs one lookup, which is the cheapest honest test there is — these
 * services publish no free ping — so the message says so rather than letting
 * somebody discover it on an invoice.
 */
export async function testAddressAccount({ provider } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const spec = findAddressProvider(provider);
    if (!spec) return { success: false, message: "Unknown provider" };

    await connect();
    const stored = await escapeTenant("address accounts: read", () =>
      AddressAccountModel.findOne({ provider }).lean(),
    );
    if (!stored) return { success: false, message: "No account stored" };

    const raw =
      stored.credentials instanceof Map
        ? Object.fromEntries(stored.credentials)
        : stored.credentials || {};
    const credentials = {};
    for (const [name, value] of Object.entries(raw)) {
      credentials[name] = openSecret(value);
    }

    let ok = true;
    let message = "The service accepted the key.";
    try {
      const rows = await spec.lookup("SW1A 1AA", credentials);
      message = `The service accepted the key and returned ${rows.length} address(es) for SW1A 1AA.`;
    } catch (error) {
      ok = false;
      message =
        error instanceof AddressLookupError
          ? error.message
          : "The service could not be reached.";
    }

    await escapeTenant("address accounts: record a test", () =>
      AddressAccountModel.updateOne(
        { provider },
        {
          $set: {
            lastTestedAt: new Date(),
            lastTestOk: ok,
            lastTestMessage: message,
          },
        },
      ),
    );

    return { success: ok, message };
  } catch (error) {
    console.log("Error testing an address account:", error?.message);
    return { success: false, message: "Could not run that test" };
  }
}
