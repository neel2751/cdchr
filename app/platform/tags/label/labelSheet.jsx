"use client";

import React from "react";
import { Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/hooks/use-query";
import { getShipmentLabel } from "@/server/tagServer/labels";

/**
 * A dispatch label, ready to print.
 *
 * NOT a carrier's postage label — see the note at the top of
 * server/tagServer/labels.js. This is what goes on the box next to whatever
 * postage the carrier produces, so nobody has to open it to find out whose it
 * is.
 *
 * The print CSS is the substance of this component rather than decoration:
 * a label that comes out of the printer with the app's navigation around it,
 * or split across two sheets, is not usable. So everything that is not the
 * label is hidden at print time, and the label itself is told not to break.
 */
export default function LabelSheet({ orderNumber, reference }) {
  const { data, isLoading, error } = useFetchQuery({
    queryKey: ["shipmentLabel", orderNumber, reference],
    params: { orderNumber, reference },
    fetchFn: getShipmentLabel,
  });

  const label = data?.newData;

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !label) {
    return (
      <p className="p-6 text-sm text-red-600">
        {error?.message || "That shipment could not be loaded."}
      </p>
    );
  }

  const lines = (text) =>
    String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          /* Everything that is not the label. Printing the sidebar and the
             toolbar wastes the top third of the sheet and the label no longer
             fits on one. */
          body * { visibility: hidden; }
          #dispatch-label, #dispatch-label * { visibility: visible; }
          #dispatch-label {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none;
            /* A label split over two sheets is two useless halves. */
            page-break-inside: avoid;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print flex items-center gap-2">
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 size-4" />
          Print label
        </Button>
        {label.senderIncomplete ? (
          <p className="text-xs text-amber-700">
            No return address set — a box with nowhere to go back to gets
            binned, not returned. Set it under Dispatch details.
          </p>
        ) : null}
      </div>

      <div
        id="dispatch-label"
        className="mx-auto max-w-xl space-y-4 rounded-lg border-2 border-black bg-white p-6 text-black"
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide">Deliver to</p>
            <p className="text-xl font-bold leading-tight">
              {label.shipTo.company || "—"}
            </p>
            {lines(label.shipTo.address).map((l, i) => (
              <p key={i} className="text-base leading-snug">
                {l}
              </p>
            ))}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide">Parcels</p>
            <p className="text-3xl font-bold leading-none">
              {label.parcelCount}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="uppercase tracking-wide text-neutral-600">Order</p>
            <p className="font-mono text-sm font-semibold">
              {label.orderNumber}
            </p>
          </div>
          <div>
            <p className="uppercase tracking-wide text-neutral-600">Shipment</p>
            <p className="font-mono text-sm font-semibold">{label.reference}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide text-neutral-600">Carrier</p>
            <p className="text-sm">{label.carrier}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide text-neutral-600">Tracking</p>
            <p className="font-mono text-sm">{label.trackingRef || "—"}</p>
          </div>
        </div>

        <div className="border-t pt-3">
          <p className="text-[10px] uppercase tracking-wide text-neutral-600">
            Contents
          </p>
          {label.contents.map((c, i) => (
            <div key={i}>
              <p className="text-sm font-medium">
                {c.quantity} × {c.name}
              </p>
              {/* The UIDs in this box. A customer with a dead tag quotes one,
                  and it is the difference between finding the unit on the
                  order and guessing which of fifty it was. */}
              {c.uids.length ? (
                <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-neutral-600">
                  {c.uids.join("  ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {label.notes ? (
          <p className="border-t pt-2 text-xs italic">{label.notes}</p>
        ) : null}

        <div className="border-t-2 border-black pt-3 text-[10px] leading-snug">
          <p className="uppercase tracking-wide text-neutral-600">
            If undelivered, return to
          </p>
          <p className="font-semibold">{label.from.name || "—"}</p>
          {lines(label.from.address).map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          {label.from.contact ? <p>{label.from.contact}</p> : null}
          {label.from.returnNote ? (
            <p className="mt-1">{label.from.returnNote}</p>
          ) : null}
        </div>
      </div>

      <p className="no-print mx-auto max-w-xl text-xs text-neutral-500">
        This is a dispatch label, not postage. It identifies the box and what is
        in it — the carrier&apos;s own label, with the barcode they scan, is
        produced by the carrier and still has to go on alongside this one.
      </p>
    </div>
  );
}
