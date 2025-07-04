"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export const SelectFilter = React.memo(function SelectFilter({
  value,
  onChange,
  frameworks,
  placeholder,
  noData,
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`max-w-max justify-between ${
            value ? "text-neutral-900" : "text-neutral-500"
          }`}
        >
          {value
            ? frameworks?.find((framework) => framework?.value === value)?.label
            : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-max p-0">
        <Command
          filter={(value, search) => {
            const item = frameworks?.find((item) => item?.value === value);
            if (!item) return 0;
            if (item.label.toLowerCase().includes(search.toLowerCase()))
              return 1;

            return 0;
          }}
        >
          <CommandInput placeholder={placeholder ? placeholder : "Search..."} />
          <CommandList>
            <CommandEmpty>{noData ? noData : "No Data found."}</CommandEmpty>
            <CommandGroup>
              {frameworks &&
                frameworks?.map((framework) => (
                  <CommandItem
                    key={framework?.value}
                    value={framework?.value}
                    onSelect={(currentValue) => {
                      onChange(currentValue === value ? "" : currentValue);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === framework?.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {framework?.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
