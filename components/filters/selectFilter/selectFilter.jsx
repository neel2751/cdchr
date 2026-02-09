"use client";
import React from "react";
import { useQueryState, parseAsString } from "nuqs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SelectFilter({ name, label, options }) {
  const [isLoading, startTransition] = React.useTransition();

  const [value, setValue] = useQueryState(
    name,
    parseAsString.withDefault("").withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={setValue} disabled={isLoading}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
