"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Nfc, PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getClockLocations } from "@/server/clockServer/locations";
import { assignClockTag, getClockTags, setClockTagStatus } from "@/server/clockServer/tags";

/**
 * The NFC tags, and where each one is mounted.
 *
 * Tags are not added here — a tag is enrolled by *tapping* it, which reads the
 * UID off the chip. Typing fourteen hex characters off a sticker is how the
 * wrong tag ends up bound to the wrong site, so there is deliberately no field
 * for it. A tag tapped by a super admin appears in this list as Unassigned,
 * ready to be pointed at a location.
 *
 * Moving a tag is **not retroactive**: attendance already recorded keeps the
 * location it was recorded at. Rewriting it would re-attribute hours, and
 * therefore pay, to a site the work never happened on.
 */
const STATUS_STYLE = {
  active: "bg-green-100 text-green-800",
  unassigned: "bg-amber-100 text-amber-800",
  suspended: "bg-red-100 text-red-800",
};

export default function ClockTagsSettings() {
  const queryClient = useQueryClient();
  const { data: tags = [], isLoading } = useFetchSelectQuery({
    queryKey: ["clockTags"],
    fetchFn: getClockTags,
  });
  const { data: locations = [] } = useFetchSelectQuery({
    queryKey: ["clockLocations"],
    fetchFn: getClockLocations,
  });

  const [pending, setPending] = React.useState({}); // tagId -> chosen locationId

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["clockTags"] });

  const run = (promise) =>
    promise.then((res) => {
      if (!res?.success) {
        toast.error(res?.message || "That did not work");
        return;
      }
      toast.success(res.message);
      refresh();
    });

  const { mutate: assign, isPending: assigning } = useMutation({
    mutationFn: ({ id, locationId }) => run(assignClockTag({ id, locationId })),
  });
  const { mutate: setStatus, isPending: settingStatus } = useMutation({
    mutationFn: ({ id, status }) => run(setClockTagStatus({ id, status })),
  });

  const busy = assigning || settingStatus;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Nfc className="size-4 text-teal-600" />
          Clock-in Tags
        </CardTitle>
        <CardDescription>
          NFC stickers people tap to clock in. To add one, just tap it with your
          phone — the code is read from the chip, so there is nothing to type.
          It will appear here ready to be pointed at a location.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : tags.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-neutral-500">
            No tags yet. Tap a new NFC tag with your phone while signed in as a
            super admin and it will show up here.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Where it is</TableHead>
                  <TableHead>Last tapped</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map((tag) => {
                  const unassigned = !tag.locationId;
                  // The clone signal: a tag bound to one place whose taps keep
                  // arriving from another was either copied or physically
                  // moved without anyone reassigning it.
                  const elsewhere =
                    tag.lastSeenLocationId &&
                    tag.locationId &&
                    String(tag.lastSeenLocationId._id) !==
                      String(tag.locationId._id);

                  return (
                    <TableRow key={tag._id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{tag.label}</span>
                          <span className="text-[11px] text-neutral-400">
                            {tag.uid} · {tag.chipType}
                          </span>
                          <span
                            className={`mt-1 w-fit rounded px-1.5 py-0.5 text-[10px] ${
                              STATUS_STYLE[tag.status] || "bg-neutral-100"
                            }`}
                          >
                            {tag.status}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="text-sm">
                        {unassigned ? (
                          <Select
                            value={pending[tag._id] || ""}
                            onValueChange={(v) =>
                              setPending((p) => ({ ...p, [tag._id]: v }))
                            }
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue placeholder="Choose a location" />
                            </SelectTrigger>
                            <SelectContent>
                              {locations.map((l) => (
                                <SelectItem key={l._id} value={l._id}>
                                  {l.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="flex flex-col">
                            <span>{tag.locationId?.name}</span>
                            {elsewhere ? (
                              <span className="text-[11px] text-red-600">
                                ⚠ last tapped at{" "}
                                {tag.lastSeenLocationId?.name} — moved, or
                                copied
                              </span>
                            ) : null}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-xs text-neutral-500">
                        {tag.lastSeenAt
                          ? new Date(tag.lastSeenAt).toLocaleString("en-GB")
                          : "never"}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {unassigned ? (
                            <Button
                              size="sm"
                              disabled={busy || !pending[tag._id]}
                              onClick={() =>
                                assign({
                                  id: tag._id,
                                  locationId: pending[tag._id],
                                })
                              }
                            >
                              Assign
                            </Button>
                          ) : (
                            <Select
                              value=""
                              onValueChange={(locationId) =>
                                assign({ id: tag._id, locationId })
                              }
                            >
                              <SelectTrigger className="w-28">
                                <SelectValue placeholder="Move to…" />
                              </SelectTrigger>
                              <SelectContent>
                                {locations.map((l) => (
                                  <SelectItem key={l._id} value={l._id}>
                                    {l.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}

                          {/* Suspend has to be instant and reversible — it is
                              what someone reaches for when a tag goes missing
                              on a Friday and nobody yet knows if it was
                              stolen. Retire is final. */}
                          {tag.status === "suspended" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Put back in use"
                              disabled={busy}
                              onClick={() =>
                                setStatus({ id: tag._id, status: "active" })
                              }
                            >
                              <PlayCircle className="size-3.5" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Suspend — stops working immediately"
                              disabled={busy || unassigned}
                              onClick={() =>
                                setStatus({ id: tag._id, status: "suspended" })
                              }
                            >
                              <PauseCircle className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            title="Retire permanently — lost or damaged"
                            disabled={busy}
                            onClick={() =>
                              setStatus({ id: tag._id, status: "retired" })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
