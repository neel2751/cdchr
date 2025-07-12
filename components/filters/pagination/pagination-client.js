"use client";
import { cn } from "@/lib/utils";

import { useQueryState, parseAsInteger } from "nuqs";
import { SelectRowsPerPage } from "./page-size";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export function PaginationWithLinks({
  totalCount,
  pageSizeOptions = [10, 20, 50],
}) {
  const [page, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({
      shallow: false,
      throttleMs: 500,
    })
  );
  const [pageSize, setPageSize] = useQueryState(
    "pageSize",
    parseAsInteger.withDefault(10).withOptions({
      shallow: false,
      throttleMs: 500,
    })
  );

  const totalPageCount = Math.ceil(totalCount / pageSize);

  const sanitizePage = (p) => {
    return Math.max(1, Math.min(p, totalPageCount));
  };

  const renderPageNumbers = () => {
    const items = [];
    const maxVisiblePages = 5;

    if (totalPageCount <= maxVisiblePages) {
      for (let i = 1; i <= totalPageCount; i++) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              href={`?page=${i}`}
              onClick={() => setPage(i)}
              isActive={page === i}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      }
    } else {
      items.push(
        <PaginationItem key={1}>
          <PaginationLink
            href={`?page=1`}
            onClick={() => setPage(1)}
            isActive={page === 1}
          >
            1
          </PaginationLink>
        </PaginationItem>
      );

      if (page > 3) {
        items.push(
          <PaginationItem key="ellipsis-start">
            <PaginationEllipsis />
          </PaginationItem>
        );
      }

      const start = Math.max(2, page - 1);
      const end = Math.min(totalPageCount - 1, page + 1);

      for (let i = start; i <= end; i++) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              href={`?page=${i}`}
              onClick={() => setPage(i)}
              isActive={page === i}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      }

      if (page < totalPageCount - 2) {
        items.push(
          <PaginationItem key="ellipsis-end">
            <PaginationEllipsis />
          </PaginationItem>
        );
      }

      items.push(
        <PaginationItem key={totalPageCount}>
          <PaginationLink
            href={`?page=${totalPageCount}`}
            onClick={() => setPage(totalPageCount)}
            isActive={page === totalPageCount}
          >
            {totalPageCount}
          </PaginationLink>
        </PaginationItem>
      );
    }

    return items;
  };

  return (
    <div className="flex flex-col md:flex-row items-center gap-3 w-full">
      <div className="flex flex-col gap-4 flex-1">
        <SelectRowsPerPage
          options={pageSizeOptions}
          pageSize={pageSize}
          setPageSize={(newSize) => {
            setPageSize(newSize);
            setPage(1); // Reset to page 1 when pageSize changes
          }}
        />
      </div>
      <Pagination className={cn({ "md:justify-end": true })}>
        <PaginationContent className="max-sm:gap-0">
          <PaginationItem>
            <PaginationPrevious
              href={`?page=${page - 1}`}
              onClick={() => setPage(sanitizePage(page - 1))}
              aria-disabled={page === 1}
              className={page === 1 ? "pointer-events-none opacity-50" : ""}
            />
          </PaginationItem>
          {renderPageNumbers()}
          <PaginationItem>
            <PaginationNext
              href={`?page=${page + 1}`}
              onClick={() => setPage(sanitizePage(page + 1))}
              aria-disabled={page === totalPageCount}
              className={
                page === totalPageCount ? "pointer-events-none opacity-50" : ""
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
