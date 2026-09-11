"use client";

import { useCallback, useMemo } from "react";

import { useFetchSelectQuery } from "@/hooks/use-query";
import { isFeatureEnabled } from "@/lib/tenantPlan";
import { getPlanFeatures } from "@/server/tenantServer/featureServer";

/**
 * The signed-in company's module flags, for client components.
 *
 * Returns a `has(key)` predicate rather than the raw object so callers cannot
 * accidentally write `features.expenses` and get `undefined` — which is falsy,
 * and would hide a module from every company that has never had the flag
 * written. Absent means enabled everywhere else in the plan code
 * (isFeatureEnabled), and it has to mean the same here.
 *
 * While the query is in flight `has()` answers true. Showing a card for a
 * moment and then removing it is the lesser error: the opposite makes every
 * gated surface flicker out of existence on each load for the companies that
 * legitimately have it.
 *
 * Cached under one key for the whole app, so several gated surfaces on a page
 * cost one request.
 */
export function useTenantFeatures() {
  const { data, isLoading } = useFetchSelectQuery({
    queryKey: ["planFeatures"],
    fetchFn: getPlanFeatures,
  });

  // useFetchSelectQuery falls back to [] when there is no data; an array has no
  // feature keys, so isFeatureEnabled reads every flag as absent — enabled.
  const features = useMemo(
    () => (Array.isArray(data) ? {} : data || {}),
    [data]
  );

  // Stable across renders, so a caller can put `has` in a useMemo dependency
  // list without recomputing on every render.
  const has = useCallback((key) => isFeatureEnabled(features, key), [features]);

  return { features, isLoading, has };
}
