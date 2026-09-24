"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Truck,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  acceptTagOrder,
  fetchUnitKey,
  getProvisioningQueue,
  markUnitFailed,
  recordUnitWritten,
  dispatchShipment,
  markShipmentDelivered,
  recordUnitReturn,
  replaceUnit,
  verifyUnit,
} from "@/server/tagServer/provisioning";
import { CARRIERS } from "@/data/carriers";
import { ORDER_STATUS_LABEL } from "@/lib/tagOrderStatus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Programming chips for an order.
 *
 * The one screen that ever shows a live key, which is why it shows exactly one
 * at a time and only until the chip is written. The key is held in component
 * state and never persisted anywhere on this machine.
 */
const STATUS_STYLE = {
  keyed: "bg-amber-100 text-amber-800",
  written: "bg-sky-100 text-sky-800",
  verified: "bg-green-100 text-green-800",
  shipped: "bg-neutral-100 text-neutral-600",
  returned: "bg-orange-100 text-orange-800",
  replaced: "bg-neutral-100 text-neutral-400 line-through",
  failed: "bg-red-100 text-red-800",
  pending: "bg-neutral-100 text-neutral-600",
};

export default function ProvisioningStation() {
  const queryClient = useQueryClient();
  const { data: orders = [], isLoading } = useFetchSelectQuery({
    queryKey: ["provisioningQueue"],
    fetchFn: getProvisioningQueue,
  });

  const [openOrder, setOpenOrder] = React.useState("");
  // The live key, for one unit, until its chip is written. Never stored.
  const [liveKey, setLiveKey] = React.useState(null);
  const [uid, setUid] = React.useState("");
  // Per-order dispatch form. Keyed by order number so switching orders does
  // not carry one order's tracking reference onto another's parcel.
  const [dispatch, setDispatch] = React.useState({});
  const setDispatchField = (orderNumber, key, value) =>
    setDispatch((d) => ({
      ...d,
      [orderNumber]: { ...(d[orderNumber] || {}), [key]: value },
    }));

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["provisioningQueue"] });

  const run = (promise, onOk) =>
    promise.then((res) => {
      if (!res?.success) {
        toast.error(res?.message || "That did not work");
        return;
      }
      toast.success(res.message);
      onOk?.(res);
      refresh();
    });

  const { mutate: act, isPending } = useMutation({
    mutationFn: ({ kind, ...args }) => {
      if (kind === "accept") return run(acceptTagOrder(args));
      if (kind === "written")
        return run(recordUnitWritten(args), () => {
          setLiveKey(null);
          setUid("");
        });
      if (kind === "verify") return run(verifyUnit(args), () => setUid(""));
      if (kind === "failed") return run(markUnitFailed(args), () => setLiveKey(null));
      if (kind === "dispatch")
        return run(dispatchShipment(args), () =>
          setDispatch((d) => ({ ...d, [args.orderNumber]: {} })),
        );
      if (kind === "delivered") return run(markShipmentDelivered(args));
      if (kind === "return") return run(recordUnitReturn(args));
      if (kind === "replace") return run(replaceUnit(args));
      return Promise.resolve();
    },
  });

  const getKey = async (orderNumber, index) => {
    const res = await fetchUnitKey({ orderNumber, index });
    if (!res?.success) {
      toast.error(res?.message || "Could not issue that key");
      return;
    }
    setLiveKey(JSON.parse(res.data));
    refresh();
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tag Provisioning</h1>
        <p className="text-sm text-muted-foreground">
          Keys are generated here and never leave the server in any other way.
          A chip that has not verified does not ship.
        </p>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nothing in the queue.
          </CardContent>
        </Card>
      ) : null}

      {orders.map((order) => {
        const isOpen = openOrder === order.orderNumber;
        const units = order.units || [];
        const verified = units.filter((u) =>
          ["verified", "shipped"].includes(u.status),
        ).length;
        // Ready to go in a box right now: verified and not already sent.
        const readyToSend = units.filter((u) => u.status === "verified").length;
        // Still owed to the customer, whatever state they are in.
        const outstanding = units.filter(
          (u) => !["shipped", "replaced"].includes(u.status),
        ).length;
        const form = dispatch[order.orderNumber] || {};

        return (
          <Card key={order.orderNumber}>
            <CardHeader
              className="cursor-pointer"
              onClick={() => setOpenOrder(isOpen ? "" : order.orderNumber)}
            >
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Package className="size-4 text-muted-foreground" />
                  {order.orderNumber}
                  <span className="text-sm font-normal text-muted-foreground">
                    {order.companyName}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {order.status}
                  {units.length ? ` · ${verified}/${units.length} verified` : ""}
                </span>
              </CardTitle>
              <CardDescription>
                {order.items
                  ?.map((i) => `${i.quantity} × ${i.productName}`)
                  .join(", ")}
                {order.shippingAddress ? ` → ${order.shippingAddress}` : ""}
              </CardDescription>
            </CardHeader>

            {isOpen ? (
              <CardContent className="space-y-3">
                {order.status === "placed" ? (
                  <Button
                    disabled={isPending}
                    onClick={() =>
                      act({ kind: "accept", orderNumber: order.orderNumber })
                    }
                  >
                    Accept &amp; generate keys
                  </Button>
                ) : null}

                {liveKey ? (
                  <div className="space-y-2 rounded-md border-2 border-amber-300 bg-amber-50 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                      <KeyRound className="size-4" />
                      Key for unit {liveKey.index}
                    </p>
                    <code className="block break-all rounded bg-white p-2 font-mono text-sm">
                      {liveKey.key}
                    </code>
                    <p className="text-xs text-amber-800">
                      Write this to the chip, then read its UID back below. It
                      will not be shown again — if the write fails, mark the
                      unit failed and a new key is issued.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="UID read from the chip"
                        value={uid}
                        onChange={(e) => setUid(e.target.value)}
                      />
                      <Button
                        disabled={isPending || !uid.trim()}
                        onClick={() =>
                          act({
                            kind: "written",
                            orderNumber: order.orderNumber,
                            index: liveKey.index,
                            uid,
                          })
                        }
                      >
                        Written
                      </Button>
                      <Button
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          act({
                            kind: "failed",
                            orderNumber: order.orderNumber,
                            index: liveKey.index,
                            reason: "Write failed at the station",
                          })
                        }
                      >
                        Failed
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-1">
                  {units.map((unit) => (
                    <div
                      key={unit.index}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-8 text-muted-foreground">
                          #{unit.index}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            STATUS_STYLE[unit.status] || ""
                          }`}
                        >
                          {unit.status}
                        </span>
                        {unit.uid ? (
                          <code className="text-xs text-muted-foreground">
                            {unit.uid}
                          </code>
                        ) : null}
                        {unit.shipmentRef ? (
                          <span className="text-[11px] text-muted-foreground">
                            in {unit.shipmentRef}
                          </span>
                        ) : null}
                        {unit.replacesIndex != null ? (
                          <span className="text-[11px] text-muted-foreground">
                            replaces #{unit.replacesIndex}
                          </span>
                        ) : null}
                        {unit.replacedByIndex != null ? (
                          <span className="text-[11px] text-muted-foreground">
                            replaced by #{unit.replacedByIndex}
                          </span>
                        ) : null}
                        {unit.returnReason ? (
                          <span className="text-[11px] text-orange-700">
                            {unit.returnReason}
                          </span>
                        ) : null}
                        {unit.failureReason ? (
                          <span className="flex items-center gap-1 text-[11px] text-red-600">
                            <AlertTriangle className="size-3" />
                            {unit.failureReason}
                          </span>
                        ) : null}
                      </span>

                      <span className="flex gap-2">
                        {/* A shipped tag that comes back dead. Retiring the
                            ClockTag is the half that matters: left active it
                            is a tag nobody can account for. */}
                        {unit.status === "shipped" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                `Why is unit #${unit.index} coming back?`,
                                "Dead on arrival",
                              );
                              if (reason === null) return;
                              act({
                                kind: "return",
                                orderNumber: order.orderNumber,
                                index: unit.index,
                                reason,
                              });
                            }}
                          >
                            <Undo2 className="mr-1 size-3.5" />
                            Returned
                          </Button>
                        ) : null}
                        {unit.status === "returned" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              act({
                                kind: "replace",
                                orderNumber: order.orderNumber,
                                index: unit.index,
                              })
                            }
                          >
                            <RefreshCw className="mr-1 size-3.5" />
                            Send a replacement
                          </Button>
                        ) : null}
                        {unit.status === "keyed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => getKey(order.orderNumber, unit.index)}
                          >
                            <KeyRound className="mr-1 size-3.5" />
                            Get key
                          </Button>
                        ) : null}
                        {unit.status === "written" ? (
                          <span className="flex gap-1">
                            <Input
                              className="h-8 w-44"
                              placeholder="Tap to verify — UID"
                              value={uid}
                              onChange={(e) => setUid(e.target.value)}
                            />
                            <Button
                              size="sm"
                              disabled={isPending || !uid.trim()}
                              onClick={() =>
                                act({
                                  kind: "verify",
                                  orderNumber: order.orderNumber,
                                  index: unit.index,
                                  uid,
                                })
                              }
                            >
                              <CheckCircle2 className="mr-1 size-3.5" />
                              Verify
                            </Button>
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Shipments already sent, each with its own reference. */}
                {order.shipments?.length ? (
                  <div className="space-y-1 rounded-md border p-2">
                    <p className="text-xs font-medium">Shipments</p>
                    {order.shipments.map((s) => (
                      <div
                        key={s.reference}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-muted-foreground">
                          <strong className="text-foreground">
                            {s.reference}
                          </strong>{" "}
                          · {s.unitIndexes?.length || 0} tag(s) ·{" "}
                          {CARRIERS.find((c) => c.key === s.carrier)?.name ||
                            s.carrier}
                          {s.trackingRef ? ` · ${s.trackingRef}` : ""}
                          {s.parcelCount > 1 ? ` · ${s.parcelCount} parcels` : ""}
                        </span>
                        <span className="flex items-center gap-2">
                          {/* Opened in a new tab: the operator prints while
                              packing and comes back to the station, rather
                              than losing their place in the queue. */}
                          <a
                            href={`/platform/tags/label?order=${encodeURIComponent(
                              order.orderNumber,
                            )}&shipment=${encodeURIComponent(s.reference)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button size="sm" variant="outline" className="h-7">
                              <Printer className="mr-1 size-3.5" />
                              Label
                            </Button>
                          </a>
                        {s.deliveredAt ? (
                          <span className="text-green-700">
                            delivered{" "}
                            {new Date(s.deliveredAt).toLocaleDateString("en-GB")}
                            {s.deliveredSource === "customer"
                              ? " (confirmed by the customer)"
                              : ""}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              act({
                                kind: "delivered",
                                orderNumber: order.orderNumber,
                                reference: s.reference,
                              })
                            }
                          >
                            Mark delivered
                          </Button>
                        )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Dispatch. Ships whatever has verified and not yet gone,
                    rather than refusing until every unit is ready — that rule
                    belongs on the tag, not on the customer waiting for the
                    ones that work. */}
                {readyToSend > 0 ? (
                  <div className="space-y-2 rounded-md border p-2">
                    <p className="text-xs font-medium">
                      Dispatch {readyToSend} verified tag(s)
                      {outstanding > readyToSend
                        ? ` — ${outstanding - readyToSend} not ready yet`
                        : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={form.carrier || "royal-mail"}
                        onValueChange={(v) =>
                          setDispatchField(order.orderNumber, "carrier", v)
                        }
                      >
                        <SelectTrigger className="h-8 w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CARRIERS.map((c) => (
                            <SelectItem key={c.key} value={c.key}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8 w-52"
                        placeholder="Tracking reference"
                        value={form.trackingRef || ""}
                        onChange={(e) =>
                          setDispatchField(
                            order.orderNumber,
                            "trackingRef",
                            e.target.value,
                          )
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        className="h-8 w-20"
                        placeholder="Parcels"
                        value={form.parcelCount || ""}
                        onChange={(e) =>
                          setDispatchField(
                            order.orderNumber,
                            "parcelCount",
                            e.target.value,
                          )
                        }
                      />
                      <Button
                        disabled={isPending}
                        onClick={() =>
                          act({
                            kind: "dispatch",
                            orderNumber: order.orderNumber,
                            carrier: form.carrier || "royal-mail",
                            trackingRef: form.trackingRef || "",
                            parcelCount: Number(form.parcelCount) || 1,
                          })
                        }
                      >
                        <Truck className="mr-1 size-4" />
                        Dispatch
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      A carrier with no tracking page still works — the
                      customer sees the reference as plain text rather than a
                      link that goes nowhere.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
