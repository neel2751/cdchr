"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { describeColumns } from "@/lib/migration/columns";

/**
 * What the file is allowed to contain.
 *
 * Built from the same list the import validates against, so it cannot describe
 * a column that is not accepted or miss one that is. Collapsed by default:
 * thirty rows of reference material is not what somebody needs on the way in,
 * and is exactly what they need when a row is refused.
 */
export default function ColumnGuide({ kind }) {
  const [open, setOpen] = useState(false);
  const columns = useMemo(() => describeColumns(kind), [kind]);

  const required = columns.filter((column) => column.required);

  return (
    <section className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <span>
          <span className="block text-sm font-semibold">Columns</span>
          <span className="block text-xs text-muted-foreground">
            {columns.length} accepted, {required.length} of them required
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="max-h-[28rem] space-y-2.5 overflow-y-auto border-t p-4">
          <p className="text-xs text-muted-foreground">
            Header names are matched loosely — &ldquo;Surname&rdquo;,
            &ldquo;Last Name&rdquo; and &ldquo;last_name&rdquo; are the same
            column. Anything not on this list is ignored.
          </p>

          {columns.map((column) => (
            <div key={column.key} className="text-xs">
              <p className="font-medium">
                {column.header}
                {column.required && (
                  <span className="ml-1.5 text-destructive">required</span>
                )}
                {column.softRequired && (
                  <span className="ml-1.5 text-muted-foreground">
                    filled in if blank
                  </span>
                )}
                {column.sensitive && (
                  <span className="ml-1.5 text-muted-foreground">
                    protected
                  </span>
                )}
              </p>
              <p className="text-muted-foreground">
                {column.help || column.accepts}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
