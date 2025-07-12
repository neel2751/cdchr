import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "../ui/pagination";
import { cn } from "@/lib/utils";
import { searchParamsCache, serialize } from "./searchParam";
import { headers } from "next/headers";

// Use <Link> components to navigate between pages
export async function ServerPaginationControls({ numPages }) {
  const { page } = searchParamsCache.all();
  function pageURL(page) {
    return serialize("/employee", {
      page,
    });
  }

  // Get full URL From request headers
  const headerList = await headers();
  const fullUrl = headerList.get("x-url") || headerList.get("referer") || "";
  const parsedUrl = new URL(fullUrl, "http://localhost"); // default to localhost
  const basePath = parsedUrl.pathname;
  console.log(basePath);

  return (
    <Pagination className="not-prose items-center gap-2">
      <PaginationContent>
        <PaginationItem>
          <PaginationLink
            href={pageURL(page - 1)}
            disabled={page === 1}
            scroll={false}
          />
        </PaginationItem>
        {Array.from({ length: numPages }, (_, i) => (
          <PaginationItem key={i}>
            <PaginationLink
              href={pageURL(i + 1)}
              isActive={page === i + 1}
              scroll={false}
            >
              {i + 1}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationLink
            disabled={page === numPages}
            href={pageURL(page + 1)}
            scroll={false}
          />
        </PaginationItem>
      </PaginationContent>
      <div
        aria-label={"Loading status unavailable on the server"}
        className={cn("h-2 w-2 rounded-full bg-zinc-500")}
      />
    </Pagination>
  );
}
