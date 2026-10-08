"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Plus, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectOfficeEmployee } from "@/server/selectServer/selectServer";
import {
  getCarryForwardExceptions,
  setCarryForwardMode,
} from "@/server/leaveServer/carryForwardServer";

/**
 * The named people who do not follow the company's carry-forward rules.
 *
 * WHY THIS IS NOT INSIDE THE PER-LEAVE-TYPE POPOVER. Exceptions are per leave
 * type, like the rules — but one employee may have several, and the same person
 * would then appear in two or three popovers with no single place to see what
 * has been decided by hand. One reviewable list is the point.
 *
 * WHY IT IS NOT IN THE RULE EITHER. A rule that names people creates two places
 * that can disagree about one employee, with nothing to say which wins — and
 * three names in a rule is three decisions wearing a policy's clothes. The rule
 * says who by default; this says who is an exception to it.
 *
 * It lives here because the settings screen is where somebody is standing when
 * they think "except Sarah". The entitlement sheet shows each exception on the
 * leave type it applies to, so it is visible from there too — but read-only,
 * because one editing surface is enough.
 */

const MODE_LABEL = {
  always: "Always carries",
  never: "Never carries",
};

/** The name behind an id, for the one-selected case. */
const labelFor = (options, id) =>
  options.find((option) => String(option.value) === id)?.label || "1 selected";

export default function CarryForwardExceptions() {
  const queryClient = useQueryClient();
  // A list, because giving the exception to twenty of forty people is the
  // ordinary case and twenty round trips through a dropdown is not a workflow
  // anybody finishes.
  const [picked, setPicked] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [leaveType, setLeaveType] = React.useState("");
  const [mode, setMode] = React.useState("never");
  // On by default: an exception that does not touch the leave year the employee
  // is actually in reads as a setting that did nothing. Off is here for somebody
  // staging a change for next year.
  const [applyNow, setApplyNow] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const { data, isLoading } = useFetchQuery({
    queryKey: ["carry-forward-exceptions"],
    fetchFn: getCarryForwardExceptions,
  });
  const exceptions = data?.newData?.rows || [];
  const leaveTypes = data?.newData?.leaveTypes || [];
  const carryingTypes = data?.newData?.carryingTypes || [];

  // Derived rather than synced into state by an effect: the default is "the
  // first type that carries forward", which on most companies is Annual Leave
  // and the only one. An effect would be a render-then-correct and the React
  // Compiler rightly objects to it.
  const chosenType = leaveType || leaveTypes[0] || "";

  /**
   * Switching leave type clears the selection.
   *
   * Who is addable depends on the type — somebody already excepted for Annual
   * Leave is still offered for Sick Leave — so a selection carried across would
   * silently include or drop people.
   */
  const changeLeaveType = (next) => {
    setLeaveType(next);
    setPicked([]);
  };

  const { data: employees = [] } = useFetchSelectQuery({
    queryKey: ["selectOfficeEmployee"],
    fetchFn: getSelectOfficeEmployee,
  });

  // Somebody already excepted FOR THE CHOSEN TYPE is changed on their existing
  // row, not added again — but they are still offered for a different type.
  const alreadyExcepted = new Set(
    exceptions
      .filter((row) => row.leaveType === chosenType || row.legacy)
      .map((row) => row.employeeId)
  );
  const addable = employees.filter(
    (employee) => !alreadyExcepted.has(String(employee.value))
  );

  const toggle = (id) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );

  const apply = async (employeeIds, forType, nextMode) => {
    setBusy(true);
    try {
      const response = await setCarryForwardMode({
        employeeIds,
        leaveType: forType,
        mode: nextMode,
        applyNow,
      });
      if (!response?.success) {
        toast.error(response?.message || "Could not change that setting");
        return;
      }
      toast.success(response.message);
      queryClient.invalidateQueries({ queryKey: ["carry-forward-exceptions"] });
      // The entitlement table shows each person's setting AND their balances,
      // both of which this may have just moved.
      queryClient.invalidateQueries({ queryKey: ["leave-entitlement"] });
      queryClient.invalidateQueries({
        queryKey: ["leave-entitlement-sync-status"],
      });
      setPicked([]);
    } catch (error) {
      toast.error("Could not change that setting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <p className="text-sm font-medium">Individual exceptions</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          For people who should not follow the rules above, on one leave type.
          Pick as many as you like — and by default their current leave year is
          recalculated straight away, so the exception takes effect rather than
          waiting until next April.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : exceptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody is an exception — everyone follows the rules above.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {exceptions.map((row) => (
            <li
              key={`${row.employeeId}-${row.leaveType || "all"}`}
              className="flex items-center justify-between gap-3 p-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {row.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {[row.employeType, row.department].filter(Boolean).join(" · ") ||
                    "—"}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">
                  {/* A row written before exceptions were per type covered all
                      of them at once, and still does until it is changed. */}
                  {row.legacy ? "Every leave type" : row.leaveType}
                </Badge>
                <Badge
                  variant={row.mode === "always" ? "secondary" : "outline"}
                  className="gap-1"
                >
                  {row.mode === "always" ? (
                    <UserPlus className="size-3" />
                  ) : (
                    <UserMinus className="size-3" />
                  )}
                  {MODE_LABEL[row.mode]}
                </Badge>
                {row.mode === "always" && !row.typeCarries && (
                  <Badge variant="destructive" title="No carry-forward rule">
                    no rule
                  </Badge>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={busy}
                  // "default" is how an exception is removed: following the
                  // policy is a real state, not the absence of one.
                  onClick={() => apply([row.employeeId], row.leaveType, "default")}
                  aria-label={`Remove the exception for ${row.name}`}
                  title="Follow the company rule again"
                >
                  <X className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-[14rem] flex-1 space-y-1">
          <span className="block text-xs text-muted-foreground">
            Employees{picked.length ? ` — ${picked.length} selected` : ""}
          </span>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={busy || !addable.length}
                className="h-9 w-full justify-between font-normal"
              >
                <span className="truncate">
                  {!addable.length
                    ? "Everyone already has an exception"
                    : picked.length === 0
                      ? "Choose people"
                      : picked.length === 1
                        ? labelFor(addable, picked[0])
                        : `${picked.length} selected`}
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>

            <PopoverContent className="w-72 p-0" align="start">
              <Command>
                {/* Searchable, because picking twenty out of forty by scrolling
                    is the thing that makes people give up. */}
                <CommandInput placeholder="Search staff..." />
                <CommandList>
                  <CommandEmpty>Nobody by that name.</CommandEmpty>
                  <CommandGroup>
                    <ScrollArea className="h-56">
                      {addable.map((employee) => {
                        const id = String(employee.value);
                        const checked = picked.includes(id);
                        return (
                          <CommandItem
                            key={id}
                            value={employee.label}
                            onSelect={() => toggle(id)}
                            className="gap-2"
                          >
                            <Checkbox checked={checked} />
                            <span className="truncate">{employee.label}</span>
                          </CommandItem>
                        );
                      })}
                    </ScrollArea>
                  </CommandGroup>
                </CommandList>
              </Command>

              <div className="flex items-center justify-between border-t p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPicked(addable.map((e) => String(e.value)))}
                  disabled={picked.length === addable.length}
                >
                  Select all {addable.length}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPicked([])}
                  disabled={!picked.length}
                >
                  Clear
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </span>

        <span className="w-44 space-y-1">
          <span className="block text-xs text-muted-foreground">Leave type</span>
          <Select
            value={chosenType}
            onValueChange={changeLeaveType}
            disabled={busy || !leaveTypes.length}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a type" />
            </SelectTrigger>
            <SelectContent>
              {leaveTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                  {carryingTypes.includes(type) ? "" : " (no rule)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>

        <span className="w-40 space-y-1">
          <span className="block text-xs text-muted-foreground">Setting</span>
          <Select value={mode} onValueChange={setMode} disabled={busy}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never carries</SelectItem>
              <SelectItem value="always">Always carries</SelectItem>
            </SelectContent>
          </Select>
        </span>

        <Button
          variant="outline"
          disabled={busy || !picked.length || !chosenType}
          onClick={() => apply(picked, chosenType, mode)}
        >
          <Plus className="size-4" />
          {picked.length > 1
            ? `Add for ${picked.length} people`
            : "Add exception"}
        </Button>
      </div>

      <label className="flex cursor-pointer items-start gap-2">
        <Checkbox
          checked={applyNow}
          disabled={busy}
          onCheckedChange={(value) => setApplyNow(value === true)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm">
            Recalculate the current leave year now
          </span>
          <span className="block text-xs text-muted-foreground">
            Applies the change to balances people already hold. Days they have
            already taken are never taken back, and every change is recorded
            under History. Untick to stage it for next year instead.
          </span>
        </span>
      </label>

      <p className="text-xs text-muted-foreground">
        Each exception covers one leave type. <strong>Always carries</strong>{" "}
        overrides the conditions above — who qualifies — but not the switch at
        the top, and not a leave type with no carry-forward rule: there has to be
        a rule saying how many days may carry before anyone can carry them.
      </p>
    </div>
  );
}
