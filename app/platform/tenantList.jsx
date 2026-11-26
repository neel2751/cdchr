"use client";

import { format } from "date-fns";
import {
  Building2,
  CheckCircle2,
  Globe,
  PauseCircle,
  Users,
} from "lucide-react";

import SearchDebounce from "@/components/search/searchDebounce";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import NewCompanyDialog from "./newCompanyDialog";
import { useFetchQuery } from "@/hooks/use-query";
import { getTenants } from "@/server/tenantServer/tenantServer";

const STATUS_VARIANT = {
  active: "default",
  trial: "secondary",
  suspended: "destructive",
  cancelled: "outline",
};

/**
 * The tenant list for the platform console, and "New company"
 * (newCompanyDialog.jsx).
 */
const TenantList = ({ searchParams, stats }) => {
  const currentPage = parseInt(searchParams?.page || "1", 10);
  const pagePerData = parseInt(searchParams?.pageSize || "10", 10);
  const query = searchParams?.query;

  const {
    data: queryResult,
    isLoading,
    isError,
  } = useFetchQuery({
    params: { page: currentPage, pageSize: pagePerData, query },
    queryKey: ["platform-tenants", { query, currentPage, pagePerData }],
    fetchFn: getTenants,
  });

  const { newData: tenants = [], totalCount = 0 } = queryResult || {};

  const cards = [
    { label: "Tenants", value: stats?.total ?? 0, icon: Building2 },
    { label: "Active", value: stats?.active ?? 0, icon: CheckCircle2 },
    { label: "Suspended", value: stats?.suspended ?? 0, icon: PauseCircle },
    {
      label: "Custom domains",
      value: stats?.withCustomDomain ?? 0,
      icon: Globe,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase text-muted-foreground">
                  {label}
                </p>
                <p className="text-2xl font-semibold">{value}</p>
              </div>
              <Icon className="size-5 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="mb-4">
            <CardTitle>Tenants</CardTitle>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SearchDebounce placeholder="Search name, slug or domain" />
            <NewCompanyDialog />
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && (
            <div className="py-8 text-center text-muted-foreground">
              Loading…
            </div>
          )}
          {isError && (
            <div className="py-8 text-center text-destructive">
              Something went wrong
            </div>
          )}

          {!isLoading && !isError && tenants.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No tenants found
            </div>
          )}

          {tenants.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "tenant",
                      "slug",
                      "domains",
                      "status",
                      "plan",
                      "employees",
                      "created",
                    ].map((label) => (
                      <TableHead className="text-xs uppercase" key={label}>
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant._id}>
                      <TableCell>
                        <Link
                          href={`/platform/tenants/${tenant._id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {tenant.name}
                        </Link>
                        {tenant.description && (
                          <div className="text-xs text-muted-foreground">
                            {tenant.description}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {tenant.slug ? (
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {tenant.slug}
                          </code>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            not set
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        {tenant.domains.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            none
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {tenant.domains.map((domain) => (
                              <div
                                key={domain.host}
                                className="flex items-center gap-1.5 text-xs"
                              >
                                <span>{domain.host}</span>
                                {domain.isPrimary && (
                                  <Badge variant="outline">primary</Badge>
                                )}
                                {!domain.verified && (
                                  <Badge variant="secondary">unverified</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            variant={STATUS_VARIANT[tenant.status] || "outline"}
                          >
                            {tenant.status}
                          </Badge>
                          <AccessHint access={tenant.access} />
                          {tenant.needsReview && (
                            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                              check sign-up
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-sm">{tenant.plan}</TableCell>

                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <Users className="size-3.5 text-muted-foreground" />
                          {tenant.employeeCount}
                        </span>
                      </TableCell>

                      <TableCell className="text-sm">
                        {tenant.createdAt
                          ? format(new Date(tenant.createdAt), "PP")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {totalCount > pagePerData && (
            <div className="mt-2 border-t pt-4">
              <PaginationWithLinks
                page={currentPage}
                pageSize={pagePerData}
                totalCount={totalCount}
                pageSizeSelectOptions={{ pageSizeOptions: [10, 20, 50, 100] }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TenantList;

/**
 * What the status badge does not say: how long a trial has left, or that the
 * company is read-only or locked (lib/tenantAccess.js).
 */
function AccessHint({ access }) {
  if (!access) return null;
  if (access.reason === "demo") return <Badge variant="outline">demo</Badge>;
  if (access.level === "readOnly" || access.level === "locked") {
    return (
      <Badge variant="destructive">
        {access.level === "locked" ? "locked" : "read-only"}
      </Badge>
    );
  }
  if (access.level === "grace") return <Badge variant="outline">trial over</Badge>;
  if (access.reason === "trial" && access.daysLeft != null) {
    return (
      <span className="text-xs text-muted-foreground tabular-nums">
        {access.daysLeft}d left
      </span>
    );
  }
  return null;
}
