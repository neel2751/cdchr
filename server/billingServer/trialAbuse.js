import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import PendingSignupModel from "@/models/pendingSignupModel";

/**
 * Spotting the same business taking a second free trial.
 *
 * Two kinds of evidence, treated differently:
 *
 *   A MATCH — the phone number of an existing company's owner, or of an
 *   earlier sign-up. Strong enough to act on: no new workspace is made, and
 *   the person is told by email (signupServer.js) — never on screen, which
 *   would tell anyone typing numbers whose is registered.
 *
 *   FLAGS — the same work email domain, the same company name, the same
 *   internet address within a month, a throwaway inbox. Each has innocent
 *   explanations (two firms in one shared office, a common name), so they do
 *   not stop anybody. They are kept on the company for the platform admin,
 *   who can end the trial in one click or dismiss them.
 *
 * NOT "use server": these take raw details and answer cross-company
 * questions; they are for the signup flow only.
 */

/** Mail providers anyone can sign up with: the same domain says nothing. */
const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.co.uk",
  "zoho.com",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
]);

/** Throwaway inboxes — made to be used once, for exactly this. */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
]);

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** The last ten digits: 07700 900123 and +44 7700 900123 are one number. */
export function phoneKey(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

export function emailDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  return at === -1 ? "" : String(email).slice(at + 1).trim().toLowerCase();
}

/**
 * A company name with the noise taken out, so "Acme Builders Ltd." and
 * "ACME Builders Limited" compare equal.
 */
export function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !["ltd", "limited", "llp", "plc", "inc", "co", "company", "uk", "the", "group"].includes(w)
    )
    .join(" ");
}

/**
 * Has this phone number already had a workspace? The company it belongs to,
 * or null.
 *
 * Looks at three places: the phone a self-serve company signed up with, the
 * phone of every super admin (companies set up by hand have no sign-up
 * record), and earlier sign-ups that were completed.
 */
export async function repeatTrialMatch({ phone }) {
  const key = phoneKey(phone);
  if (!key) return null;
  await connect();

  const bySignup = await CompanyModel.findOne({
    "signup.phoneKey": key,
    delete: { $ne: true },
  })
    .select("name")
    .lean();
  if (bySignup) return { companyId: bySignup._id, companyName: bySignup.name };

  // Stored as a Number: no leading zero, with or without the country code.
  const asNumbers = [Number(key), Number(`44${key}`)].filter(Number.isFinite);
  const owner = await escapeTenant("trial abuse: owners by phone", () =>
    OfficeEmployeeModel.findOne({
      isSuperAdmin: true,
      delete: { $ne: true },
      phoneNumber: { $in: asNumbers },
    })
      .select("tenantId")
      .lean()
  );
  if (owner?.tenantId) {
    const company = await CompanyModel.findById(owner.tenantId).select("name delete").lean();
    if (company && company.delete !== true) {
      return { companyId: company._id, companyName: company.name };
    }
  }

  const earlier = await PendingSignupModel.findOne({
    usedAt: { $ne: null },
    phoneNumber: { $in: asNumbers },
  })
    .select("companyName")
    .lean();
  if (earlier) return { companyId: null, companyName: earlier.companyName };

  return null;
}

/**
 * Reasons to look twice at a new sign-up. Never stops it.
 *
 * @returns {Promise<Array<{ code: string, detail: string, companyId?: any, companyName?: string }>>}
 */
export async function signupFlags({ email, ip, companyName, now = new Date() }) {
  await connect();
  const flags = [];
  const domain = emailDomain(email);

  if (DISPOSABLE_DOMAINS.has(domain)) {
    flags.push({ code: "disposableEmail", detail: `Throwaway email address (@${domain})` });
  }

  if (domain && !FREE_DOMAINS.has(domain) && !DISPOSABLE_DOMAINS.has(domain)) {
    const same = await CompanyModel.findOne({
      "signup.emailDomain": domain,
      delete: { $ne: true },
    })
      .select("name")
      .lean();
    const owner =
      same ||
      (await escapeTenant("trial abuse: owners by email domain", () =>
        OfficeEmployeeModel.findOne({
          isSuperAdmin: true,
          delete: { $ne: true },
          email: new RegExp(`@${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        })
          .select("tenantId")
          .lean()
      ));
    const company = same || (owner?.tenantId
      ? await CompanyModel.findById(owner.tenantId).select("name").lean()
      : null);
    if (company) {
      flags.push({
        code: "sameEmailDomain",
        detail: `Same work email domain (@${domain}) as ${company.name}`,
        companyId: company._id,
        companyName: company.name,
      });
    }
  }

  const key = nameKey(companyName);
  if (key) {
    // Read in full and compared here: names are stored as typed, and the
    // comparison is on the cleaned form. A few hundred short strings.
    const companies = await CompanyModel.find({ delete: { $ne: true } })
      .select("name")
      .lean();
    const twin = companies.find((c) => nameKey(c.name) === key);
    if (twin) {
      flags.push({
        code: "sameName",
        detail: `Same company name as ${twin.name}`,
        companyId: twin._id,
        companyName: twin.name,
      });
    }
  }

  if (ip) {
    const sameIp = await CompanyModel.findOne({
      "signup.ip": ip,
      "signup.at": { $gte: new Date(now.getTime() - MONTH_MS) },
      delete: { $ne: true },
    })
      .select("name")
      .lean();
    if (sameIp) {
      flags.push({
        code: "sameIp",
        detail: `Signed up from the same internet address as ${sameIp.name} in the last month`,
        companyId: sameIp._id,
        companyName: sameIp.name,
      });
    }
  }

  return flags;
}
