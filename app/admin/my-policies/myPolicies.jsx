"use client";

import { useMemo, useState } from "react";
import { ExternalLink, FileText, Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFetchQuery } from "@/hooks/use-query";
import {
  getMyPolicies,
  openMyPolicy,
} from "@/server/policyServer/myPolicyServer";
import { openSignedFile } from "../policies/openSignedFile";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

/**
 * The company's policies, as one member of staff may read them.
 *
 * Grouped by category because that is how people look — "the fire one" —
 * and filtered on the server, so this page only ever holds what this person
 * is allowed to see. Each policy opens its version in force; earlier
 * versions are a manager's concern and are not offered here.
 *
 * "Updated" stays on a policy for a month after a new version, with what
 * changed, so somebody who read the old one knows to read it again.
 */
export default function MyPolicies() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useFetchQuery({
    queryKey: ["myPolicies"],
    fetchFn: getMyPolicies,
  });
  const groups = useMemo(() => data?.newData || [], [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((group) => ({
        ...group,
        policies: group.policies.filter(
          (p) =>
            p.title.toLowerCase().includes(term) ||
            (p.summary || "").toLowerCase().includes(term) ||
            group.name.toLowerCase().includes(term),
        ),
      }))
      .filter((group) => group.policies.length);
  }, [groups, search]);

  const total = groups.reduce((n, g) => n + g.policies.length, 0);

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Company policies</CardTitle>
              <CardDescription>
                The policies that apply to you. Each one opens the version in
                force today.
              </CardDescription>
            </div>
            {total > 5 ? (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search policies"
                  className="pl-8"
                />
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Something went wrong. Try again in a moment.
            </p>
          ) : total === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No policies have been shared with you yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No policies match “{search}”.
            </p>
          ) : (
            <div className="space-y-8">
              {filtered.map((group) => (
                <section key={group._id} className="space-y-2">
                  <h2 className="text-sm font-semibold text-neutral-700">
                    {group.name}
                  </h2>
                  <ul className="divide-y rounded-lg border">
                    {group.policies.map((policy) => (
                      <li
                        key={policy._id}
                        className="flex flex-wrap items-start justify-between gap-3 p-4"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="font-medium">{policy.title}</span>
                            {policy.badge === "new" ? <Badge>New</Badge> : null}
                            {policy.badge === "updated" ? (
                              <Badge variant="secondary">Updated</Badge>
                            ) : null}
                          </div>
                          {policy.summary ? (
                            <p className="text-sm text-muted-foreground">
                              {policy.summary}
                            </p>
                          ) : null}
                          {policy.badge === "updated" && policy.changeNote ? (
                            <p className="text-sm">
                              <span className="font-medium">What changed: </span>
                              {policy.changeNote}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            Version {policy.versionNumber}
                            {policy.effectiveDate
                              ? ` · in force from ${formatDate(policy.effectiveDate)}`
                              : ` · published ${formatDate(policy.publishedAt)}`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openSignedFile(() => openMyPolicy(policy._id))}
                        >
                          <ExternalLink className="mr-1.5 size-3.5" />
                          Open
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
