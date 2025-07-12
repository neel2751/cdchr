"use client";
import React from "react";
import { useQueryState, parseAsString } from "nuqs";
import { SelectWithSearch } from "@/components/form/searchable-select";

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
      <SelectWithSearch
        value={value}
        options={options}
        label={label}
        setValue={setValue}
      />
    </div>
  );
}
