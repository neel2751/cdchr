"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Package, ShoppingCart } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { formatCurrency } from "@/utils/time";
import { getTagOrders, getTagProducts, placeTagOrder } from "@/server/tagServer/orders";
import { markShipmentDelivered } from "@/server/tagServer/provisioning";
import { ORDER_STATUS_LABEL } from "@/lib/tagOrderStatus";
import { isValidUkPostcode, normalisePostcode } from "@/lib/postcode";
import { lookupPostcode } from "@/server/addressServer/postcode";
import {
  addressLookupAvailable,
  findAddresses,
} from "@/server/addressServer/paf";

/**
 * Ordering NFC tags.
 *
 * Nothing about keys appears here, on purpose. They are generated during
 * fulfilment and never leave the server — a key a customer can read is a key
 * they can leak, and one they can lose is a support call whose only remedy is
 * re-provisioning hardware. The customer's mental model is "I ordered twenty
 * tags and they work".
 *
 * The mounting-surface question is the most valuable field on this form. NFC
 * does not work on bare metal, and site cabins are usually steel — twenty
 * plain discs for steel cabins is twenty things that do not work, reported
 * later as a software bug.
 */
export default function TagOrderSettings() {
  const queryClient = useQueryClient();
  const { data: products = [], isLoading } = useFetchSelectQuery({
    queryKey: ["tagProducts"],
    fetchFn: getTagProducts,
  });
  const { data: orders = [] } = useFetchSelectQuery({
    queryKey: ["tagOrders"],
    fetchFn: getTagOrders,
  });

  // Confirming receipt is the customer's own word that the box is in their
  // hands, which is a different claim from us marking it sent.
  const { mutate: confirm, isPending: confirming } = useMutation({
    mutationFn: (args) =>
      markShipmentDelivered(args).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not update that shipment");
          return;
        }
        toast.success(res.message);
        queryClient.invalidateQueries({ queryKey: ["tagOrders"] });
      }),
  });

  const [onMetal, setOnMetal] = React.useState(false);
  const [sku, setSku] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [address, setAddress] = React.useState("");
  // The parts a postage label needs. Asked for rather than picked out of the
  // free-text address: guessing which line is the town delivers the parcel
  // somewhere else, quietly.
  const [shipTo, setShipTo] = React.useState({
    name: "",
    line1: "",
    line2: "",
    city: "",
    postcode: "",
    countryCode: "GB",
  });
  const setPart = (key) => (e) =>
    setShipTo((s) => ({ ...s, [key]: e.target.value }));

  // What the national list says about the postcode typed. Checked on blur
  // rather than on every keystroke: a half-typed postcode is not wrong yet,
  // and saying so while somebody is still typing is just noise.
  const [postcodeCheck, setPostcodeCheck] = React.useState(null);

  // Address lookup is a licensed extra. The button only appears when we have
  // a licence switched on; without one the form is exactly what it was, and
  // the address is typed.
  const { data: lookupState } = useFetchSelectQuery({
    queryKey: ["addressLookupAvailable"],
    fetchFn: addressLookupAvailable,
  });
  const canLookUp = Boolean(lookupState?.available);

  const [found, setFound] = React.useState(null);
  const [finding, setFinding] = React.useState(false);

  // Every call is billable, so this is a button and never a keystroke.
  const findAtPostcode = async () => {
    setFinding(true);
    setFound(null);
    try {
      const res = await findAddresses({ postcode: shipTo.postcode });
      if (!res?.success) {
        toast.error(res?.message || "Could not look that postcode up");
        return;
      }
      const { addresses } = JSON.parse(res.data);
      if (!addresses.length) {
        toast.message("No addresses found on that postcode — type it in.");
        return;
      }
      setFound(addresses);
    } catch {
      toast.error("Could not look that postcode up");
    } finally {
      setFinding(false);
    }
  };

  const chooseAddress = (picked) => {
    setShipTo((s) => ({
      ...s,
      line1: picked.line1 || "",
      line2: picked.line2 || "",
      city: picked.city || "",
      postcode: picked.postcode || s.postcode,
    }));
    setFound(null);
    setPostcodeCheck(null);
  };
  const checkPostcode = async () => {
    if (!shipTo.postcode.trim()) {
      setPostcodeCheck(null);
      return;
    }
    const tidy = normalisePostcode(shipTo.postcode);
    setShipTo((s) => ({ ...s, postcode: tidy }));
    try {
      const res = await lookupPostcode({ postcode: tidy, town: shipTo.city });
      setPostcodeCheck(res?.success ? JSON.parse(res.data) : null);
    } catch {
      // The checker is a convenience. Its absence must not break the form.
      setPostcodeCheck(null);
    }
  };

  // Only the format blocks. Whether it is in the national list is a warning,
  // because ONS data lags new building by months and a real new-build address
  // would otherwise be unorderable.
  const postcodeUsable =
    (shipTo.countryCode || "GB").toUpperCase() !== "GB" ||
    isValidUkPostcode(shipTo.postcode);

  const suitable = products.filter((p) => (onMetal ? p.onMetal : true));
  const chosen = products.find((p) => p.sku === sku) || null;

  const { mutate: order, isPending } = useMutation({
    mutationFn: () =>
      placeTagOrder({
        items: [{ productSku: sku, quantity: Number(quantity) }],
        shippingAddress: address,
        shipTo,
      }).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not place that order");
          return;
        }
        toast.success(res.message);
        setSku("");
        setQuantity("");
        queryClient.invalidateQueries({ queryKey: ["tagOrders"] });
      }),
  });

  const total =
    chosen && Number(quantity) > 0 ? chosen.unitPrice * Number(quantity) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="size-4 text-teal-600" />
          Order Tags
        </CardTitle>
        <CardDescription>
          NFC stickers for your sites and offices. They arrive ready to use —
          tap one at a door and pick where it is. We handle the security side;
          there is nothing for you to configure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Asked first, because it changes what can be bought at all. */}
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="onMetal" className="text-sm">
                  Mounting on metal?
                </Label>
                <p className="text-xs text-neutral-500">
                  Site cabins and containers usually are. An ordinary tag stuck
                  to bare metal does not work at all — the metal detunes it —
                  so this filters the list to the ones that do.
                </p>
              </div>
              <Switch id="onMetal" checked={onMetal} onCheckedChange={setOnMetal} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tag</Label>
                <Select value={sku} onValueChange={setSku}>
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        suitable.length ? "Choose a tag" : "None available"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {suitable.map((p) => (
                      <SelectItem key={p.sku} value={p.sku}>
                        {p.name} — {formatCurrency(p.unitPrice, p.currency)} each
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosen ? (
                  <p className="text-xs text-neutral-500">
                    Minimum {chosen.minQuantity}. About {chosen.leadTimeDays}{" "}
                    days.
                    {chosen.chipType === "ntag424"
                      ? " Each tap is uniquely signed, so a copied link is useless."
                      : " Pair these with the location check for sites."}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tagQuantity">How many</Label>
                <Input
                  id="tagQuantity"
                  type="number"
                  min={chosen?.minQuantity || 1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tagAddress">Deliver to</Label>
              <Input
                id="tagAddress"
                placeholder="Site office address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Delivery address</p>
              <p className="text-xs text-neutral-500">
                Asked for in parts because the postage label needs them that
                way. Splitting a typed address up is guesswork, and a wrong
                guess sends the parcel somewhere else.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Name for the parcel (optional)"
                  value={shipTo.name}
                  onChange={setPart("name")}
                />
                <Input
                  placeholder="Street and number"
                  value={shipTo.line1}
                  onChange={setPart("line1")}
                />
                <Input
                  placeholder="Address line 2 (optional)"
                  value={shipTo.line2}
                  onChange={setPart("line2")}
                />
                <Input
                  placeholder="Town or city"
                  value={shipTo.city}
                  onChange={setPart("city")}
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Postcode"
                    value={shipTo.postcode}
                    onChange={setPart("postcode")}
                    onBlur={checkPostcode}
                    aria-invalid={!postcodeUsable}
                  />
                  {canLookUp ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={finding || !postcodeUsable || !shipTo.postcode.trim()}
                      onClick={findAtPostcode}
                    >
                      {finding ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Find"
                      )}
                    </Button>
                  ) : null}
                </div>
                <Input
                  placeholder="Country code (GB)"
                  maxLength={2}
                  value={shipTo.countryCode}
                  onChange={setPart("countryCode")}
                />
              </div>

              {found?.length ? (
                <div className="space-y-1 rounded-md border bg-neutral-50 p-2">
                  <p className="text-xs font-medium">
                    {found.length} address(es) — pick one
                  </p>
                  <div className="max-h-44 overflow-y-auto">
                    {found.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-white"
                        onClick={() => chooseAddress(a)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!postcodeUsable && shipTo.postcode.trim() ? (
                <p className="text-xs text-red-600">
                  That is not a valid UK postcode. No carrier will accept it.
                </p>
              ) : postcodeCheck?.message ? (
                <p
                  className={`text-xs ${
                    postcodeCheck.known && postcodeCheck.townMatches !== false
                      ? "text-neutral-500"
                      : "text-amber-700"
                  }`}
                >
                  {postcodeCheck.message}
                </p>
              ) : null}
            </div>

            {total > 0 ? (
              <p className="rounded-md border bg-neutral-50 p-2 text-sm">
                {quantity} × {chosen.name} ={" "}
                <strong>{formatCurrency(total, chosen.currency)}</strong>
                <span className="block text-xs text-neutral-500">
                  We will confirm and invoice separately — nothing is charged
                  here.
                </span>
              </p>
            ) : null}

            <Button
              disabled={
                isPending ||
                !sku ||
                !Number(quantity) ||
                !address.trim() ||
                !shipTo.line1.trim() ||
                !shipTo.city.trim() ||
                !postcodeUsable
              }
              onClick={() => order()}
            >
              {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Place order
            </Button>

            {orders.length ? (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Your orders</p>
                {orders.slice(0, 5).map((o) => (
                  <div
                    key={o.orderNumber}
                    className="space-y-1.5 rounded border px-2 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Package className="size-3.5 text-neutral-400" />
                        {o.orderNumber}
                      </span>
                      <span className="text-neutral-500">
                        {o.unitCount
                          ? `${o.readyCount}/${o.unitCount} ready · `
                          : ""}
                        {ORDER_STATUS_LABEL[o.status] || o.status}
                      </span>
                    </div>

                    {/* One line per box, with a link where we have one. A bare
                        reference makes the customer work out whose site to
                        paste it into; that is what this replaces. */}
                    {o.shipments?.map((s) => (
                      <div
                        key={s.reference}
                        className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-neutral-600"
                      >
                        <span>
                          {s.unitCount} tag(s) · {s.carrierName}
                          {s.parcelCount > 1 ? ` · ${s.parcelCount} parcels` : ""}
                          {s.trackingRef ? (
                            <>
                              {" · "}
                              {s.trackingUrl ? (
                                <a
                                  href={s.trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-indigo-600 underline"
                                >
                                  {s.trackingRef}
                                  <ExternalLink className="size-3" />
                                </a>
                              ) : (
                                <code>{s.trackingRef}</code>
                              )}
                            </>
                          ) : null}
                        </span>

                        {s.deliveredAt ? (
                          <span className="text-green-700">
                            Delivered{" "}
                            {new Date(s.deliveredAt).toLocaleDateString("en-GB")}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            disabled={confirming}
                            onClick={() =>
                              confirm({
                                orderNumber: o.orderNumber,
                                reference: s.reference,
                              })
                            }
                          >
                            I have received this
                          </Button>
                        )}
                      </div>
                    ))}

                    {o.outstandingCount > 0 && o.shipments?.length ? (
                      <p className="border-t pt-1.5 text-neutral-500">
                        {o.outstandingCount} tag(s) still being made — they
                        follow in a later parcel.
                      </p>
                    ) : null}
                    {o.returnedCount > 0 ? (
                      <p className="text-orange-700">
                        {o.returnedCount} tag(s) returned or replaced.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
