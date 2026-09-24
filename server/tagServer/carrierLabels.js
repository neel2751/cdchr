"use server";

import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import {
  LABEL_PROVIDERS,
  LabelError,
  findProvider,
} from "@/lib/carrierProviders";
import { openSecret, sealSecret, secretHint, secretsConfigured } from "@/lib/secretBox";
import CarrierAccountModel from "@/models/carrierAccountModel";
import CompanyModel from "@/models/companyModel";
import PlatformSettingModel from "@/models/platformSettingModel";
import TagOrderModel from "@/models/tagOrderModel";
import TagProductModel from "@/models/tagProductModel";
import { getServerSideProps } from "../session/session";

/**
 * Buying postage.
 *
 * The rules here are all about money and about parcels that cannot be posted,
 * which is a different risk profile from the rest of the tag feature:
 *
 *   - A label is bought AT MOST ONCE per shipment. A second purchase is a
 *     second postage charge, and the first label is still on the box.
 *   - A purchase is all or nothing. A tracking number with no label is
 *     postage nobody can print.
 *   - Nothing is guessed. No weight, or no structured address, means no
 *     purchase — a guessed weight is a surcharge and a guessed city is a
 *     parcel delivered somewhere else.
 *   - A failure never blocks dispatch. The shipment still exists, the
 *     operator buys on the carrier's website, and types the number in.
 *
 * See lib/carrierProviders.js for the adapters, and the warning there that
 * none of them has been run against a live account.
 */

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (user.role !== "platformAdmin") {
    return { ok: false, message: "Not authorized" };
  }
  return { ok: true, user };
}

/** The providers, with whether each is set up. Never any credential. */
export async function getCarrierAccounts() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const accounts = await escapeTenant("carrier accounts: list", () =>
      CarrierAccountModel.find({}).lean(),
    );
    const byProvider = new Map(accounts.map((a) => [a.provider, a]));

    // A Mongoose Map comes back from .lean() as a plain object, not a Map, so
    // neither Object.fromEntries nor .size works on both. This reads either.
    const asObject = (value) => {
      if (!value) return {};
      return value instanceof Map ? Object.fromEntries(value) : value;
    };

    const rows = LABEL_PROVIDERS.map((p) => {
      const account = byProvider.get(p.key);
      return {
        key: p.key,
        name: p.name,
        mode: p.mode,
        needs: p.needs,
        hints: asObject(account?.hints),
        configured: Object.keys(asObject(account?.credentials)).length > 0,
        isEnabled: Boolean(account?.isEnabled),
        lastTestedAt: account?.lastTestedAt || null,
        lastTestOk: account?.lastTestOk ?? null,
        lastTestMessage: account?.lastTestMessage || "",
      };
    });

    return {
      success: true,
      data: JSON.stringify({ providers: rows, sealingReady: secretsConfigured() }),
    };
  } catch (error) {
    console.log("Error loading carrier accounts:", error);
    return { success: false, message: "Could not load carrier accounts" };
  }
}

/**
 * Store credentials for one provider.
 *
 * A blank field leaves whatever is stored alone, so re-saving to change the
 * enabled flag does not wipe a key the screen never received.
 */
export async function saveCarrierAccount({ provider, credentials = {}, isEnabled } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const spec = findProvider(provider);
    if (!spec) return { success: false, message: "Unknown provider" };
    if (spec.mode !== "api") {
      return { success: false, message: "That provider needs no account" };
    }
    if (!secretsConfigured()) {
      return {
        success: false,
        message:
          "TAG_KEY_MASTER is not set, so credentials cannot be sealed. Set it first.",
      };
    }

    await connect();
    const existing = await escapeTenant("carrier accounts: find", () =>
      CarrierAccountModel.findOne({ provider }),
    );

    const sealed = existing?.credentials || new Map();
    const hints = existing?.hints || new Map();
    let changed = 0;
    for (const field of spec.needs) {
      const value = (credentials?.[field.name] || "").trim();
      if (!value) continue; // left blank = unchanged
      sealed.set(field.name, sealSecret(value));
      hints.set(field.name, secretHint(value));
      changed++;
    }

    if (!existing && !changed) {
      return { success: false, message: "Enter a credential first" };
    }

    await escapeTenant("carrier accounts: save", () =>
      CarrierAccountModel.updateOne(
        { provider },
        {
          $set: {
            credentials: sealed,
            hints,
            ...(isEnabled === undefined ? {} : { isEnabled: Boolean(isEnabled) }),
          },
          $setOnInsert: { provider },
        },
        { upsert: true },
      ),
    );

    await logAuditDirect({
      action: "CarrierAccount.save",
      module: "TagOrder",
      // Records THAT a credential changed. Never the credential.
      description: `Carrier account ${provider} updated (${changed} credential(s) changed)`,
      actor: auth.user,
    }).catch(() => {});

    return { success: true, message: `${spec.name} saved` };
  } catch (error) {
    console.log("Error saving a carrier account:", error?.message);
    return { success: false, message: "Could not save that account" };
  }
}

/** Open a provider's credentials for use. Never leaves this module. */
async function credentialsFor(provider) {
  const account = await escapeTenant("carrier accounts: read", () =>
    CarrierAccountModel.findOne({ provider }).lean(),
  );
  if (!account) return null;

  const raw =
    account.credentials instanceof Map
      ? Object.fromEntries(account.credentials)
      : account.credentials || {};

  const open = {};
  for (const [name, sealed] of Object.entries(raw)) {
    open[name] = openSecret(sealed);
  }
  return { account, credentials: open };
}

/** Prove the key works, without buying anything. */
export async function testCarrierAccount({ provider } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const spec = findProvider(provider);
    if (!spec?.test) {
      return { success: false, message: "That provider cannot be tested" };
    }

    await connect();
    const found = await credentialsFor(provider);
    if (!found) return { success: false, message: "No account stored" };

    let ok = true;
    let message = "The carrier accepted the credentials.";
    try {
      await spec.test(found.credentials);
    } catch (error) {
      ok = false;
      message =
        error instanceof LabelError
          ? error.message
          : "The carrier could not be reached.";
    }

    await escapeTenant("carrier accounts: record a test", () =>
      CarrierAccountModel.updateOne(
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
    console.log("Error testing a carrier account:", error?.message);
    return { success: false, message: "Could not run that test" };
  }
}

/**
 * What this shipment weighs, and whether we know.
 *
 * Returns null when the product has no weight recorded. Guessing would be a
 * surcharge on every parcel, charged later and to us.
 */
function shipmentWeight(order, shipment, product) {
  const perTag = Number(product?.weightGrams) || 0;
  if (!perTag) return null;
  const count = shipment.unitIndexes?.length || 0;
  // Packaging. A flat allowance rather than a per-box field nobody would keep
  // accurate; it is declared, not measured, and being slightly over is safer
  // than being under.
  const PACKAGING_GRAMS = 60;
  return count * perTag + PACKAGING_GRAMS * (shipment.parcelCount || 1);
}

/** Everything the buy needs, or a reason it cannot happen. */
async function readyToBuy(orderNumber, reference) {
  const order = await escapeTenant("postage: find the order", () =>
    TagOrderModel.findOne({ orderNumber }).lean(),
  );
  if (!order) return { error: "Order not found" };

  const shipment = (order.shipments || []).find((s) => s.reference === reference);
  if (!shipment) return { error: "Shipment not found" };

  // The rule that protects real money.
  if (shipment.labelData) {
    return { error: `${reference} already has a label. Void it first to buy another.` };
  }

  const to = order.shipTo || {};
  if (!to.line1 || !to.city) {
    return {
      error:
        "This order has no structured address. A postage label needs the " +
        "address in parts — the customer's typed address cannot be split up " +
        "safely, because guessing which line is the city sends the parcel to " +
        "the wrong place.",
    };
  }

  const sku = order.items?.[0]?.productSku;
  const product = await escapeTenant("postage: find the product", () =>
    TagProductModel.findOne({ sku }).select("weightGrams name").lean(),
  );
  const weightGrams = shipmentWeight(order, shipment, product);
  if (!weightGrams) {
    return {
      error: `No weight is recorded for ${sku}. Set it on the catalogue — every postage API prices on weight.`,
    };
  }

  const [company, settings] = await Promise.all([
    escapeTenant("postage: the customer", () =>
      CompanyModel.findById(order.tenantId).select("name").lean(),
    ),
    escapeTenant("postage: our own details", () =>
      PlatformSettingModel.findOne({ singleton: "only" }).lean(),
    ),
  ]);

  return {
    order,
    shipment,
    weightGrams,
    // Where it is going *from*. Royal Mail infers this from the account;
    // DPD asks for a collection address explicitly, so it has to be here.
    from: {
      name: settings?.dispatchFromName || "",
      address: settings?.dispatchFromAddress || "",
      contact: settings?.dispatchContact || "",
    },
    address: {
      name: to.name || "",
      company: to.company || company?.name || "",
      line1: to.line1,
      line2: to.line2 || "",
      city: to.city,
      postcode: to.postcode || "",
      countryCode: to.countryCode || "GB",
    },
  };
}

/**
 * Buy postage for one shipment.
 *
 * On success the tracking number replaces whatever was typed in, because the
 * carrier's number is the one their network knows about.
 */
export async function buyShipmentLabel({ orderNumber, reference, provider } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const spec = findProvider(provider);
    if (!spec || spec.mode !== "api") {
      return { success: false, message: "That provider cannot buy labels" };
    }

    await connect();
    const found = await credentialsFor(provider);
    if (!found) return { success: false, message: "No account stored" };
    if (!found.account.isEnabled) {
      return {
        success: false,
        message: `${spec.name} is stored but switched off. Test it, then enable it.`,
      };
    }

    const ready = await readyToBuy(orderNumber, reference);
    if (ready.error) return { success: false, message: ready.error };

    let bought;
    try {
      bought = await spec.buy(
        {
          order: ready.order,
          shipment: ready.shipment,
          address: ready.address,
          from: ready.from,
          weightGrams: ready.weightGrams,
          parcelCount: ready.shipment.parcelCount || 1,
        },
        found.credentials,
      );
    } catch (error) {
      const message =
        error instanceof LabelError
          ? error.message
          : "The carrier could not be reached.";

      // Recorded on the shipment, not only returned: the operator who sees
      // this may not be the one who retries, and "nothing happened" is a
      // worse handover than "the carrier said this".
      await escapeTenant("postage: record a failure", () =>
        TagOrderModel.updateOne(
          { _id: ready.order._id },
          { $set: { "shipments.$[s].labelError": message } },
          { arrayFilters: [{ "s.reference": reference }] },
        ),
      ).catch(() => {});

      return { success: false, message };
    }

    // Guarded on labelData still being absent, so two operators pressing at
    // once cannot both write a label — the loser is told, and their label is
    // the one to void at the carrier.
    const res = await escapeTenant("postage: store the label", () =>
      TagOrderModel.updateOne(
        {
          _id: ready.order._id,
          shipments: {
            $elemMatch: { reference, labelData: { $in: [null, undefined] } },
          },
        },
        {
          $set: {
            "shipments.$[s].labelProvider": provider,
            "shipments.$[s].labelData": bought.labelBase64,
            "shipments.$[s].labelFormat": bought.labelFormat,
            "shipments.$[s].labelAllocatedAt": new Date(),
            "shipments.$[s].labelProviderRef": bought.reference || "",
            "shipments.$[s].trackingRef": bought.trackingNumber,
            "shipments.$[s].weightGrams": ready.weightGrams,
            "shipments.$[s].labelError": "",
          },
        },
        { arrayFilters: [{ "s.reference": reference }] },
      ),
    );

    if (!res.modifiedCount) {
      return {
        success: false,
        message:
          "A label was bought but another one was stored first. Void one of " +
          `them at ${spec.name} — tracking ${bought.trackingNumber}.`,
      };
    }

    await logAuditDirect({
      action: "TagOrder.postage",
      module: "TagOrder",
      entityId: String(ready.order._id),
      tenantId: ready.order.tenantId,
      description:
        `Postage bought for ${reference} via ${spec.name}: ` +
        `${bought.trackingNumber}, ${ready.weightGrams}g`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `Label bought — ${bought.trackingNumber}`,
    };
  } catch (error) {
    console.log("Error buying a label:", error?.message);
    return { success: false, message: "Could not buy that label" };
  }
}

/**
 * Forget a label we hold.
 *
 * Does NOT cancel it at the carrier — no adapter here claims to, and saying
 * "voided" about a label that is still live and still charged would be a lie
 * that costs money. This clears our copy so a replacement can be bought, and
 * says plainly that the carrier's side is a separate job.
 */
export async function discardShipmentLabel({ orderNumber, reference } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await escapeTenant("postage: find the order", () =>
      TagOrderModel.findOne({ orderNumber }).lean(),
    );
    if (!order) return { success: false, message: "Order not found" };

    const shipment = (order.shipments || []).find((s) => s.reference === reference);
    if (!shipment?.labelData) {
      return { success: false, message: "There is no stored label to discard" };
    }

    await escapeTenant("postage: discard a label", () =>
      TagOrderModel.updateOne(
        { _id: order._id },
        {
          $set: {
            "shipments.$[s].labelData": null,
            "shipments.$[s].labelFormat": null,
            "shipments.$[s].labelProvider": null,
            "shipments.$[s].labelAllocatedAt": null,
          },
        },
        { arrayFilters: [{ "s.reference": reference }] },
      ),
    );

    await logAuditDirect({
      action: "TagOrder.postageDiscarded",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description: `Stored label discarded for ${reference} (${shipment.trackingRef || "no tracking"})`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message:
        "Discarded here. If that label was already paid for, cancel it with " +
        "the carrier too — this does not.",
    };
  } catch (error) {
    console.log("Error discarding a label:", error?.message);
    return { success: false, message: "Could not discard that label" };
  }
}

/** The stored postage label, for printing or downloading. */
export async function getShipmentPostage({ orderNumber, reference } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await escapeTenant("postage: find the order", () =>
      TagOrderModel.findOne({ orderNumber }).select("shipments").lean(),
    );
    const shipment = (order?.shipments || []).find(
      (s) => s.reference === reference,
    );
    if (!shipment?.labelData) {
      return { success: false, message: "No postage label is stored" };
    }

    return {
      success: true,
      data: JSON.stringify({
        format: shipment.labelFormat || "pdf",
        base64: shipment.labelData,
        trackingRef: shipment.trackingRef || "",
      }),
    };
  } catch (error) {
    console.log("Error loading a postage label:", error?.message);
    return { success: false, message: "Could not load that label" };
  }
}
