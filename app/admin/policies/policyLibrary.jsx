"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { debounce } from "lodash";
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { toast } from "sonner";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FileText,
  Library,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchIcon,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { describeReviewDue, reviewUrgency } from "@/lib/policies";
import { cn } from "@/lib/utils";
import {
  getPolicies,
  getPolicyCategories,
  setPolicyCategoryArchived,
} from "@/server/policyServer/policyServer";
import { getSelectRoleType } from "@/server/selectServer/selectServer";
import { describeAudience } from "../announcements/constants";
import CategoryDialog from "./categoryDialog";
import { CategoryIcon } from "./categoryIcon";
import CategoryNav from "./categoryNav";
import NewPolicyDialog from "./newPolicyDialog";

const STATUSES = ["review", "draft", "active", "archived"];

const STATUS_TABS = [
  { value: null, label: "Current", count: "current" },
  { value: "review", label: "Needs review", count: "review" },
  { value: "draft", label: "Drafts", count: "draft" },
  { value: "active", label: "Published", count: "active" },
  { value: "archived", label: "Archived", count: "archived" },
];

const PAGE_SIZES = [10, 20, 50];

/**
 * Everything the library is filtered by, kept in the address bar: a filtered
 * view survives a refresh, the back button from a policy, and being pasted to
 * a colleague. The dashboard's "See all" links straight to ?status=review.
 *
 * Shallow — React Query fetches on the client, so there is nothing for the
 * server to re-render when a filter changes.
 */
const filterParsers = {
  category: parseAsString.withDefault(""),
  status: parseAsStringLiteral(STATUSES),
  query: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(10),
};

const URGENCY_CLASS = {
  overdue: "font-medium text-red-700",
  soon: "font-medium text-amber-700",
  ok: "",
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * The policy library.
 *
 * Categories down the side because that is how a policy is looked for —
 * "it's one of the fire ones" — and the table beside them answers the three
 * questions a manager comes here with: which version is in force, can staff
 * see it, and is somebody halfway through a new one.
 */
export default function PolicyLibrary() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useQueryStates(filterParsers, {
    clearOnDefault: true,
  });
  const { status, query } = filters;
  const page = Math.max(filters.page, 1);
  const pageSize = PAGE_SIZES.includes(filters.pageSize) ? filters.pageSize : 10;

  const [categoryDialog, setCategoryDialog] = useState(null); // {category?}
  const [newOpen, setNewOpen] = useState(false);
  // Bumped to empty the search box when the filters are cleared.
  const [searchKey, setSearchKey] = useState(0);

  // Every change of filter starts again from the first page.
  const applyFilter = (next) => setFilters({ ...next, page: null });

  const searchLater = useMemo(
    () =>
      debounce((value) => setFilters({ query: value.trim() || null, page: null }), 350),
    [setFilters],
  );
  // A search typed just before opening a policy must not land on that page's URL.
  useEffect(() => () => searchLater.cancel(), [searchLater]);

  const { data: categoryData, isLoading: categoriesLoading } = useFetchQuery({
    queryKey: ["policyCategories"],
    fetchFn: getPolicyCategories,
  });
  const categories = useMemo(() => categoryData?.newData || [], [categoryData]);
  const live = categories.filter((c) => !c.isArchived);
  const selected = categories.find((c) => String(c._id) === filters.category);
  // A category that has gone (a stale link) is ignored rather than showing
  // an empty library under no heading.
  const categoryId = categoriesLoading || selected ? filters.category : "";

  const { data: departments = [] } = useFetchSelectQuery({
    queryKey: ["roleTypeSelect"],
    fetchFn: getSelectRoleType,
  });
  const departmentNames = Object.fromEntries(
    departments.map((d) => [String(d.value), d.label]),
  );

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["policies", { query, page, pageSize, categoryId, status }],
    queryFn: async () => {
      const res = await getPolicies({
        query,
        page,
        pageSize,
        categoryId,
        ...(status === "review" ? { review: "due" } : { status: status || "" }),
      });
      if (res?.success === false) throw new Error(res.message);
      return {
        rows: res?.data ? JSON.parse(res.data) : [],
        totalCount: res?.totalCount || 0,
        counts: res?.counts || null,
      };
    },
    // The old page stays on screen while the next one loads, so switching a
    // tab does not flash the table empty.
    placeholderData: keepPreviousData,
  });
  const { rows = [], totalCount = 0, counts } = data || {};

  const { mutate: archiveCategory } = useMutation({
    mutationFn: ({ id, archive }) => setPolicyCategoryArchived(id, archive),
    onSuccess: (res, { id, archive }) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not update the category");
        return;
      }
      toast.success(res.message);
      if (archive && String(id) === filters.category) applyFilter({ category: null });
      queryClient.invalidateQueries({ queryKey: ["policyCategories"] });
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (err) => toast.error(err?.message || "Could not update the category"),
  });

  const filtered = !!(categoryId || status || query);
  const clearFilters = () => {
    searchLater.cancel();
    setSearchKey((k) => k + 1);
    setFilters(null);
  };

  const firstRow = totalCount ? (page - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(page * pageSize, totalCount);
  const pageCount = Math.max(Math.ceil(totalCount / pageSize), 1);

  return (
    <div className="grid items-start gap-4 p-4 lg:grid-cols-[15rem_1fr]">
      <CategoryNav
        categories={categories}
        loading={categoriesLoading}
        selectedId={categoryId}
        onSelect={(id) => applyFilter({ category: id || null })}
        onAdd={() => setCategoryDialog({})}
        onRestore={(category) => archiveCategory({ id: category._id, archive: false })}
      />

      <section className="min-w-0 rounded-xl border bg-white">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
              {selected ? (
                <CategoryIcon name={selected.name} className="size-5" />
              ) : (
                <Library className="size-5" aria-hidden />
              )}
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1">
                <h1 className="truncate text-lg font-semibold">
                  {selected ? selected.name : "All policies"}
                </h1>
                {selected && !selected.isArchived ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground"
                        aria-label={`${selected.name} options`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => setCategoryDialog({ category: selected })}
                      >
                        <Pencil className="mr-2 size-4" />
                        Rename category
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => archiveCategory({ id: selected._id, archive: true })}
                      >
                        <Archive className="mr-2 size-4" />
                        Archive category
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {selected?.isArchived ? <Badge variant="secondary">Archived</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {selected
                  ? selected.description || "Policies filed under this category."
                  : "Upload each policy, keep its versions, and choose which staff can read it."}
              </p>
            </div>
          </div>
          <Button onClick={() => setNewOpen(true)} disabled={!live.length}>
            <Plus className="mr-1 size-4" />
            New policy
          </Button>
        </header>

        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="-mx-1 overflow-x-auto px-1">
            <div role="group" aria-label="Status" className="flex w-max gap-1 rounded-lg bg-neutral-100 p-1">
              {STATUS_TABS.map((tab) => {
                const active = (status || null) === tab.value;
                const n = counts?.[tab.count];
                const attention = tab.value === "review" && n > 0;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyFilter({ status: tab.value })}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-white font-medium text-foreground shadow-sm"
                        : "text-neutral-600 hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {n != null ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-xs tabular-nums",
                          attention
                            ? "bg-amber-100 text-amber-800"
                            : "text-muted-foreground",
                        )}
                      >
                        {n}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full xl:w-64">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input
                key={searchKey}
                defaultValue={query}
                onChange={(e) => searchLater(e.target.value)}
                placeholder="Search by title"
                aria-label="Search policies by title"
                className="pl-9"
              />
            </div>
            {filtered ? (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
                <X className="mr-1 size-3.5" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        <div className={cn("transition-opacity", isFetching && !isLoading && "opacity-60")}>
          {isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              title="Something went wrong"
              text="The policies could not be loaded. Try again in a moment."
            />
          ) : rows.length === 0 ? (
            status === "review" && !query ? (
              <EmptyState
                title="Nothing needs review"
                text="No policy here is due for review in the next 30 days."
              />
            ) : query || status ? (
              <EmptyState
                title="No policies match"
                text="Try another search or status."
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={selected ? `Nothing in ${selected.name} yet` : "No policies yet"}
                text="Upload a policy to start the library."
                action={
                  live.length ? (
                    <Button size="sm" onClick={() => setNewOpen(true)}>
                      <Plus className="mr-1 size-4" />
                      New policy
                    </Button>
                  ) : null
                }
              />
            )
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Policy</TableHead>
                    {!selected ? <TableHead>Category</TableHead> : null}
                    <TableHead>Version</TableHead>
                    <TableHead>Who can see it</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="pr-5">Next review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row._id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admin/policies/${row._id}`)}
                    >
                      <TableCell className="max-w-xs pl-5">
                        <Link
                          href={`/admin/policies/${row._id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium hover:underline"
                        >
                          {row.title}
                        </Link>
                        {row.summary ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {row.summary}
                          </div>
                        ) : null}
                      </TableCell>
                      {!selected ? (
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-neutral-700">
                            <CategoryIcon
                              name={row.categoryName}
                              className="size-3.5 text-muted-foreground"
                            />
                            {row.categoryName}
                          </span>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {row.status === "archived" ? (
                            <Badge variant="secondary">Archived</Badge>
                          ) : row.currentVersionNumber ? (
                            <span className="tabular-nums">v{row.currentVersionNumber}</span>
                          ) : (
                            <span className="text-muted-foreground">Not published</span>
                          )}
                          {row.hasDraft ? <Badge variant="outline">Draft waiting</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.visibleToEmployees ? (
                          <div>
                            <div>{describeAudience(row.audience, departmentNames)}</div>
                            {row.readers ? (
                              <div className="text-xs text-muted-foreground">
                                {row.requireAck
                                  ? `${row.readers.acknowledged} of ${row.readers.total} confirmed`
                                  : `${row.readers.acknowledged + row.readers.opened} of ${row.readers.total} opened`}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <EyeOff className="size-3.5" />
                            Hidden
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{row.ownerName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap pr-5">
                        {row.status === "active" && row.nextReviewDate ? (
                          <div>
                            <div className={URGENCY_CLASS[reviewUrgency(row.daysUntilReview)]}>
                              {formatDate(row.nextReviewDate)}
                            </div>
                            {reviewUrgency(row.daysUntilReview) !== "ok" ? (
                              <div className="text-xs text-muted-foreground">
                                {describeReviewDue(row.daysUntilReview)}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">
                <span className="tabular-nums">
                  {firstRow}–{lastRow} of {totalCount}
                </span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline">Rows</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) => applyFilter({ pageSize: Number(value) })}
                    >
                      <SelectTrigger className="h-8 w-[4.5rem]" aria-label="Rows per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZES.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label="Previous page"
                      disabled={page <= 1}
                      onClick={() => setFilters({ page: page - 1 })}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="px-1 tabular-nums">
                      {page} / {pageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label="Next page"
                      disabled={page >= pageCount}
                      onClick={() => setFilters({ page: page + 1 })}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </footer>
            </>
          )}
        </div>
      </section>

      <CategoryDialog
        open={!!categoryDialog}
        onOpenChange={(open) => !open && setCategoryDialog(null)}
        category={categoryDialog?.category}
      />
      <NewPolicyDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        categories={categories}
        defaultCategoryId={categoryId}
      />
    </div>
  );
}

function EmptyState({ title, text, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
        <FileText className="size-5" />
      </span>
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
