"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Eye,
  EyeOff,
  Loader2,
  PackagePlus,
  Plus,
  Save,
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
import {
  getCatalogueDemand,
  getCatalogueProducts,
  saveTagProduct,
  setTagProductActive,
} from "@/server/tagServer/catalogue";
import {
  adjustStock,
  getStockLevels,
  receiveStock,
} from "@/server/tagServer/stock";

/**
 * Maintaining the tag catalogue.
 *
 * A price change applies to orders placed afterwards. Orders already placed
 * keep the price they were quoted — the unit price is copied onto the order
 * line — so nothing here can re-price somebody's invoice after the fact.
 */
const BLANK = {
  sku: "",
  name: "",
  formFactor: "round",
  chipType: "ntag213",
  onMetal: false,
  weatherproof: false,
  unitPrice: "",
  currency: "GBP",
  minQuantity: 10,
  leadTimeDays: 7,
  weightGrams: 0,
  description: "",
};

export default function CatalogueEditor() {
  const queryClient = useQueryClient();
  const { data: products = [], isLoading } = useFetchSelectQuery({
    queryKey: ["catalogueProducts"],
    fetchFn: getCatalogueProducts,
  });
  const { data: demand = [] } = useFetchSelectQuery({
    queryKey: ["catalogueDemand"],
    fetchFn: getCatalogueDemand,
  });

  const soldBySku = new Map(demand.map((d) => [d._id, d]));

  // Blanks on the shelf. Separate from the catalogue row because stock is a
  // fact about our warehouse and the catalogue is a fact about what we sell —
  // the same product can be orderable and out of stock.
  const { data: stock = [] } = useFetchSelectQuery({
    queryKey: ["tagStock"],
    fetchFn: getStockLevels,
  });
  const stockBySku = new Map(stock.map((s) => [s.sku, s]));

  const refreshStock = () =>
    queryClient.invalidateQueries({ queryKey: ["tagStock"] });

  const { mutate: receive, isPending: receiving } = useMutation({
    mutationFn: (args) =>
      receiveStock(args).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not record that delivery");
          return;
        }
        toast.success(res.message);
        refreshStock();
      }),
  });

  const { mutate: stocktake, isPending: counting } = useMutation({
    mutationFn: (args) =>
      adjustStock(args).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not adjust that count");
          return;
        }
        toast.success(res.message);
        refreshStock();
      }),
  });
  const [editing, setEditing] = React.useState(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["catalogueProducts"] });
    // The customer-facing list is the same data.
    queryClient.invalidateQueries({ queryKey: ["tagProducts"] });
  };

  const run = (promise, onOk) =>
    promise.then((res) => {
      if (!res?.success) {
        toast.error(res?.message || "That did not work");
        return;
      }
      toast.success(res.message);
      onOk?.();
      refresh();
    });

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => run(saveTagProduct(editing), () => setEditing(null)),
  });
  const { mutate: toggle, isPending: toggling } = useMutation({
    mutationFn: ({ id, isActive }) => run(setTagProductActive({ id, isActive })),
  });

  const busy = saving || toggling;
  const set = (patch) => setEditing({ ...editing, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tag Catalogue</h1>
          <p className="text-sm text-muted-foreground">
            What customers can order, and what it costs them. Changing a price
            affects future orders only.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...BLANK })} disabled={busy}>
          <Plus className="mr-1 size-4" />
          Add product
        </Button>
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editing._id ? `Edit ${editing.sku}` : "New product"}
            </CardTitle>
            <CardDescription>
              On-metal tags are ferrite-backed. An ordinary tag on bare steel
              does not work at all, and site cabins usually are steel — the
              ordering screen filters on this.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={editing.sku}
                  disabled={Boolean(editing._id)}
                  onChange={(e) => set({ sku: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pname">Name</Label>
                <Input
                  id="pname"
                  value={editing.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Shape</Label>
                <Select
                  value={editing.formFactor}
                  onValueChange={(v) => set({ formFactor: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["round", "card", "keyfob", "sticker", "wristband"].map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Chip</Label>
                <Select
                  value={editing.chipType}
                  onValueChange={(v) => set({ chipType: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ntag213">NTAG213 — plain</SelectItem>
                    <SelectItem value="ntag424">
                      NTAG 424 DNA — signed taps
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">Unit price</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min={0}
                  value={editing.unitPrice}
                  onChange={(e) => set({ unitPrice: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minq">Minimum order</Label>
                <Input
                  id="minq"
                  type="number"
                  min={1}
                  value={editing.minQuantity}
                  onChange={(e) => set({ minQuantity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead">Lead time (days)</Label>
                <Input
                  id="lead"
                  type="number"
                  min={0}
                  value={editing.leadTimeDays}
                  onChange={(e) => set({ leadTimeDays: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight">Weight, one tag (g)</Label>
                <Input
                  id="weight"
                  type="number"
                  min={0}
                  value={editing.weightGrams ?? 0}
                  onChange={(e) => set({ weightGrams: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Postage is priced on weight. Left at zero, a label cannot be
                  bought for this product — which is better than guessing and
                  being surcharged.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  value={editing.currency}
                  onChange={(e) => set({ currency: e.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={editing.onMetal}
                  onCheckedChange={(v) => set({ onMetal: v })}
                />
                Works on metal
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={editing.weatherproof}
                  onCheckedChange={(v) => set({ weatherproof: v })}
                />
                Weatherproof
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pdesc">Description</Label>
              <Input
                id="pdesc"
                placeholder="What a customer needs to know before choosing it"
                value={editing.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>

            <div className="flex gap-2">
              <Button
                disabled={busy || !editing.sku || !editing.name}
                onClick={() => save()}
              >
                {saving ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1 size-4" />
                )}
                Save
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {products.map((p) => {
            const sold = soldBySku.get(p.sku);
            const level = stockBySku.get(p.sku);
            return (
              <Card key={p._id} className={p.isActive ? "" : "opacity-60"}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {p.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {p.sku}
                      </span>
                      {!p.isActive ? (
                        <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px]">
                          withdrawn
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.chipType} · {p.formFactor}
                      {p.onMetal ? " · on-metal" : ""}
                      {p.weatherproof ? " · weatherproof" : ""} · min{" "}
                      {p.minQuantity} · {p.leadTimeDays}d
                      {/* The question a price change raises. */}
                      {sold ? ` · sold ${sold.units} on ${sold.orders} order(s)` : ""}
                    </p>
                    {/* Three numbers, not one. "On hand" alone is how twenty
                        blanks with eighteen already promised reads as twenty
                        available, and the next customer waits a fortnight. */}
                    {level ? (
                      <p className="text-xs">
                        <span
                          className={
                            level.short
                              ? "font-medium text-red-700"
                              : level.low
                                ? "font-medium text-amber-700"
                                : "text-muted-foreground"
                          }
                        >
                          {level.stockOnHand} on hand
                          {level.committed
                            ? ` · ${level.committed} promised · ${level.available} free`
                            : ""}
                        </span>
                        {level.short ? (
                          <span className="ml-1 text-red-700">
                            — short by {Math.abs(level.available)}, lead time{" "}
                            {p.leadTimeDays} days
                          </span>
                        ) : level.low ? (
                          <span className="ml-1 text-amber-700">
                            — at or below the reorder level of{" "}
                            {level.reorderLevel}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={receiving || counting}
                      title="A delivery of blanks arrived"
                      onClick={() => {
                        const qty = window.prompt(
                          `How many ${p.sku} blanks arrived?`,
                        );
                        if (qty === null) return;
                        receive({ sku: p.sku, quantity: Number(qty) });
                      }}
                    >
                      <PackagePlus className="mr-1 size-3.5" />
                      Receive
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={receiving || counting}
                      title="A stocktake: what did you actually count?"
                      onClick={() => {
                        // Asks for the counted total, not a difference. A
                        // person at a shelf knows what they counted; making
                        // them subtract turns a correction into a second error.
                        const counted = window.prompt(
                          `Counted total for ${p.sku}? (currently holding ${
                            level?.stockOnHand ?? 0
                          })`,
                          String(level?.stockOnHand ?? 0),
                        );
                        if (counted === null) return;
                        stocktake({ sku: p.sku, countedTotal: Number(counted) });
                      }}
                    >
                      <ClipboardCheck className="mr-1 size-3.5" />
                      Stocktake
                    </Button>
                    <span className="text-sm font-semibold">
                      {formatCurrency(p.unitPrice, p.currency)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          ...p,
                          // `id`, not `_id`: that is what saveTagProduct reads
                          // to tell an edit from a new product. Without it an
                          // edit takes the create path and collides on the SKU.
                          id: p._id,
                          unitPrice: String(p.unitPrice),
                          description: p.description || "",
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title={
                        p.isActive
                          ? "Withdraw from sale — existing orders are unaffected"
                          : "Put back on sale"
                      }
                      disabled={busy}
                      onClick={() => toggle({ id: p._id, isActive: !p.isActive })}
                    >
                      {p.isActive ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
