"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useTerms } from "@/app/admin/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  addStarterRotaCategories,
  getRotaCategories,
  removeRotaCategory,
  saveRotaCategory,
} from "@/server/weeklyRotaServer/rotaCategoryServer";

/**
 * "Shift types": the choices on the weekly rota, and what each one means
 * (lib/rotaCategories.js) — not working, working, or working at one of the
 * company's sites / branches / classes — with the hours it fills in.
 *
 * Replaces a form that took a name and a "value" and left their meaning to
 * whatever the screens happened to check for.
 */

const EMPTY = { id: null, name: "", kind: "work", startTime: "09:00", endTime: "17:00", description: "" };

export default function AddCategory() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTerms();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["rotaCategories"],
    enabled: open,
    queryFn: async () => {
      const res = await getRotaCategories();
      return res?.success ? JSON.parse(res.data) : [];
    },
  });

  const kinds = {
    work: { label: "Working", text: "Start and end times." },
    place: {
      label: `Working at a ${t("site").toLowerCase()}`,
      text: `Times, and which ${t("site").toLowerCase()} — chosen on the rota.`,
    },
    off: { label: "Not working", text: "No hours." },
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rotaCategories"] });
    // The rota's own dropdown.
    queryClient.invalidateQueries({ queryKey: ["selectCategories"] });
  };

  const act = async (fn) => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res?.success) return toast.error(res?.message || "That did not work");
      toast.success(res.message);
      setForm(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    act(() =>
      saveRotaCategory({
        ...form,
        startTime: form.kind === "off" ? "" : form.startTime,
        endTime: form.kind === "off" ? "" : form.endTime,
      })
    );

  return (
    <>
      <Button variant="outline" className="border-neutral-300" onClick={() => setOpen(true)}>
        Shift types
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setForm(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <div className="flex flex-col gap-1">
            <DialogTitle>Shift types</DialogTitle>
            <DialogDescription>
              The choices on the rota for each day, and what each one means.
            </DialogDescription>
          </div>

          {form ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="st-name">Name</Label>
                <Input
                  id="st-name"
                  value={form.name}
                  placeholder="e.g. Work from home"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>What it means</Label>
                <RadioGroup
                  value={form.kind}
                  onValueChange={(kind) => setForm({ ...form, kind })}
                  className="gap-2"
                >
                  {Object.entries(kinds).map(([key, k]) => (
                    <Label
                      key={key}
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem value={key} className="mt-0.5" />
                      <span>
                        <span className="block font-medium">{k.label}</span>
                        <span className="block text-xs text-muted-foreground">{k.text}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>
              {form.kind !== "off" && (
                <div className="flex flex-wrap gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="st-start">Usual start</Label>
                    <Input
                      id="st-start"
                      type="time"
                      className="w-32"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="st-end">Usual end</Label>
                    <Input
                      id="st-end"
                      type="time"
                      className="w-32"
                      value={form.endTime}
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="st-desc">Description (optional)</Label>
                <Input
                  id="st-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button disabled={busy || !form.name.trim()} onClick={save}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {form.id ? "Save" : "Add"}
                </Button>
                <Button variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {isLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </p>
              ) : categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None yet. Start with the usual set — Office, Office / {t("site")} and Off — and
                  change them to suit.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {categories.map((c) => (
                    <li key={c._id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <Badge variant="outline" className="mr-1.5">
                            {kinds[c.kind]?.label || c.kind}
                          </Badge>
                          {c.kind !== "off" && c.startTime && c.endTime
                            ? `${c.startTime}–${c.endTime}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Edit ${c.name}`}
                          onClick={() =>
                            setForm({
                              id: c._id,
                              name: c.name,
                              kind: c.kind || "work",
                              startTime: c.startTime || "09:00",
                              endTime: c.endTime || "17:00",
                              description: c.description,
                            })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${c.name}`}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Remove ${c.name}? Rotas already saved keep it.`)) {
                              act(() => removeRotaCategory(c._id));
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setForm(EMPTY)}>
                  <Plus className="size-4" />
                  Add a shift type
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act(addStarterRotaCategories)}>
                  {categories.length ? "Add any missing usual ones" : "Use the usual set"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
