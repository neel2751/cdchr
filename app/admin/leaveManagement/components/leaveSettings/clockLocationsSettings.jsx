"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  HardHat,
  Loader2,
  Plus,
  Star,
  TriangleAlert,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  archiveClockLocation,
  createClockLocation,
  getClockLocations,
  setDefaultLocation,
  updateClockLocation,
} from "@/server/clockServer/locations";

/**
 * The places people clock in at.
 *
 * Sites are not managed here. A site is a job — it has a type, a status and an
 * end date, and it lives on the Site Projects screen; creating one creates its
 * clock-in location automatically and renaming one renames it. Maintaining the
 * same name in two places is how the two drift apart.
 *
 * What this screen is actually for is the thing that had nowhere to live: an
 * **office**. Every office record used to be `siteId: null`, so a company with
 * two of them had one indistinguishable blur. Adding the second office here is
 * what separates them.
 */
export default function ClockLocationsSettings() {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useFetchSelectQuery({
    queryKey: ["clockLocations"],
    fetchFn: getClockLocations,
  });

  const [newName, setNewName] = React.useState("");
  const [editing, setEditing] = React.useState(null); // { id, name }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["clockLocations"] });
    // The attendance screens group by location.
    queryClient.invalidateQueries({ queryKey: ["OfficeEmployeeClock"] });
  };

  const run = (fn, onDone) =>
    fn.then((res) => {
      if (!res?.success) {
        toast.error(res?.message || "That did not work");
        return;
      }
      toast.success(res.message);
      onDone?.();
      refresh();
    });

  const { mutate: add, isPending: adding } = useMutation({
    mutationFn: () =>
      run(createClockLocation({ name: newName.trim(), kind: "office" }), () =>
        setNewName(""),
      ),
  });

  const { mutate: rename, isPending: renaming } = useMutation({
    mutationFn: () =>
      run(
        updateClockLocation({ id: editing.id, name: editing.name.trim() }),
        () => setEditing(null),
      ),
  });

  const { mutate: archive, isPending: archiving } = useMutation({
    mutationFn: (id) => run(archiveClockLocation({ id })),
  });

  const { mutate: makeDefault, isPending: defaulting } = useMutation({
    mutationFn: (id) => run(setDefaultLocation({ id })),
  });

  const busy = adding || renaming || archiving || defaulting;

  const offices = locations.filter((l) => !l.projectSiteId);
  const sites = locations.filter((l) => l.projectSiteId);

  // Names shared by two or more places. New duplicates are refused at the point
  // they are typed, but the ones already in the data are not going to fix
  // themselves, and until they are fixed nobody can tell two rows apart on a
  // rota or a report. Compared case-insensitively, the same way the checks are.
  const clashes = React.useMemo(() => {
    const seen = new Map();
    for (const l of locations) {
      const key = (l.name || "").trim().toLowerCase();
      if (!key) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => locations.find((l) => (l.name || "").trim().toLowerCase() === key)?.name)
      .filter(Boolean);
  }, [locations]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock-in Locations</CardTitle>
        <CardDescription>
          Every clock in and out is recorded against one of these. Sites appear
          here automatically from Site Projects — add an entry yourself only for
          an office or another place that is not a job.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-5">
            {clashes.length ? (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  {clashes.length === 1
                    ? `Two places are called "${clashes[0]}".`
                    : `Some names are used more than once: ${clashes
                        .map((n) => `"${n}"`)
                        .join(", ")}.`}{" "}
                  Nobody can tell them apart on a rota or a report. Rename one
                  on the Site Projects screen — new duplicates are no longer
                  accepted, but these were created before that rule existed.
                </p>
              </div>
            ) : null}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...offices, ...sites].map((location) => {
                    const fromSite = Boolean(location.projectSiteId);
                    const isEditing = editing?.id === location._id;

                    return (
                      <TableRow key={location._id}>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={editing.name}
                              autoFocus
                              disabled={busy}
                              onChange={(e) =>
                                setEditing({ ...editing, name: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") rename();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : (
                            <span className="flex items-center gap-2">
                              {fromSite ? (
                                <HardHat className="size-4 text-amber-600" />
                              ) : (
                                <Building2 className="size-4 text-indigo-600" />
                              )}
                              {location.name}
                              {location.isDefault ? (
                                <span
                                  className="flex items-center gap-1 text-[11px] text-neutral-500"
                                  title="Where a clock-in with no site is recorded"
                                >
                                  <Star className="size-3" /> default
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-neutral-500">
                          {fromSite ? (
                            <>
                              Site —{" "}
                              <span className="text-neutral-400">
                                {location.projectSiteId?.siteName ||
                                  "from Site Projects"}
                              </span>
                            </>
                          ) : (
                            "Office"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={busy || !editing.name.trim()}
                                onClick={() => rename()}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              {/* Offices only: the default is where a
                                  clock-in that names no site is recorded, so
                                  a site cannot hold it. */}
                              {!fromSite && !location.isDefault ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  title="Record clock-ins that name no site at this office"
                                  onClick={() => makeDefault(location._id)}
                                >
                                  <Star className="size-3.5" />
                                </Button>
                              ) : null}
                              {/* A site's name is owned by the site. Editing
                                  it here would be overwritten the next time
                                  anyone saved the site. */}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || fromSite}
                                title={
                                  fromSite
                                    ? "Rename this on the Site Projects screen"
                                    : "Rename"
                                }
                                onClick={() =>
                                  setEditing({
                                    id: location._id,
                                    name: location.name,
                                  })
                                }
                              >
                                Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || fromSite || location.isDefault}
                                title={
                                  location.isDefault
                                    ? "The default cannot be archived — records with no site land here"
                                    : fromSite
                                      ? "Close this on the Site Projects screen"
                                      : "Archive"
                                }
                                onClick={() => archive(location._id)}
                              >
                                <Archive className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="newLocation" className="text-sm">
                Add an office
              </Label>
              <div className="flex gap-2">
                <Input
                  id="newLocation"
                  placeholder="Northgate Office"
                  value={newName}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) add();
                  }}
                />
                <Button disabled={busy || !newName.trim()} onClick={() => add()}>
                  {adding ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1 size-4" />
                  )}
                  Add
                </Button>
              </div>
              <p className="text-xs text-neutral-500">
                One office is the <strong>default</strong> (
                <Star className="inline size-3 align-[-1px]" />
                ): it is where a clock-in that names no site is recorded. Use
                the <Star className="inline size-3 align-[-1px]" /> button on
                another office to move it. Records already written keep the
                location they were recorded at — moving the default changes
                where future ones land, not past ones.
              </p>
              <p className="text-xs text-neutral-500">
                Attendance recorded before an office existed stays on the
                default — which office it actually happened at was never
                recorded, so it cannot be split retrospectively.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
