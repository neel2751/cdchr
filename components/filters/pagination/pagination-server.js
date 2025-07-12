// pagination/ServerPagination.tsx
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
  PaginationPrevious,
  PaginationNext,
} from "../ui/pagination";

import { serialize, searchParamsCache } from "./searchParam";

export async function ServerPagination({ totalCount }) {
  const { page, pageSize } = searchParamsCache.all();
  const totalPageCount = Math.ceil(totalCount / pageSize);

  const sanitizePage = (p) => Math.max(1, Math.min(p, totalPageCount));

  const renderPageLinks = () => {
    const items = [];
    const maxVisiblePages = 5;

    if (totalPageCount <= maxVisiblePages) {
      for (let i = 0; i <= totalPageCount; i++) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              href={serialize({ page: i })}
              isActive={page === i}
              scroll={false}
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
            href={serialize({ page: 1 })}
            isActive={page === 1}
            scroll={false}
          >
            1
          </PaginationLink>
        </PaginationItem>
      );

      if (page > 3) {
        items.push(
          <PaginationItem key="start-ellipsis">
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
              href={serialize({ page: i })}
              isActive={page === i}
              scroll={false}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      }

      if (page < totalPageCount - 2) {
        items.push(
          <PaginationItem key="end-ellipsis">
            <PaginationEllipsis />
          </PaginationItem>
        );
      }

      items.push(
        <PaginationItem key={totalPageCount}>
          <PaginationLink
            href={serialize({ page: totalPageCount })}
            isActive={page === totalPageCount}
            scroll={false}
          >
            {totalPageCount}
          </PaginationLink>
        </PaginationItem>
      );
    }

    return items;
  };

  return (
    <Pagination className="not-prose items-center gap-2">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href={serialize({ page: sanitizePage(page - 1) })}
            disabled={page === 1}
            scroll={false}
            aria-disabled={page === 1}
            className={page === 1 ? "pointer-events-none opacity-50" : ""}
          />
        </PaginationItem>
        {renderPageLinks()}
        <PaginationItem>
          <PaginationNext
            aria-disabled={page === totalPageCount}
            href={serialize({ page: sanitizePage(page + 1) })}
            disabled={page === totalPageCount}
            scroll={false}
            className={
              page === totalPageCount ? "pointer-events-none opacity-50" : ""
            }
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
