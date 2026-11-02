"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectOfficeEmployee } from "@/server/selectServer/selectServer";

// Radix Select cannot hold an empty value, so "no owner" needs a stand-in.
const NO_OWNER = "none";

/**
 * Title, category, owner and summary — the parts of a policy that are not a
 * file. Used by the "New policy" dialog and the Details tab, so the two
 * cannot drift into asking for different things.
 *
 * Controlled: the caller holds `value` and decides when to save.
 *
 * @param {{value: object, onChange: Function, categories: Array}} props
 */
export default function PolicyDetailsForm({ value, onChange, categories = [] }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const { data: staff = [] } = useFetchSelectQuery({
    queryKey: ["officeEmployeeSelect"],
    fetchFn: getSelectOfficeEmployee,
  });

  const liveCategories = categories.filter(
    (c) => !c.isArchived || String(c._id) === String(value.categoryId),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="policy-title">Title</Label>
        <Input
          id="policy-title"
          value={value.title || ""}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Fire Evacuation Procedure"
          maxLength={200}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select
            value={value.categoryId ? String(value.categoryId) : undefined}
            onValueChange={(v) => set({ categoryId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {liveCategories.map((c) => (
                <SelectItem key={c._id} value={String(c._id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Owner</Label>
          <Select
            value={value.ownerId ? String(value.ownerId) : NO_OWNER}
            onValueChange={(v) => set({ ownerId: v === NO_OWNER ? null : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="No owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OWNER}>No owner</SelectItem>
              {staff.map((person) => (
                <SelectItem key={person.value} value={String(person.value)}>
                  {person.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The person responsible for keeping it up to date.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="policy-summary">Summary</Label>
        <Textarea
          id="policy-summary"
          value={value.summary || ""}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="One or two lines on what this policy covers. Staff see this before they open it."
          rows={3}
          maxLength={2000}
        />
      </div>
    </div>
  );
}
