"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Loader2, Plus, Wifi, X } from "lucide-react";
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
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getPosition } from "@/lib/clockEvidence";
import { getClockLocations } from "@/server/clockServer/locations";
import { getMyClientIp, setLocationPolicy } from "@/server/clockServer/evidenceReport";

/**
 * Turning a location's rules on.
 *
 * Without this screen the rest of the feature is inert: a location with no
 * methods is never evaluated, so nothing is recorded and the report has
 * nothing to show. Shadow mode is the default choice here on purpose — it
 * measures without refusing anybody, which is the only honest way to pick a
 * radius.
 *
 * The two buttons are the point. Nobody knows their site's coordinates or
 * their office's public IP, and asking them to find out is how a feature goes
 * unused. Stand at the gate, tap "Use where I am now". Sit in the office, tap
 * "Use the address I'm on".
 */

const METHODS = [
  {
    type: "geofence",
    label: "Location (GPS)",
    blurb:
      "Checks the phone's position against the pin below. The only method that needs nothing at the location itself.",
  },
  {
    type: "network",
    label: "Office network (IP)",
    blurb:
      "Checks the address the request came from. Proves which network, not which building — anyone on a VPN into it will pass.",
  },
];

const MODES = [
  { value: "off", label: "Off" },
  { value: "shadow", label: "Measure only" },
  { value: "enforce", label: "Enforce" },
];

export default function ClockLocationRules() {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useFetchSelectQuery({
    queryKey: ["clockLocations"],
    fetchFn: getClockLocations,
  });

  const [selectedId, setSelectedId] = React.useState("");
  const [draft, setDraft] = React.useState(null);
  const [locating, setLocating] = React.useState(false);

  const selected = locations.find((l) => l._id === selectedId) || null;

  // The draft is seeded from whichever location is picked; until someone
  // edits, it mirrors what is saved.
  const value = draft ?? {
    lat: selected?.geofence?.lat ?? "",
    lng: selected?.geofence?.lng ?? "",
    radiusMetres: selected?.geofence?.radiusMetres ?? 150,
    networks: selected?.networks ?? [],
    methods: selected?.methods ?? [],
    requireAll: selected?.requireAll ?? false,
  };

  const pick = (id) => {
    setSelectedId(id);
    setDraft(null);
  };
  const set = (patch) => setDraft({ ...value, ...patch });

  const modeOf = (type) =>
    value.methods.find((m) => m.type === type)?.mode || "off";

  const setMode = (type, mode) => {
    const rest = value.methods.filter((m) => m.type !== type);
    set({ methods: mode === "off" ? rest : [...rest, { type, mode }] });
  };

  const useMyPosition = async () => {
    setLocating(true);
    try {
      const pos = await getPosition();
      if (!pos) {
        toast.error(
          "Could not get a position. Allow location access and try again — this only works on the device that is at the site.",
        );
        return;
      }
      set({ lat: pos.lat, lng: pos.lng });
      toast.success(`Pin set, accurate to about ${pos.accuracyMetres}m.`);
    } finally {
      setLocating(false);
    }
  };

  const useMyAddress = async () => {
    const res = await getMyClientIp();
    if (!res?.success) {
      toast.error(res?.message || "Could not read your address");
      return;
    }
    const { suggestion } = JSON.parse(res.data);
    if (value.networks.includes(suggestion)) {
      toast.info("That address is already on the list.");
      return;
    }
    set({ networks: [...value.networks, suggestion] });
  };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () =>
      setLocationPolicy({
        id: selectedId,
        geofence:
          value.lat === "" || value.lng === ""
            ? null
            : {
                lat: Number(value.lat),
                lng: Number(value.lng),
                radiusMetres: Number(value.radiusMetres),
              },
        networks: value.networks,
        methods: value.methods,
        requireAll: value.requireAll,
      }).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not save");
          return;
        }
        toast.success(res.message);
        setDraft(null);
        queryClient.invalidateQueries({ queryKey: ["clockLocations"] });
        queryClient.invalidateQueries({ queryKey: ["clockEvidenceReport"] });
      }),
  });

  const anyOn = value.methods.length > 0;
  const enforcing = value.methods.some((m) => m.mode === "enforce");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules per Location</CardTitle>
        <CardDescription>
          How each place checks that someone is really there. Start on{" "}
          <strong>Measure only</strong>: it records what the rule <em>would</em>{" "}
          have decided without refusing anybody, so you can pick a radius from
          what actually happens rather than from a guess. The report below shows
          the result.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Select value={selectedId} onValueChange={pick}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Pick a location to set up" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l._id} value={l._id}>
                      {l.name}
                      {l.methods?.length ? "  ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!selected ? null : (
              <div className="space-y-4 rounded-md border p-3">
                {!anyOn ? (
                  <p className="rounded border border-dashed bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600">
                    Nothing is being checked or measured at{" "}
                    <strong>{selected.name}</strong> yet. Switch a method to
                    Measure only to start collecting data for the report.
                  </p>
                ) : null}

                {METHODS.map((m) => (
                  <div key={m.type} className="space-y-2 border-t pt-3 first:border-0 first:pt-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm">{m.label}</Label>
                        <p className="text-xs text-neutral-500">{m.blurb}</p>
                      </div>
                      <Select
                        value={modeOf(m.type)}
                        onValueChange={(v) => setMode(m.type, v)}
                      >
                        <SelectTrigger className="w-36 flex-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODES.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {m.type === "geofence" && modeOf("geofence") !== "off" ? (
                      <div className="space-y-2 rounded bg-neutral-50 p-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={locating}
                          onClick={useMyPosition}
                        >
                          {locating ? (
                            <Loader2 className="mr-1 size-3.5 animate-spin" />
                          ) : (
                            <Crosshair className="mr-1 size-3.5" />
                          )}
                          Use where I am now
                        </Button>
                        <p className="text-[11px] text-neutral-500">
                          Tap this standing at the location. Typing coordinates
                          in from a map is possible but that is not where the
                          gate is.
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label htmlFor="geofenceLat" className="text-[11px]">Latitude</Label>
                            <Input
                              id="geofenceLat"
                              value={value.lat}
                              onChange={(e) => set({ lat: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="geofenceLng" className="text-[11px]">Longitude</Label>
                            <Input
                              id="geofenceLng"
                              value={value.lng}
                              onChange={(e) => set({ lng: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="geofenceRadius" className="text-[11px]">Radius (m)</Label>
                            <Input
                              id="geofenceRadius"
                              type="number"
                              min={10}
                              max={5000}
                              value={value.radiusMetres}
                              onChange={(e) =>
                                set({ radiusMetres: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {m.type === "network" && modeOf("network") !== "off" ? (
                      <div className="space-y-2 rounded bg-neutral-50 p-2">
                        <Button size="sm" variant="outline" onClick={useMyAddress}>
                          <Wifi className="mr-1 size-3.5" />
                          Use the address I&apos;m on
                        </Button>
                        <p className="text-[11px] text-neutral-500">
                          Do this from the office, on the office network. A
                          broadband address can change without warning — if
                          everyone is suddenly refused one morning, this is the
                          first thing to check.
                        </p>
                        <div className="space-y-1">
                          {value.networks.map((n, i) => (
                            <div key={`${n}-${i}`} className="flex gap-1">
                              <Input
                                value={n}
                                onChange={(e) => {
                                  const next = [...value.networks];
                                  next[i] = e.target.value;
                                  set({ networks: next });
                                }}
                              />
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() =>
                                  set({
                                    networks: value.networks.filter(
                                      (_, j) => j !== i,
                                    ),
                                  })
                                }
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              set({ networks: [...value.networks, ""] })
                            }
                          >
                            <Plus className="mr-1 size-3.5" />
                            Add a range by hand
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}

                {value.methods.length > 1 ? (
                  <div className="flex items-start justify-between gap-3 border-t pt-3">
                    <div className="space-y-0.5">
                      <Label className="text-sm">
                        Require every method, not just one
                      </Label>
                      <p className="text-xs text-neutral-500">
                        Off is usually right: someone at the gate on mobile data
                        fails the network check and passes the location one, and
                        they are still at the gate.
                      </p>
                    </div>
                    <Select
                      value={value.requireAll ? "all" : "any"}
                      onValueChange={(v) => set({ requireAll: v === "all" })}
                    >
                      <SelectTrigger className="w-28 flex-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any one</SelectItem>
                        <SelectItem value="all">All of them</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {/* The question this card cannot answer on its own: having
                    switched something to Measure only, where does the
                    measurement show up? Saying so here beats expecting anyone
                    to scroll and guess. */}
                {anyOn && !enforcing ? (
                  <p className="rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-800">
                    Measuring, refusing nobody. The results appear in{" "}
                    <strong>Where People Clock In</strong>, just below — give it
                    a few days of real clock-ins before reading anything into
                    them.
                  </p>
                ) : null}

                {enforcing ? (
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    Enforcing: someone this rule refuses <strong>cannot</strong>{" "}
                    clock in here. Check the report first, and make sure a
                    manager can record attendance for them if it goes wrong.
                  </p>
                ) : null}

                <Button disabled={saving || !draft} onClick={() => save()}>
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Save location rules
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
