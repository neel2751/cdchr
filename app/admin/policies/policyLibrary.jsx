"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react";

import SearchDebounce from "@/components/search/searchDebounce";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
import {
  getPolicies,
  getPolicyCategories,
  setPolicyCategoryArchived,
} from "@/server/policyServer/policyServer";
import { getSelectRoleType } from "@/server/selectServer/selectServer";
import { describeReviewDue, reviewUrgency } from "@/lib/policies";
import { describeAudience } from "../announcements/constants";
import CategoryDialog from "./categoryDialog";
import NewPolicyDialog from "./newPolicyDialog";

const STATUS_OPTIONS = [
  { label: "Current", value: "" },
  { label: "Needs review", value: "review" },
  { label: "Not yet published", value: "draft" },
  { label: "Published", value: "active" },
  { label: "Archived", value: "archived" },
];

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
export default function PolicyLibrary({ searchParams }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;

  const [categoryId, setCategoryId] = useState("");
  // The dashboard's "See all" arrives as ?review=due.
  const [status, setStatus] = useState(
    searchParams?.review === "due" ? "review" : "",
  );
  const [showArchived, setShowArchived] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(null); // {category?}
  const [newOpen, setNewOpen] = useState(false);

  const { data: categoryData, isLoading: categoriesLoading } = useFetchQuery({
    queryKey: ["policyCategories"],
    fetchFn: getPolicyCategories,
  });
  const categories = categoryData?.newData || [];
  const live = categories.filter((c) => !c.isArchived);
  const archived = categories.filter((c) => c.isArchived);
  const selected = categories.find((c) => String(c._id) === categoryId);

  const { data: departments = [] } = useFetchSelectQuery({
    queryKey: ["roleTypeSelect"],
    fetchFn: getSelectRoleType,
  });
  const departmentNames = Object.fromEntries(
    departments.map((d) => [String(d.value), d.label]),
  );

  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
      categoryId,
      ...(status === "review" ? { review: "due" } : { status }),
    },
    queryKey: ["policies", { query, currentPage, pagePerData, categoryId, status }],
    fetchFn: getPolicies,
  });
  const { newData: rows = [], totalCount = 0 } = data || {};

  const { mutate: archiveCategory } = useMutation({
    mutationFn: ({ id, archive }) => setPolicyCategoryArchived(id, archive),
    onSuccess: (res, { id, archive }) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not update the category");
        return;
      }
      toast.success(res.message);
      if (archive && id === categoryId) setCategoryId("");
      queryClient.invalidateQueries({ queryKey: ["policyCategories"] });
    },
    onError: (err) => toast.error(err?.message || "Could not update the category"),
  });

  const categoryButton = (category) => {
    const active = category ? String(category._id) === categoryId : !categoryId;
    return (
      <button
        type="button"
        onClick={() => setCategoryId(category ? String(category._id) : "")}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
          active ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"
        }`}
      >
        <span className="truncate">{category ? category.name : "All policies"}</span>
        {category ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {category.policyCount}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="grid items-start gap-4 p-4 lg:grid-cols-[16rem_1fr]">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Categories</CardTitle>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Add a category"
              onClick={() => setCategoryDialog({})}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {categoriesLoading ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              {categoryButton(null)}
              {live.map((category) => (
                <div key={category._id} className="group flex items-center gap-1">
                  <div className="min-w-0 flex-1">{categoryButton(category)}</div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 opacity-60 group-hover:opacity-100"
                        aria-label={`${category.name} options`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setCategoryDialog({ category })}>
                        <Pencil className="mr-2 size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => archiveCategory({ id: category._id, archive: true })}
                      >
                        <Archive className="mr-2 size-4" />
                        Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}

              {archived.length ? (
                <div className="pt-3">
                  <button
                    type="button"
                    className="px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowArchived((v) => !v)}
                  >
                    {showArchived ? "Hide" : "Show"} {archived.length} archived
                  </button>
                  {showArchived
                    ? archived.map((category) => (
                        <div
                          key={category._id}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm text-muted-foreground"
                        >
                          <span className="truncate">{category.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() =>
                              archiveCategory({ id: category._id, archive: false })
                            }
                          >
                            <ArchiveRestore className="mr-1 size-3.5" />
                            Restore
                          </Button>
                        </div>
                      ))
                    : null}
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <CommonContext.Provider value={{ result: rows, currentPage, pagePerData, totalCount }}>
        <Card className="min-w-0">
          <CardHeader>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{selected ? selected.name : "Policies"}</CardTitle>
                <CardDescription>
                  {selected?.description ||
                    "Upload each policy, keep its versions, and choose which staff can read it."}
                </CardDescription>
              </div>
              <Button onClick={() => setNewOpen(true)} disabled={!live.length}>
                <Plus className="mr-1 size-4" />
                New policy
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SearchDebounce placeholder="Search by title..." />
              <SelectFilter
                label="Status"
                value={status}
                frameworks={STATUS_OPTIONS}
                placeholder="Current"
                onChange={setStatus}
                noData="No statuses"
              />
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="flex h-20 w-full items-center justify-center">
                <Loader2 className="size-10 animate-spin text-neutral-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-gray-500">Something went wrong</div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {status === "review" && !query
                  ? "Nothing is due for review in the next 30 days."
                  : query || status
                  ? "No policies match."
                  : selected
                    ? `Nothing in ${selected.name} yet.`
                    : "No policies yet. Start with New policy."}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy</TableHead>
                      {!selected ? <TableHead>Category</TableHead> : null}
                      <TableHead>Version</TableHead>
                      <TableHead>Who can see it</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Next review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row._id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/admin/policies/${row._id}`)}
                      >
                        <TableCell className="max-w-xs">
                          <div className="font-medium">{row.title}</div>
                          {row.summary ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {row.summary}
                            </div>
                          ) : null}
                        </TableCell>
                        {!selected ? <TableCell>{row.categoryName}</TableCell> : null}
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
                        <TableCell className="whitespace-nowrap">
                          {row.status === "active" && row.nextReviewDate ? (
                            <div>
                              <div
                                className={URGENCY_CLASS[reviewUrgency(row.daysUntilReview)]}
                              >
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
                {totalCount > pagePerData ? (
                  <div className="mt-2 border-t pt-4">
                    <Pagination />
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </CommonContext.Provider>

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
