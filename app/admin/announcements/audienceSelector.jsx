"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, HardHat, Users } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getFieldStaffSelect } from "@/server/announcementServer/announcementServer";
import {
  getAllProjects,
  getSelectOfficeEmployee,
  getSelectRoleType,
} from "@/server/selectServer/selectServer";
import { AUDIENCE_MODE_OPTIONS, ROLE_OPTIONS } from "./constants";

/** A checkbox row, used for the role, department and site lists. */
function CheckRow({ id, label, checked, onToggle }) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-neutral-50"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <span className="text-sm">{label}</span>
    </label>
  );
}

/** A person's identity in the picker: the id alone is ambiguous across the two
 *  collections, so selections are keyed "kind:id". */
const personKey = (kind, id) => `${kind}:${id}`;

/**
 * Picks who an announcement is for.
 *
 * One axis at a time, matching how the audience is stored — see the comment on
 * audienceSchema in models/announcementModel.js. Switching mode deliberately
 * leaves the other lists intact so flipping between "by role" and "by
 * department" to compare does not wipe what was already chosen; only the active
 * mode's list is read when the form is submitted.
 *
 * Site staff are opt-in, because most announcements are for the office and the
 * two groups read them in different apps. Two modes ignore the toggle because
 * they name site staff outright: picking the "Site staff" role, and targeting a
 * project site.
 *
 * @param {{value: object, onChange: (next: object) => void}} props
 */
export default function AudienceSelector({ value, onChange }) {
  const [peopleOpen, setPeopleOpen] = useState(false);

  const audience = value || { mode: "all" };
  const mode = audience.mode || "all";
  const set = (patch) => onChange({ ...audience, ...patch });

  const { data: departments = [] } = useFetchSelectQuery({
    queryKey: ["roleTypeSelect"],
    fetchFn: getSelectRoleType,
  });

  const { data: officeStaff = [] } = useFetchSelectQuery({
    queryKey: ["officeEmployeeSelect"],
    fetchFn: getSelectOfficeEmployee,
  });

  const { data: fieldStaff = [] } = useFetchSelectQuery({
    queryKey: ["fieldStaffSelect"],
    fetchFn: getFieldStaffSelect,
  });

  const { data: sites = [] } = useFetchSelectQuery({
    queryKey: ["projectSiteSelect"],
    fetchFn: getAllProjects,
  });

  const selectedRoles = audience.roles || [];
  const selectedDepartments = (audience.departments || []).map(String);
  const selectedSites = (audience.sites || []).map(String);
  const selectedPeople = (audience.people || []).map((p) =>
    personKey(p?.kind || "office", String(p?.employeeId ?? p))
  );

  const peopleLabels = useMemo(() => {
    const map = {};
    for (const o of officeStaff) map[personKey("office", String(o.value))] = o.label;
    for (const f of fieldStaff) map[personKey("field", String(f.value))] = f.label;
    return map;
  }, [officeStaff, fieldStaff]);

  const toggle = (list, item) =>
    list.includes(item) ? list.filter((v) => v !== item) : [...list, item];

  const setPeople = (keys) =>
    set({
      people: keys.map((key) => {
        const [kind, employeeId] = key.split(":");
        return { kind, employeeId };
      }),
    });

  // The toggle is meaningless in the two modes that already name site staff,
  // and showing it there would imply it does something.
  const showFieldToggle = mode === "all" || mode === "departments";

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium text-neutral-500">Audience</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {AUDIENCE_MODE_OPTIONS.map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => set({ mode: option.value })}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-neutral-200 hover:bg-neutral-50"
                }`}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {showFieldToggle && (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <HardHat className="mt-0.5 size-4 text-neutral-500" />
            <div>
              <Label htmlFor="includeField">Include site staff</Label>
              <p className="text-xs text-neutral-500">
                Site staff read announcements in the employee app. They have no
                departments, so a department audience reaches all of them.
              </p>
            </div>
          </div>
          <Switch
            id="includeField"
            checked={!!audience.includeField}
            onCheckedChange={(v) => set({ includeField: v })}
          />
        </div>
      )}

      {mode === "all" && (
        <p className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          <Users className="size-4" />
          {audience.includeField
            ? "Every active member of staff, office and site."
            : "Every active member of office staff."}
        </p>
      )}

      {mode === "roles" && (
        <div className="rounded-lg border p-2">
          {ROLE_OPTIONS.map((role) => (
            <CheckRow
              key={role.value}
              id={`role-${role.value}`}
              label={role.label}
              checked={selectedRoles.includes(role.value)}
              onToggle={() => set({ roles: toggle(selectedRoles, role.value) })}
            />
          ))}
        </div>
      )}

      {mode === "departments" && (
        <div className="rounded-lg border p-2">
          {departments.length === 0 ? (
            <p className="px-2 py-3 text-sm text-neutral-500">
              No departments have been set up yet.
            </p>
          ) : (
            <ScrollArea className="max-h-56">
              {departments.map((department) => {
                const id = String(department.value);
                return (
                  <CheckRow
                    key={id}
                    id={`department-${id}`}
                    label={department.label}
                    checked={selectedDepartments.includes(id)}
                    onToggle={() =>
                      set({ departments: toggle(selectedDepartments, id) })
                    }
                  />
                );
              })}
            </ScrollArea>
          )}
        </div>
      )}

      {mode === "sites" && (
        <div className="space-y-2">
          <div className="rounded-lg border p-2">
            {sites.length === 0 ? (
              <p className="px-2 py-3 text-sm text-neutral-500">
                No project sites have been set up yet.
              </p>
            ) : (
              <ScrollArea className="max-h-56">
                {sites.map((site) => {
                  const id = String(site.value);
                  return (
                    <CheckRow
                      key={id}
                      id={`site-${id}`}
                      label={site.label}
                      checked={selectedSites.includes(id)}
                      onToggle={() => set({ sites: toggle(selectedSites, id) })}
                    />
                  );
                })}
              </ScrollArea>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            Reaches the site staff assigned to these sites. Office staff are not
            assigned to a site and will not receive it.
          </p>
        </div>
      )}

      {mode === "people" && (
        <div className="space-y-2">
          <Popover open={peopleOpen} onOpenChange={setPeopleOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={peopleOpen}
                className="w-full justify-between sm:w-80"
              >
                {selectedPeople.length
                  ? `${selectedPeople.length} selected`
                  : "Choose people"}
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search staff..." />
                <CommandList>
                  <CommandEmpty>No one found.</CommandEmpty>
                  <CommandGroup heading="Office staff">
                    {officeStaff.map((person) => {
                      const key = personKey("office", String(person.value));
                      return (
                        <CommandItem
                          key={key}
                          value={`office ${person.label}`}
                          onSelect={() =>
                            setPeople(toggle(selectedPeople, key))
                          }
                        >
                          <Check
                            className={`mr-2 size-4 ${
                              selectedPeople.includes(key)
                                ? "opacity-100"
                                : "opacity-0"
                            }`}
                          />
                          {person.label}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  {fieldStaff.length > 0 && (
                    <CommandGroup heading="Site staff">
                      {fieldStaff.map((person) => {
                        const key = personKey("field", String(person.value));
                        return (
                          <CommandItem
                            key={key}
                            value={`site ${person.label}`}
                            onSelect={() =>
                              setPeople(toggle(selectedPeople, key))
                            }
                          >
                            <Check
                              className={`mr-2 size-4 ${
                                selectedPeople.includes(key)
                                  ? "opacity-100"
                                  : "opacity-0"
                              }`}
                            />
                            {person.label}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedPeople.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedPeople.map((key) => (
                <Badge
                  key={key}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setPeople(toggle(selectedPeople, key))}
                >
                  {peopleLabels[key] || "Unknown"} ×
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
