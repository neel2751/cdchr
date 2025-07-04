// "use client";

// import { useEffect } from "react";
// import {
//   Pagination,
//   PaginationContent,
//   PaginationEllipsis,
//   PaginationItem,
//   PaginationLink,
//   PaginationNext,
//   PaginationPrevious,
// } from "../ui/pagination";

// import { usePathname, useRouter, useSearchParams } from "next/navigation";
// import { cn } from "@/lib/utils";
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "../ui/select";

// export function PaginationWithLinks({
//   pageSizeSelectOptions,
//   pageSize,
//   totalCount,
//   page,
//   pageSearchParam,
// }) {
//   const router = useRouter();
//   const pathname = usePathname();
//   const searchParams = useSearchParams();

//   const totalPageCount = Math.ceil(totalCount / pageSize);

//   // Validate and sanitize page number
//   const sanitizePageNumber = (newPage) => {
//     if (isNaN(newPage) || newPage < 1) return 1; // Default to 1 if NaN or less than 1
//     if (newPage > totalPageCount) return totalPageCount; // Cap at max pages
//     return newPage;
//   };

//   useEffect(() => {
//     if (!searchParams) return;

//     const rawPage = searchParams.get(pageSearchParam || "page");
//     const currentPage = rawPage !== null ? parseInt(rawPage, 10) : 1;

//     const validPage = sanitizePageNumber(currentPage);
//     console.log(validPage, "validPage");
//     console.log(currentPage, "currentPage");

//     // If the page parameter is invalid, fix it and redirect
//     if (currentPage !== validPage) {
//       const newSearchParams = new URLSearchParams(searchParams.toString());
//       newSearchParams.set(pageSearchParam || "page", String(validPage));
//       router.replace(`${pathname}?${newSearchParams.toString()}`);
//     }
//   }, [searchParams, pathname, totalPageCount]); // Re-run when URL changes

//   const buildLink = (newPage) => {
//     const sanitizedPage = sanitizePageNumber(newPage);
//     const key = pageSearchParam || "page";
//     if (!searchParams) return `${pathname}?${key}=${sanitizedPage}`;
//     const newSearchParams = new URLSearchParams(searchParams);
//     newSearchParams.set(key, String(sanitizedPage));
//     return `${pathname}?${newSearchParams.toString()}`;
//   };

//   const navToPageSize = (newPageSize) => {
//     const key = pageSizeSelectOptions?.pageSizeSearchParam || "pageSize";
//     const pageKey = pageSearchParam || "page";
//     const newSearchParams = new URLSearchParams(searchParams || undefined);

//     if (newPageSize < 1) newPageSize = 1; // Ensure pageSize is valid
//     newSearchParams.set(key, String(newPageSize));
//     newSearchParams.set(pageKey, "1"); // Reset to page 1

//     router.push(`${pathname}?${newSearchParams.toString()}`);
//   };

//   const renderPageNumbers = () => {
//     const items = [];
//     const maxVisiblePages = 5;

//     if (totalPageCount <= maxVisiblePages) {
//       for (let i = 1; i <= totalPageCount; i++) {
//         items.push(
//           <PaginationItem key={i}>
//             <PaginationLink href={buildLink(i)} isActive={page === i}>
//               {i}
//             </PaginationLink>
//           </PaginationItem>
//         );
//       }
//     } else {
//       items.push(
//         <PaginationItem key={1}>
//           <PaginationLink href={buildLink(1)} isActive={page === 1}>
//             1
//           </PaginationLink>
//         </PaginationItem>
//       );

//       if (page > 3) {
//         items.push(
//           <PaginationItem key="ellipsis-start">
//             <PaginationEllipsis />
//           </PaginationItem>
//         );
//       }

//       const start = Math.max(2, page - 1);
//       const end = Math.min(totalPageCount - 1, page + 1);

//       for (let i = start; i <= end; i++) {
//         items.push(
//           <PaginationItem key={i}>
//             <PaginationLink href={buildLink(i)} isActive={page === i}>
//               {i}
//             </PaginationLink>
//           </PaginationItem>
//         );
//       }

//       if (page < totalPageCount - 2) {
//         items.push(
//           <PaginationItem key="ellipsis-end">
//             <PaginationEllipsis />
//           </PaginationItem>
//         );
//       }

//       items.push(
//         <PaginationItem key={totalPageCount}>
//           <PaginationLink
//             href={buildLink(totalPageCount)}
//             isActive={page === totalPageCount}
//           >
//             {totalPageCount}
//           </PaginationLink>
//         </PaginationItem>
//       );
//     }

//     return items;
//   };

//   return (
//     <div className="flex flex-col md:flex-row items-center gap-3 w-full">
//       {pageSizeSelectOptions && (
//         <div className="flex flex-col gap-4 flex-1">
//           <SelectRowsPerPage
//             options={pageSizeSelectOptions.pageSizeOptions}
//             setPageSize={navToPageSize}
//             pageSize={pageSize}
//           />
//         </div>
//       )}
//       <Pagination className={cn({ "md:justify-end": pageSizeSelectOptions })}>
//         <PaginationContent className="max-sm:gap-0">
//           <PaginationItem>
//             <PaginationPrevious
//               href={buildLink(Math.max(page - 1, 1))}
//               aria-disabled={page === 1}
//               tabIndex={page === 1 ? -1 : undefined}
//               className={
//                 page === 1 ? "pointer-events-none opacity-50" : undefined
//               }
//             />
//           </PaginationItem>
//           {renderPageNumbers()}
//           <PaginationItem>
//             <PaginationNext
//               href={buildLink(Math.min(page + 1, totalPageCount))}
//               aria-disabled={page === totalPageCount}
//               tabIndex={page === totalPageCount ? -1 : undefined}
//               className={
//                 page === totalPageCount
//                   ? "pointer-events-none opacity-50"
//                   : undefined
//               }
//             />
//           </PaginationItem>
//         </PaginationContent>
//       </Pagination>
//     </div>
//   );
// }

// function SelectRowsPerPage({ options, setPageSize, pageSize }) {
//   return (
//     <div className="flex items-center gap-4">
//       <span className="whitespace-nowrap text-sm">Rows per page</span>

//       <Select
//         value={String(pageSize)}
//         onValueChange={(value) => setPageSize(Number(value))}
//       >
//         <SelectTrigger>
//           <SelectValue placeholder="Select page size">
//             {String(pageSize)}
//           </SelectValue>
//         </SelectTrigger>
//         <SelectContent>
//           {options?.map((option) => (
//             <SelectItem key={option} value={String(option)}>
//               {option}
//             </SelectItem>
//           ))}
//         </SelectContent>
//       </Select>
//     </div>
//   );
// }

"use client";

import { useCallback } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../ui/pagination";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export function PaginationWithLinks({
  pageSizeSelectOptions,
  pageSize,
  totalCount,
  page,
  pageSearchParam,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPageCount = Math.ceil(totalCount / pageSize);

  // Validate and sanitize page number
  const sanitizePageNumber = (newPage) => {
    if (newPage < 1) return 1; // Minimum page is 1
    if (newPage > totalPageCount) return totalPageCount; // Maximum page is totalPageCount
    return newPage;
  };

  // Function to build links with valid page numbers
  const buildLink = useCallback(
    (newPage) => {
      const sanitizedPage = sanitizePageNumber(newPage);
      const key = pageSearchParam || "page";
      if (!searchParams) return `${pathname}?${key}=${sanitizedPage}`;
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set(key, String(sanitizedPage));
      return `${pathname}?${newSearchParams.toString()}`;
    },
    [searchParams, pathname, totalPageCount]
  );

  const navToPageSize = useCallback(
    (newPageSize) => {
      const key = pageSizeSelectOptions?.pageSizeSearchParam || "pageSize";
      const pageKey = pageSearchParam || "page";
      const sanitizedPage = sanitizePageNumber(1); // Reset to page 1 on page size change
      const newSearchParams = new URLSearchParams(searchParams || undefined);

      // Ensure the new page size is valid
      if (newPageSize < 1) newPageSize = 1;

      newSearchParams.set(key, String(newPageSize));
      newSearchParams.set(pageKey, String(sanitizedPage));

      router.push(`${pathname}?${newSearchParams.toString()}`);
    },
    [searchParams, pathname, totalPageCount]
  );

  const renderPageNumbers = () => {
    const items = [];
    const maxVisiblePages = 5;

    if (totalPageCount <= maxVisiblePages) {
      for (let i = 1; i <= totalPageCount; i++) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink href={buildLink(i)} isActive={page === i}>
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      }
    } else {
      items.push(
        <PaginationItem key={1}>
          <PaginationLink href={buildLink(1)} isActive={page === 1}>
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
            <PaginationLink href={buildLink(i)} isActive={page === i}>
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
            href={buildLink(totalPageCount)}
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
      {pageSizeSelectOptions && (
        <div className="flex flex-col gap-4 flex-1">
          <SelectRowsPerPage
            options={pageSizeSelectOptions.pageSizeOptions}
            setPageSize={navToPageSize}
            pageSize={pageSize}
          />
        </div>
      )}
      <Pagination className={cn({ "md:justify-end": pageSizeSelectOptions })}>
        <PaginationContent className="max-sm:gap-0">
          <PaginationItem>
            <PaginationPrevious
              href={buildLink(Math.max(page - 1, 1))}
              aria-disabled={page === 1}
              tabIndex={page === 1 ? -1 : undefined}
              className={
                page === 1 ? "pointer-events-none opacity-50" : undefined
              }
            />
          </PaginationItem>
          {renderPageNumbers()}
          <PaginationItem>
            <PaginationNext
              href={buildLink(Math.min(page + 1, totalPageCount))}
              aria-disabled={page === totalPageCount}
              tabIndex={page === totalPageCount ? -1 : undefined}
              className={
                page === totalPageCount
                  ? "pointer-events-none opacity-50"
                  : undefined
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

function SelectRowsPerPage({ options, setPageSize, pageSize }) {
  return (
    <div className="flex items-center gap-4">
      <span className="whitespace-nowrap text-sm">Rows per page</span>

      <Select
        value={String(pageSize)}
        onValueChange={(value) => setPageSize(Number(value))}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select page size">
            {String(pageSize)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options?.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
