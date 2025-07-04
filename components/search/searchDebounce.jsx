"use client";
import React, { forwardRef, memo, useId } from "react";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { debounce } from "lodash";

const SearchDebounce = memo(
  forwardRef(function SearchDebounce(
    { placeholder, className, onChange, ...prop },
    ref
  ) {
    const searchParams = useSearchParams();
    const pathName = usePathname();
    const { replace } = useRouter();

    const handleSearch = debounce((term) => {
      const params = new URLSearchParams(searchParams);
      const newTerm = term.trim();
      // if there is only space  in the search term, remove it
      if (newTerm === " ") {
        return;
      }
      if (newTerm) {
        params.set("query", newTerm);
      } else {
        params.delete("query");
      }
      replace(`${pathName}?${params.toString()}`);
    }, 1000);

    const searchId = useId();
    return (
      <div className="lg:pr-3">
        <Label htmlFor={searchId} className="sr-only">
          Search
        </Label>
        <div className={`${className} mt-1 relative`}>
          <Input
            ref={ref}
            {...prop}
            onChange={(e) => {
              handleSearch(e.target.value);
            }}
            type="text"
            id={searchId}
            placeholder={placeholder ?? "Search"}
            className="ps-9"
            defaultValue={searchParams.get("query")?.toString()}
          />
          <div className="absolute inset-y-0 start-0 flex items-center pointer-events-none ps-3">
            <SearchIcon className="size-4 text-neutral-400" />
          </div>
        </div>
      </div>
    );
  })
);

export default SearchDebounce;
