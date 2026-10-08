/**
 * The tag catalogue customers order from.
 *
 * Platform-level, not per company (see GLOBAL_MODELS in lib/tenantPlugin.js),
 * so this runs once per deployment rather than per tenant. Re-runnable: it
 * upserts by SKU, so prices can be edited here and the script run again.
 *
 * The on-metal variants are not an upsell. NFC does not work stuck to bare
 * metal — the metal detunes the antenna and the tag is dead — and site cabins
 * are usually steel. Without these in the catalogue the ordering screen's
 * "mounting on metal?" question would filter down to nothing.
 *
 * Prices below are placeholders. Set them to yours before anybody orders.
 *
 * Usage:
 *   node scripts/seed-tag-catalogue.mjs            # dry run
 *   node scripts/seed-tag-catalogue.mjs --apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const CATALOGUE = [
  {
    sku: "RND-30-213",
    name: "Round sticker 30mm",
    formFactor: "round",
    chipType: "ntag213",
    onMetal: false,
    weatherproof: true,
    unitPrice: 1.2,
    minQuantity: 10,
    leadTimeDays: 7,
    description:
      "The everyday tag. Pair it with the location check — a plain chip has no replay protection of its own.",
  },
  {
    sku: "RND-30-213-M",
    name: "Round sticker 30mm (on-metal)",
    formFactor: "round",
    chipType: "ntag213",
    onMetal: true,
    weatherproof: true,
    unitPrice: 2.1,
    minQuantity: 10,
    leadTimeDays: 7,
    description: "Ferrite-backed, for steel cabins, containers and plant.",
  },
  {
    sku: "CARD-213",
    name: "Credit-card tag",
    formFactor: "card",
    chipType: "ntag213",
    onMetal: false,
    weatherproof: false,
    unitPrice: 1.8,
    minQuantity: 10,
    leadTimeDays: 10,
    customisation: { logo: true, text: true, colours: ["white", "black"] },
    description: "Printable face. Suits a reception desk rather than a gate.",
  },
  {
    sku: "RND-30-424",
    name: "Round sticker 30mm (secure)",
    formFactor: "round",
    chipType: "ntag424",
    onMetal: false,
    weatherproof: true,
    unitPrice: 3.4,
    minQuantity: 5,
    leadTimeDays: 14,
    description:
      "NTAG 424 DNA. Every tap is uniquely signed, so a copied link is worthless — the tag itself becomes the control.",
  },
  {
    sku: "RND-30-424-M",
    name: "Round sticker 30mm (secure, on-metal)",
    formFactor: "round",
    chipType: "ntag424",
    onMetal: true,
    weatherproof: true,
    unitPrice: 4.3,
    minQuantity: 5,
    leadTimeDays: 14,
    description: "Signed taps, ferrite-backed. For steel cabins where GPS is poor.",
  },
];

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_DB_URL);
  const products = mongoose.connection.db.collection("tagproducts");

  for (const item of CATALOGUE) {
    const existing = await products.findOne({ sku: item.sku });
    const verb = existing ? "update" : "create";
    console.log(
      `  ${APPLY ? verb : `would ${verb}`}  ${item.sku.padEnd(14)} ` +
        `${item.name} — £${item.unitPrice.toFixed(2)}` +
        (item.onMetal ? "  [on-metal]" : ""),
    );
    if (APPLY) {
      await products.updateOne(
        { sku: item.sku },
        {
          $set: { ...item, isActive: true, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }
  }

  console.log(
    APPLY
      ? `\nCatalogue set: ${CATALOGUE.length} product(s). Edit the prices in this file and re-run.`
      : "\nDry run. Re-run with --apply to write the catalogue.",
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
