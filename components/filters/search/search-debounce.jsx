"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchIcon } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import React from "react";

const SearchDebounce = ({ className, placeholder, props }) => {
  const searchId = React.useId();
  const [isLoading, startTransition] = React.useTransition();
  const [query, setQuery] = useQueryState(
    "query",
    parseAsString.withDefault("").withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );
  return (
    <div className="lg:pr-3">
      <Label htmlFor={searchId} className="sr-only">
        Search
      </Label>
      <div className={`${className} mt-1 relative`}>
        <Input
          {...props}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          type="text"
          id={searchId}
          placeholder={placeholder ?? "Search"}
          className="ps-9"
          defaultValue={query}
        />
        <div className="absolute inset-y-0 start-0 flex items-center pointer-events-none ps-3">
          <SearchIcon className="size-4 text-neutral-400" />
        </div>
      </div>
    </div>
  );
};

export default SearchDebounce;
