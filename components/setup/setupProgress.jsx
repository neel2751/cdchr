"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Circle, ListChecks, Loader2, MinusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  getSetupProgress,
  markSetupStep,
  setSetupChecklistHidden,
} from "@/server/tenantServer/setupProgressServer";

export const SETUP_PROGRESS_KEY = ["setupProgress"];

/**
 * Loads the checklist for a super admin. Everyone else gets nothing and makes
 * no request — the server would refuse them anyway.
 */
export function useSetupProgress() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "superAdmin";
  return useQuery({
    queryKey: SETUP_PROGRESS_KEY,
    enabled: isOwner,
    queryFn: async () => {
      const res = await getSetupProgress();
      if (!res?.success) return null;
      return JSON.parse(res.data);
    },
    // Steps tick themselves as data appears elsewhere in the app, so look
    // again when the owner comes back to the tab.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * The owner's setup progress, in the sidebar: "Setup · 5 of 12", opening the
 * checklist beside the page. Gone once they put it away (Settings brings it
 * back), and never shown to anyone but a super admin.
 *
 * See server/tenantServer/setupProgressServer.js for what each step checks.
 */
export default function SetupProgress() {
  const [open, setOpen] = useState(false);
  const { data: progress } = useSetupProgress();

  if (!progress || progress.hidden) return null;

  const { finished, total } = progress;
  const percent = total ? Math.round((finished / total) * 100) : 0;
  const complete = finished === total;

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip={`Setup: ${finished} of ${total}`}
            onClick={() => setOpen(true)}
            className="h-auto flex-col items-stretch gap-1.5 border py-2"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="size-4 shrink-0" />
              <span className="truncate">
                {complete ? "Setup complete" : "Set up your company"}
              </span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {finished}/{total}
              </span>
            </span>
            <Progress value={percent} className="h-1.5" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SetupChecklist open={open} onOpenChange={setOpen} progress={progress} />
    </>
  );
}

function SetupChecklist({ open, onOpenChange, progress }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const { steps, finished, total } = progress;
  const groups = [...new Set(steps.map((s) => s.group))];
  const next = steps.find((s) => !s.done && !s.skipped);

  const act = async (key, action) => {
    setBusy(key);
    try {
      const res = await action();
      if (res?.success) {
        await queryClient.invalidateQueries({ queryKey: SETUP_PROGRESS_KEY });
      } else {
        toast.error(res?.message || "Could not save that");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Set up your company</SheetTitle>
          <SheetDescription>
            {finished} of {total} done.
            {next ? ` Next: ${next.title.toLowerCase()}.` : " Everything is set up."}
          </SheetDescription>
          <Progress
            value={total ? (finished / total) * 100 : 0}
            className="mt-2 h-2"
          />
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          {groups.map((group) => (
            <section key={group} className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group}
              </h3>
              <ul className="space-y-2">
                {steps
                  .filter((s) => s.group === group)
                  .map((step) => (
                    <Step
                      key={step.key}
                      step={step}
                      busy={busy === step.key}
                      onNavigate={() => onOpenChange(false)}
                      onMark={(mark) =>
                        act(step.key, () => markSetupStep({ key: step.key, mark }))
                      }
                    />
                  ))}
              </ul>
            </section>
          ))}

          <div className="border-t pt-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy === "hide"}
              onClick={() =>
                act("hide", () => setSetupChecklistHidden(true)).then(() =>
                  onOpenChange(false),
                )
              }
            >
              Hide this checklist
            </Button>
            <p className="mt-1 px-3 text-xs text-muted-foreground">
              You can bring it back from Settings.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Step({ step, busy, onNavigate, onMark }) {
  const finished = step.done || step.skipped;
  const Icon = step.done ? Check : step.skipped ? MinusCircle : Circle;
  return (
    <li
      className={`rounded-lg border p-3 ${finished ? "bg-muted/40" : ""}`}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${
            step.done
              ? "text-emerald-600"
              : step.skipped
                ? "text-muted-foreground"
                : "text-muted-foreground/60"
          }`}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p
            className={`text-sm font-medium ${finished ? "text-muted-foreground" : ""}`}
          >
            {step.title}
            {step.optional && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                optional
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{step.body}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button asChild size="sm" variant={finished ? "ghost" : "outline"}>
              <Link href={step.href} onClick={onNavigate}>
                {finished ? "Open" : "Start"}
              </Link>
            </Button>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {!busy && !step.done && step.review && (
              <Button size="sm" variant="ghost" onClick={() => onMark("done")}>
                Mark done
              </Button>
            )}
            {!busy && !finished && step.optional && (
              <Button size="sm" variant="ghost" onClick={() => onMark("skipped")}>
                Skip
              </Button>
            )}
            {!busy && step.skipped && (
              <Button size="sm" variant="ghost" onClick={() => onMark(null)}>
                Undo skip
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
