import dns from "node:dns/promises";
import crypto from "node:crypto";

import mongoose from "mongoose";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import { createObjectId } from "@/lib/mongodb";
import { normalizeHost, stripWww } from "@/lib/tenantHost";
import { cacheInvalidate } from "@/lib/tenantCache";

/**
 * Core tenant operations, shared by the two front doors that reach them:
 * `tenantSettingsServer.js` (a company's own super admin, tenant resolved from
 * the session) and `platformServer.js` (provider staff, tenant given by id).
 *
 * Deliberately NOT a "use server" module and deliberately unauthenticated —
 * every function takes an explicit tenantId and trusts it. Authorization is the
 * caller's job, and both callers do it before calling in. Nothing here may be
 * exposed as a server action directly, or a tenant id from the browser would
 * become an instruction.
 */

const DNS_PREFIX = "_verify";

export const BRANDING_FIELDS = [
  "appName",
  "logoUrl",
  "logoDarkUrl",
  "faviconUrl",
  "loginBackgroundUrl",
  "primaryColor",
  "accentColor",
  "radius",
  "supportEmail",
  "emailFromName",
  "emailFooterHtml",
];

/** Merge allow-listed branding fields onto a tenant. */
export async function applyBranding(tenantId, data) {
  await connect();
  const before = await CompanyModel.findById(tenantId).lean().exec();
  if (!before) return { success: false, message: "Company not found" };

  // Allow-listed so a crafted payload cannot reach status, domains or anything
  // else on the tenant document.
  const branding = {};
  for (const key of BRANDING_FIELDS) {
    if (data?.[key] !== undefined) branding[key] = String(data[key]).trim();
  }

  await CompanyModel.updateOne(
    { _id: createObjectId(tenantId) },
    { $set: { branding: { ...(before.branding || {}), ...branding } } }
  );
  cacheInvalidate();

  return {
    success: true,
    message: "Branding saved",
    before: before.branding || {},
    after: branding,
  };
}

/** Set the `<slug>.<root>` address, rejecting one already in use. */
export async function applySlug(tenantId, rawSlug) {
  const slug = String(rawSlug || "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    return {
      success: false,
      message:
        "Use lowercase letters, numbers or hyphens, not starting or ending with a hyphen",
    };
  }

  await connect();
  const taken = await CompanyModel.findOne({
    slug,
    _id: { $ne: createObjectId(tenantId) },
  })
    .lean()
    .exec();
  if (taken) return { success: false, message: "That address is taken" };

  const before = await CompanyModel.findById(tenantId).lean().exec();
  await CompanyModel.updateOne(
    { _id: createObjectId(tenantId) },
    { $set: { slug } }
  );
  cacheInvalidate();

  return {
    success: true,
    message: "Workspace address saved",
    before: { slug: before?.slug || "" },
    after: { slug },
  };
}

/**
 * Find the company that has *verified* a hostname, if any.
 *
 * Cross-tenant on purpose and the only read here that has to be: deciding
 * whether a hostname is already spoken for is a platform-wide question.
 */
export async function findVerifiedOwner(host) {
  await connect();
  return CompanyModel.findOne({
    domains: {
      $elemMatch: { host: { $in: [host, stripWww(host)] }, verified: true },
    },
    delete: { $ne: true },
  })
    .select("name")
    .lean()
    .exec();
}

/**
 * Claim a hostname for a company. Claims are open: several companies may hold
 * the same pending claim, and ownership is settled at verification by whoever
 * proves DNS control. Only an already *verified* hostname is closed.
 */
export async function addDomain(tenantId, rawHost) {
  const host = normalizeHost(rawHost);
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    return { success: false, message: "Enter a valid domain, e.g. hr.acme.com" };
  }

  await connect();

  const verifiedOwner = await findVerifiedOwner(host);
  if (verifiedOwner && String(verifiedOwner._id) !== String(tenantId)) {
    return {
      success: false,
      message:
        `${host} is already active for another company. If it belongs to you, ` +
        `contact our team and we will transfer it once ownership is confirmed.`,
    };
  }

  const tenant = await CompanyModel.findById(tenantId).lean().exec();
  if (!tenant) return { success: false, message: "Company not found" };

  if ((tenant.domains || []).some((d) => d.host === host)) {
    return { success: false, message: "That domain is already added" };
  }

  const domain = {
    host,
    // The first domain becomes primary, so emails always have a URL to use.
    isPrimary: (tenant.domains || []).length === 0,
    verified: false,
    verificationToken: crypto.randomBytes(16).toString("hex"),
    sslStatus: "pending",
    addedAt: new Date(),
  };

  await CompanyModel.updateOne(
    { _id: createObjectId(tenantId) },
    { $push: { domains: domain } }
  );
  cacheInvalidate(normalizeHost(host));

  return {
    success: true,
    message: "Domain added — now add the DNS record to verify it",
    after: { host },
  };
}

/**
 * Check the TXT record that proves control of the domain.
 *
 * Verification is what makes a domain route traffic (see resolveTenantByHost),
 * so this can never be a "mark it done" toggle — without the DNS check anyone
 * could claim any hostname and take over its routing.
 */
export async function verifyDomain(tenantId, rawHost) {
  const host = normalizeHost(rawHost);
  await connect();
  const tenant = await CompanyModel.findById(tenantId).lean().exec();
  const domain = (tenant?.domains || []).find((d) => d.host === host);
  if (!domain) return { success: false, message: "Domain not found" };
  if (domain.verified) return { success: true, message: "Already verified" };

  // Someone may have verified it between this claim being made and now.
  const alreadyOwned = await findVerifiedOwner(host);
  if (alreadyOwned && String(alreadyOwned._id) !== String(tenantId)) {
    return {
      success: false,
      message:
        `${host} was verified by another company first. If it belongs to you, ` +
        `contact our team and we will transfer it once ownership is confirmed.`,
    };
  }

  const record = `${DNS_PREFIX}.${host}`;
  let values = [];
  try {
    values = (await dns.resolveTxt(record)).flat();
  } catch (err) {
    return {
      success: false,
      message:
        err?.code === "ENOTFOUND" || err?.code === "ENODATA"
          ? `No TXT record found at ${record}. DNS changes can take a few minutes.`
          : `Could not read DNS for ${record}`,
    };
  }

  if (!values.includes(domain.verificationToken)) {
    return {
      success: false,
      message: `TXT record found but the value does not match. Expected ${domain.verificationToken}`,
    };
  }

  // The DNS check and the exclusivity check have to commit together. Each claim
  // carries a different token, so nothing stops the domain's real owner
  // publishing two records and two companies both passing the DNS check — the
  // race is settled here, not in DNS.
  const session = await mongoose.startSession();
  let wonBy = null;
  try {
    await session.withTransaction(async () => {
      const winner = await CompanyModel.findOne({
        domains: {
          $elemMatch: { host: { $in: [host, stripWww(host)] }, verified: true },
        },
        delete: { $ne: true },
      })
        .session(session)
        .lean();

      if (winner && String(winner._id) !== String(tenantId)) {
        wonBy = winner;
        return;
      }

      await CompanyModel.updateOne(
        { _id: createObjectId(tenantId), "domains.host": host },
        { $set: { "domains.$.verified": true, "domains.$.verifiedAt": new Date() } }
      ).session(session);

      // Every other pending claim on this hostname can never win it now, so
      // drop them rather than leaving companies with a button that will always
      // fail.
      await CompanyModel.updateMany(
        { _id: { $ne: createObjectId(tenantId) }, "domains.host": host },
        { $pull: { domains: { host } } }
      ).session(session);
    });
  } finally {
    await session.endSession();
  }

  if (wonBy) {
    return {
      success: false,
      message:
        `${host} was verified by another company first. If it belongs to you, ` +
        `contact our team and we will transfer it once ownership is confirmed.`,
    };
  }

  cacheInvalidate(normalizeHost(host));
  return { success: true, message: `${host} verified`, after: { host, verified: true } };
}

/** Choose the domain used to build absolute URLs. Must be verified first. */
export async function setPrimaryDomain(tenantId, rawHost) {
  const host = normalizeHost(rawHost);
  await connect();
  const tenant = await CompanyModel.findById(tenantId).lean().exec();
  const domain = (tenant?.domains || []).find((d) => d.host === host);
  if (!domain) return { success: false, message: "Domain not found" };
  if (!domain.verified) {
    return { success: false, message: "Verify the domain before making it primary" };
  }

  const domains = (tenant.domains || []).map((d) => ({
    ...d,
    isPrimary: d.host === host,
  }));
  await CompanyModel.updateOne(
    { _id: createObjectId(tenantId) },
    { $set: { domains } }
  );
  cacheInvalidate();

  return {
    success: true,
    message: `${host} is now the primary domain`,
    after: { primaryHost: host },
  };
}

/**
 * Probe whether a domain is actually serving over HTTPS yet.
 *
 * Caddy obtains certificates on demand, so there is no callback to tell the app
 * when one is ready — the honest way to know is to ask the domain. A successful
 * TLS handshake is the proof; the response status does not matter.
 */
export async function checkDomainTls(tenantId, rawHost) {
  const host = normalizeHost(rawHost);
  await connect();
  const tenant = await CompanyModel.findById(tenantId).lean().exec();
  const domain = (tenant?.domains || []).find((d) => d.host === host);
  if (!domain) return { success: false, message: "Domain not found" };
  if (!domain.verified) {
    return { success: false, message: "Verify the domain first" };
  }

  let status = "failed";
  let message = `${host} is not serving over HTTPS yet.`;
  try {
    await fetch(`https://${host}/api/tenant/resolve?host=${encodeURIComponent(host)}`, {
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    // Reaching here means the TLS handshake completed, which is the question.
    status = "issued";
    message = `${host} is live over HTTPS.`;
  } catch (error) {
    message =
      `${host} is not serving over HTTPS yet — check the CNAME or A record ` +
      `points here, then try again in a minute.`;
  }

  await CompanyModel.updateOne(
    { _id: createObjectId(tenantId), "domains.host": host },
    { $set: { "domains.$.sslStatus": status } }
  );
  cacheInvalidate(host);

  return { success: status === "issued", message, after: { host, sslStatus: status } };
}

export async function removeDomain(tenantId, rawHost) {
  const host = normalizeHost(rawHost);
  await connect();
  await CompanyModel.updateOne(
    { _id: createObjectId(tenantId) },
    { $pull: { domains: { host } } }
  );
  cacheInvalidate(normalizeHost(host));
  return { success: true, message: `${host} removed`, before: { host } };
}
