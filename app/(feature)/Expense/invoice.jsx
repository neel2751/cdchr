"use client";
import { useBranding } from "@/app/admin/providers";
import { formatCurrency } from "@/utils/time";
import { Printer, X } from "lucide-react";
import React, { memo } from "react";
import { createPortal } from "react-dom";

/**
 * The expense invoice.
 *
 * The one screen in this feature a tenant might show someone outside their own
 * company, and until now the only one hard-coded to the original client — a
 * Cloudinary logo, "Creative Design & Construction Ltd.", info@cdc.construction,
 * a London phone number and a literal "£". Served to any other company it
 * carried a competitor's name.
 *
 * Everything identifying now comes from useBranding(); the amounts come from
 * the company's own `locale.currency`. The rest of the app is white-labelled
 * for free because it is built on the design tokens that
 * app/admin/layout.jsx writes into `:root` — this file was the exception
 * because it painted its own colours.
 */
const Invoice = memo(function Invoice({ open, setOpen, invoiceData }) {
  const branding = useBranding();
  const currency = branding?.locale?.currency;

  // Straight from branding. This used to prefer a `company` field joined onto
  // the expense, but the company is now always the signed-in tenant — the same
  // record branding comes from — so the join said the same thing twice and has
  // been dropped from the query.
  const issuer = branding?.name || branding?.appName || "Invoice";

  const amount = formatCurrency(invoiceData?.amount, currency);

  // Rendered into <body> rather than in place. Printing is why: the print rules
  // in app/globals.css collapse every *sibling* of this overlay, and only a
  // direct child of body has the page's other content as siblings. Left where
  // it was, it sat several levels inside the sidebar wrapper, which no selector
  // could switch off without taking the invoice down with it.
  // "Has this hydrated yet" without an effect: the server snapshot is false and
  // the client snapshot is true, so React swaps them during hydration rather
  // than committing and then scheduling a second render. `document` does not
  // exist server-side, and createPortal needs it.
  const isClient = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  if (!isClient) return null;

  return createPortal(
    <div
      className={`print-root size-full fixed top-0 start-0 overflow-x-hidden overflow-y-auto pointer-events-none z-[80] ${
        open ? "flex bg-gray-900/60" : "hidden"
      }`}
    >
      <div
        className={`${
          open ? "mt-12 opacity-100 duration-500" : "mt-0 opacity-0"
        } ease-out transition-all sm:max-w-lg sm:w-full m-3 sm:mx-auto`}
      >
        {/* print-target: app/globals.css hides everything else when printing,
            so this comes out on its own rather than wrapped in the sidebar. */}
        <div className="print-target relative flex flex-col bg-card text-card-foreground shadow-lg rounded-xl pointer-events-auto print:shadow-none">
          {/* The banner used to be a fixed #B2E7FE / #FF8F5D / #4C48FF
              composition, which fought every tenant's palette. Built from the
              brand tokens instead, so it follows whatever the company set. */}
          <div className="relative overflow-hidden min-h-24 rounded-t-xl bg-primary print:hidden">
            <div className="absolute top-2 end-2">
              <button
                onClick={setOpen}
                type="button"
                className="flex justify-center items-center size-7 text-sm font-semibold rounded-full border border-transparent text-primary-foreground hover:bg-white/20 focus:outline-none"
              >
                <span className="sr-only">Close</span>
                <X className="size-4 shrink-0" />
              </button>
            </div>
            <figure className="absolute inset-x-0 bottom-0">
              <svg
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 1920 100.1"
                aria-hidden="true"
              >
                <path className="fill-card" d="M0,0c0,0,934.4,93.4,1920,0v100.1H0L0,0z" />
              </svg>
            </figure>
          </div>

          <div className="relative z-10 -mt-12 print:mt-0">
            <span className="mx-auto flex justify-center items-center size-[62px] rounded-full border bg-card shadow-sm overflow-hidden">
              {/* Not next/image: a tenant's logo URL is arbitrary and
                  images.remotePatterns is fixed at build time. Uploaded logos
                  are served first-party from /api/asset. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding?.logoUrl || "/images/Interiorlogo.svg"}
                alt=""
                width={40}
                height={40}
                className="size-10 object-contain"
              />
            </span>
          </div>

          <div className="p-4 sm:p-7 overflow-y-auto">
            <div className="text-center">
              <h3 className="text-lg font-semibold">{issuer}</h3>
              <p className="text-sm text-muted-foreground">
                Invoice #{invoiceData?._id}
              </p>
            </div>

            <div className="mt-5 sm:mt-10 grid grid-cols-2 sm:grid-cols-3 gap-5">
              <div>
                <span className="block text-xs uppercase text-muted-foreground">
                  Amount:
                </span>
                <span className="block text-sm font-medium">{amount}</span>
              </div>

              <div>
                <span className="block text-xs uppercase text-muted-foreground">
                  Date:
                </span>
                <span className="block text-sm font-medium">
                  {invoiceData?.date
                    ? new Date(invoiceData.date).toDateString()
                    : "—"}
                </span>
              </div>

              <div>
                <span className="block text-xs uppercase text-muted-foreground">
                  Category:
                </span>
                <span className="block text-sm font-medium">
                  {invoiceData?.categoryLabel || "General"}
                </span>
              </div>
            </div>

            <div className="mt-5 sm:mt-10">
              <h4 className="text-xs font-semibold uppercase">Summary</h4>

              <ul className="mt-3 flex flex-col">
                <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm border -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg">
                  <div className="flex items-center justify-between w-full">
                    <span>Title</span>
                    <span>{invoiceData?.title}</span>
                  </div>
                </li>
                <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm border -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg">
                  <div className="flex items-center justify-between w-full">
                    {invoiceData?.project?.siteName ? (
                      <>
                        <span>Site Name</span>
                        <span>{invoiceData.project.siteName}</span>
                      </>
                    ) : (
                      <>
                        <span>Type</span>
                        <span>{invoiceData?.type || "General"}</span>
                      </>
                    )}
                  </div>
                </li>
                <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm font-semibold bg-muted border -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg">
                  <div className="flex items-center justify-between w-full">
                    <span>Total</span>
                    {/* Was a hard-coded "£" plus .toFixed(2), which also threw
                        on an expense with no amount. */}
                    <span>{amount}</span>
                  </div>
                </li>
              </ul>
            </div>

            <div className="mt-5 flex justify-end gap-x-2 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="py-2 px-3 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 focus:outline-none"
              >
                <Printer className="shrink-0 size-4" />
                Print
              </button>
            </div>

            <SupportLine branding={branding} />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

/**
 * The "any questions" footer.
 *
 * Renders nothing at all when a company has set neither contact. The old
 * version could not do that — the address and number were literals — so every
 * tenant's invoice told the reader to email a company they had never heard of.
 */
function SupportLine({ branding }) {
  const email = branding?.supportEmail;
  const phone = branding?.supportPhone;
  if (!email && !phone) return null;

  return (
    <div className="mt-5 sm:mt-10">
      <p className="text-sm text-muted-foreground">
        If you have any questions, please contact us
        {email && (
          <>
            {" at "}
            <a
              className="font-medium text-primary hover:underline"
              href={`mailto:${email}`}
            >
              {email}
            </a>
          </>
        )}
        {email && phone && " or"}
        {phone && (
          <>
            {" call "}
            <a
              className="font-medium text-primary hover:underline"
              href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            >
              {phone}
            </a>
          </>
        )}
        .
      </p>
    </div>
  );
}

export default Invoice;
