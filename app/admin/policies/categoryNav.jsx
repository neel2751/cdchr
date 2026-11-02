"use client";

import { useState } from "react";
import { ArchiveRestore, ChevronRight, Library, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "./categoryIcon";

/**
 * The library's shelves, as a filter.
 *
 * A list down the side on a wide screen, and a row of chips that scrolls
 * sideways on a narrow one — the same choices either way, so a category
 * chosen on a laptop is still chosen when the window is narrowed.
 *
 * Renaming and archiving live with the chosen category's title, not here, so
 * they work the same on a phone as with a mouse.
 */
export default function CategoryNav({
  categories,
  loading,
  selectedId,
  onSelect,
  onAdd,
  onRestore,
}) {
  const live = categories.filter((c) => !c.isArchived);
  const archived = categories.filter((c) => c.isArchived);
  const allCount = live.reduce((n, c) => n + (c.policyCount || 0), 0);

  const entries = [
    { id: "", name: "All policies", count: allCount, all: true },
    ...live.map((c) => ({ id: String(c._id), name: c.name, count: c.policyCount || 0 })),
  ];

  return (
    <>
      {/* Wide screens: a list down the side. */}
      <nav
        aria-label="Policy categories"
        className="hidden rounded-xl border bg-white p-2 lg:sticky lg:top-4 lg:block"
      >
        <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Categories
        </p>
        {loading ? (
          <div className="space-y-1.5 px-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((entry) => (
              <li key={entry.id || "all"}>
                <SideItem
                  entry={entry}
                  active={entry.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="ghost"
          className="mt-2 w-full justify-start gap-3 border border-dashed px-2 text-muted-foreground hover:text-foreground"
          onClick={onAdd}
        >
          <span className="flex size-7 items-center justify-center">
            <Plus className="size-4" />
          </span>
          New category
        </Button>

        {archived.length ? (
          <ArchivedCategories archived={archived} onRestore={onRestore} />
        ) : null}
      </nav>

      {/* Narrow screens: chips that scroll sideways. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden">
        <div className="flex w-max gap-2">
          {loading
            ? Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-full" />
              ))
            : entries.map((entry) => {
                const active = entry.id === selectedId;
                return (
                  <button
                    key={entry.id || "all"}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(entry.id)}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-white text-neutral-700 hover:bg-neutral-50",
                    )}
                  >
                    {entry.all ? (
                      <Library className="size-3.5" aria-hidden />
                    ) : (
                      <CategoryIcon name={entry.name} className="size-3.5" />
                    )}
                    {entry.name}
                    <span
                      className={cn(
                        "tabular-nums text-xs",
                        active ? "text-primary-foreground/70" : "text-muted-foreground",
                      )}
                    >
                      {entry.count}
                    </span>
                  </button>
                );
              })}
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New
          </button>
        </div>
      </div>
    </>
  );
}

function SideItem({ entry, active, onSelect }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(entry.id)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-neutral-100 font-medium text-foreground"
          : "text-neutral-600 hover:bg-neutral-50 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-white text-neutral-500",
        )}
      >
        {entry.all ? (
          <Library className="size-3.5" aria-hidden />
        ) : (
          <CategoryIcon name={entry.name} className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      <span
        className={cn(
          "min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums",
          active ? "bg-white text-foreground" : "text-muted-foreground",
        )}
      >
        {entry.count}
      </span>
    </button>
  );
}

function ArchivedCategories({ archived, onRestore }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3 border-t pt-2">
      <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        Archived ({archived.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-0.5">
          {archived.map((category) => (
            <li
              key={category._id}
              className="flex items-center gap-2 rounded-md py-1 pl-2 text-sm text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => onRestore(category)}
              >
                <ArchiveRestore className="mr-1 size-3.5" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
