"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getDispatchSettings,
  saveDispatchSettings,
} from "@/server/tagServer/labels";

/**
 * Our own details, as they appear on a printed label.
 *
 * Lives on the provisioning page rather than in a settings screen somewhere
 * else, because the moment anybody wants these is the moment they print their
 * first label and find the bottom half blank.
 *
 * Collapsed by default: set once, then it is noise on a screen whose job is
 * programming chips.
 */
export default function DispatchSettings() {
  const queryClient = useQueryClient();
  const { data: saved } = useFetchSelectQuery({
    queryKey: ["dispatchSettings"],
    fetchFn: getDispatchSettings,
  });

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(null);

  const value = (key) => draft?.[key] ?? saved?.[key] ?? "";
  const set = (key) => (e) =>
    setDraft((d) => ({ ...(d ?? {}), [key]: e.target.value }));

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      saveDispatchSettings({
        dispatchFromName: value("dispatchFromName"),
        dispatchFromAddress: value("dispatchFromAddress"),
        dispatchContact: value("dispatchContact"),
        dispatchReturnNote: value("dispatchReturnNote"),
      }).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not save those details");
          return;
        }
        toast.success(res.message);
        setDraft(null);
        queryClient.invalidateQueries({ queryKey: ["dispatchSettings"] });
      }),
  });

  // The one field that makes a label useless by its absence.
  const incomplete = !saved?.dispatchFromName || !saved?.dispatchFromAddress;

  return (
    <Card>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Dispatch details</CardTitle>
            <CardDescription>
              {incomplete
                ? "No return address set — labels will print with the bottom half blank."
                : `Labels return to ${saved.dispatchFromName}.`}
            </CardDescription>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </CardHeader>

      {open ? (
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fromName">Sender name</Label>
            <Input
              id="fromName"
              value={value("dispatchFromName")}
              disabled={isPending}
              onChange={set("dispatchFromName")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fromAddress">Return address</Label>
            <Textarea
              id="fromAddress"
              rows={4}
              placeholder={"Unit 4\nSomething Industrial Estate\nLondon\nSW1A 1AA"}
              value={value("dispatchFromAddress")}
              disabled={isPending}
              onChange={set("dispatchFromAddress")}
            />
            <p className="text-xs text-muted-foreground">
              Printed as typed, line breaks kept. Left as free text on purpose:
              a postal address forced into fields is a postal address with a
              wrong field.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact">Contact</Label>
            <Input
              id="contact"
              placeholder="0200 000 0000 · support@example.com"
              value={value("dispatchContact")}
              disabled={isPending}
              onChange={set("dispatchContact")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="returnNote">Return note</Label>
            <Input
              id="returnNote"
              placeholder="Please do not bend"
              value={value("dispatchReturnNote")}
              disabled={isPending}
              onChange={set("dispatchReturnNote")}
            />
          </div>

          <Button disabled={isPending} onClick={() => save()}>
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Save dispatch details
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
