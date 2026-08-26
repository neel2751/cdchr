"use client";

import { format } from "date-fns";
import {
  Building2,
  CheckCircle2,
  Globe,
  PauseCircle,
  Users,
  Plus,
  Loader2,
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
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTenant } from "@/server/tenantServer/platformServer";
import { useFetchQuery } from "@/hooks/use-query";
import { getTenants } from "@/server/tenantServer/tenantServer";

const STATUS_VARIANT = {
  active: "default",
  trial: "secondary",
  suspended: "destructive",
  cancelled: "outline",
};

/**
 * Read-only tenant list for the platform console.
 *
 * Phase 1 deliberately stops at reading. Creating and editing tenants — and in
 * particular writing domains, which changes who can reach what — lands once the
 * tenant scoping in Phase 2/3 is enforced.
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
            <NewTenantDialog />
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
                        <Badge
                          variant={STATUS_VARIANT[tenant.status] || "outline"}
                        >
                          {tenant.status}
                        </Badge>
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

/** Provision a company. Status starts as "trial" until the plan is set. */
const NewTenantDialog = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isPending, startTransition] = useTransition();

  // Suggest an address from the name, but let it be overridden.
  const onName = (value) => {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 63)
    );
  };

  const submit = () =>
    startTransition(async () => {
      const res = await createTenant({ name, slug });
      if (res?.success) {
        toast.success(res.message);
        setOpen(false);
        setName("");
        setSlug("");
        router.refresh();
      } else {
        toast.error(res?.message || "Could not create the company");
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New company
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>
            Creates an empty tenant. Add its super admin and branding afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-name">Company name</Label>
            <Input
              id="t-name"
              value={name}
              placeholder="Acme Ltd"
              onChange={(e) => onName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-slug">Workspace address</Label>
            <Input
              id="t-slug"
              value={slug}
              placeholder="acme"
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={isPending || !name.trim() || !slug.trim()}
            onClick={submit}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Create company
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TenantList;
