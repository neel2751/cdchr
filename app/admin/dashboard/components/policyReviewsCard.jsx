"use client";

import Link from "next/link";
import { BookCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { describeReviewDue } from "@/lib/policies";
import { getPolicyReviewsDue } from "@/server/policyServer/policyServer";

/**
 * Policies coming up for review, or overdue.
 *
 * Renders nothing when there are none, and for anyone who does not manage
 * policies — the server answers both with an empty list. A card that always
 * reads "nothing due" trains people to stop looking at it.
 */
export default function PolicyReviewsCard() {
  const { data } = useFetchQuery({
    queryKey: ["policyReviewsDue"],
    fetchFn: getPolicyReviewsDue,
  });

  const { total = 0, policies = [] } = data?.newData || {};
  if (!total) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookCheck className="size-4" />
          {total === 1 ? "1 policy needs review" : `${total} policies need review`}
        </CardTitle>
        <Link
          href="/admin/policies?review=due"
          className="text-xs text-neutral-500 hover:underline"
        >
          See all
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {policies.map((policy) => (
            <li key={policy._id}>
              <Link
                href={`/admin/policies/${policy._id}`}
                className="flex items-center gap-2 px-6 py-3 transition-colors hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{policy.title}</span>
                <span
                  className={`shrink-0 text-xs ${
                    policy.daysUntilReview < 0
                      ? "font-medium text-red-700"
                      : "text-amber-700"
                  }`}
                >
                  {describeReviewDue(policy.daysUntilReview)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
