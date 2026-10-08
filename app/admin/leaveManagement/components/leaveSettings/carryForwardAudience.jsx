"use client";

import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectRoleType } from "@/server/selectServer/selectServer";

/**
 * Who one leave type's carry-forward rule applies to.
 *
 * In a popover rather than in the table, because the table already carries five
 * columns and four more would make it unreadable — and because this is the part
 * somebody sets once and then leaves alone. The cell shows the answer; the
 * popover is where it is changed.
 *
 * EMPTY MEANS EVERYONE, everywhere in here. That is what every existing rule
 * has, so a company that has been running on carry-forward keeps exactly what it
 * had until somebody deliberately narrows a rule.
 *
 * Individual exceptions do not belong here: they go on the employee, as
 * `carryForwardOverrides`, and are managed by CarryForwardExceptions below the
 * table. A rule is for a policy; a policy with one person's name in it is not a
 * policy — it is one decision wearing a policy's clothes, and the next reader
 * cannot tell which.
 */

/** The values `employeType` actually holds. Mirrors OFFICEFIELD. */
const EMPLOYEE_TYPES = ["Full-Time", "Part-Time"];

/** A short description of the rule's audience, for the table cell. */
export function audienceSummary(rule) {
  const types = rule?.appliesTo?.employeeTypes || [];
  const departments = rule?.appliesTo?.departments || [];
  const months = Number(rule?.minMonthsService) || 0;
  const minDays = Number(rule?.minDaysRemaining) || 0;

  const parts = [];
  if (types.length) parts.push(types.join(" + "));
  if (departments.length) {
    parts.push(
      `${departments.length} department${departments.length === 1 ? "" : "s"}`
    );
  }
  if (months > 0) parts.push(`${months}m service`);
  if (minDays > 0) parts.push(`${minDays}+ days left`);

  return parts.length ? parts.join(" · ") : "Everyone";
}

export default function CarryForwardAudience({ rule, onChange, disabled }) {
  const { data: departments = [] } = useFetchSelectQuery({
    queryKey: ["selectRoleType"],
    fetchFn: getSelectRoleType,
  });

  const types = rule?.appliesTo?.employeeTypes || [];
  const chosenDepartments = (rule?.appliesTo?.departments || []).map(String);

  const setAppliesTo = (patch) =>
    onChange({
      appliesTo: {
        employeeTypes: types,
        departments: chosenDepartments,
        ...patch,
      },
    });

  const toggleType = (value) =>
    setAppliesTo({
      employeeTypes: types.includes(value)
        ? types.filter((t) => t !== value)
        : [...types, value],
    });

  const toggleDepartment = (value) =>
    setAppliesTo({
      departments: chosenDepartments.includes(value)
        ? chosenDepartments.filter((d) => d !== value)
        : [...chosenDepartments, value],
    });

  const narrowed = audienceSummary(rule) !== "Everyone";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={`h-8 justify-start gap-1.5 font-normal ${
            narrowed ? "" : "text-muted-foreground"
          }`}
        >
          <Users className="size-3.5 shrink-0" />
          <span className="truncate">{audienceSummary(rule)}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 space-y-4" align="start">
        <div>
          <p className="text-sm font-medium">Who carries forward?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Leave everything blank and it applies to everyone. These conditions
            describe a <em>group</em> — to name one person, use{" "}
            <strong>Individual exceptions</strong> below the table, which applies
            to every leave type rather than just this one.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Employment type</Label>
          {EMPLOYEE_TYPES.map((value) => (
            <label key={value} className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={types.includes(value)}
                onCheckedChange={() => toggleType(value)}
              />
              <span className="text-sm">{value}</span>
            </label>
          ))}
          {!types.length && (
            <p className="text-[11px] text-muted-foreground">
              Any employment type.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Departments</Label>
          {departments.length ? (
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {departments.map((department) => (
                <label
                  key={department.value}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Checkbox
                    checked={chosenDepartments.includes(String(department.value))}
                    onCheckedChange={() =>
                      toggleDepartment(String(department.value))
                    }
                  />
                  <span className="text-sm">{department.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No departments yet.
            </p>
          )}
          {!chosenDepartments.length && departments.length ? (
            <p className="text-[11px] text-muted-foreground">
              Any department.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="min-service" className="text-xs">
              Minimum service
            </Label>
            <span className="flex items-center gap-1.5">
              <Input
                id="min-service"
                type="number"
                min={0}
                max={120}
                className="h-8"
                value={rule?.minMonthsService ?? 0}
                onChange={(event) =>
                  onChange({ minMonthsService: Number(event.target.value) })
                }
              />
              <span className="text-xs text-muted-foreground">mo</span>
            </span>
            <p className="text-[11px] text-muted-foreground">
              0 = from day one
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="min-left" className="text-xs">
              Minimum left over
            </Label>
            <span className="flex items-center gap-1.5">
              <Input
                id="min-left"
                type="number"
                min={0}
                max={60}
                className="h-8"
                value={rule?.minDaysRemaining ?? 0}
                onChange={(event) =>
                  onChange({ minDaysRemaining: Number(event.target.value) })
                }
              />
              <span className="text-xs text-muted-foreground">days</span>
            </span>
            <p className="text-[11px] text-muted-foreground">
              0 = carry any amount
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
