import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * A server action answered `{ success: false }`.
 *
 * Distinguished from a network or runtime failure because it will not come good
 * on a retry — see `retryPolicy` below.
 */
export class ActionError extends Error {
  constructor(message) {
    super(message || "Request failed");
    this.name = "ActionError";
    this.isActionError = true;
  }
}

/**
 * Turn an action's result into query data, or throw something legible.
 *
 * This *used* to be a bare `JSON.parse(response?.data)`. Every action in this
 * codebase returns `{ success: false, message }` with no `data` when it refuses,
 * so that line was parsing the string "undefined" and throwing a SyntaxError —
 * which React Query dutifully retried three times before leaving `data`
 * undefined and the page rendering as if the answer were "nothing here".
 *
 * The control flow is unchanged: a refusal threw before and throws now. What
 * changes is that the error carries the server's own message instead of
 * "undefined is not valid JSON", so callers can show the user why.
 *
 * Note twelve or so actions report an *empty* result as `success: false` with
 * "No Data Found". Those now surface as an ActionError rather than a parse
 * error — same outcome for the caller, minus the three pointless retries.
 */
function unwrap(response) {
  if (response?.success === false) {
    throw new ActionError(response?.message);
  }
  return response?.data ? JSON.parse(response.data) : null;
}

/** Business refusals are final; only genuine failures are worth retrying. */
const retryPolicy = (failureCount, error) =>
  !error?.isActionError && failureCount < 3;

export const useFetchQuery = ({
  params,
  fetchFn,
  queryKey,
  enabled = true,
}) => {
  if (!queryKey) {
    throw new Error("queryKey is required");
  }
  return useQuery({
    queryKey: queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetchFn(params);
      return {
        newData: unwrap(response) || [],
        totalCount: response?.totalCount || 0,
      };
    },
    enabled,
    keepPreviousData: true,
    staleTime: 1000 * 60 * 10, // 10 minutes
    cacheTime: 10 * 60 * 30, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: retryPolicy,
    retryDelay: 2000,
    onError: (error) => {
      console.log("React Query Error", error);
    },
    onSettled: (data, error) => {
      if (!data) {
        console.log("No data returned from API");
      }
    },
  });
};

export const useFetchSelectQuery = ({ queryKey, fetchFn }) => {
  return useQuery({
    queryKey: queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetchFn(signal);
      return unwrap(response) || [];
    },
    keepPreviousData: true,
    staleTime: 1000 * 60 * 10, // 10 minutes
    cacheTime: 10 * 60 * 30, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: retryPolicy,
    retryDelay: 2000,
    onError: (error) => {
      console.log("React Query Error", error);
    },
    onSettled: (data, error) => {
      if (!data) {
        console.log("No data returned from API");
      }
    },
  });
};

export const usePreFetchQuery = ({ params, queryKey, fetchFn }) => {
  const queryClient = useQueryClient();
  const usePreFetchQuery = queryClient.fetchQuery();
  return usePreFetchQuery({
    queryKey: queryKey,
    queryFn: async () => {
      const response = await fetchFn(params);
      const parsedData = JSON.parse(response?.data);
      return {
        newData: parsedData || [],
        totalCount: response?.totalCount || 0,
      };
    },
    keepPreviousData: true,
    staleTime: 1000 * 60 * 10, // 10 minutes
    cacheTime: 10 * 60 * 30, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: 2000,
    onError: (error) => {
      console.log("React Query Error", error);
    },
    onSettled: (data, error) => {
      if (!data) {
        console.log("No data returned from API");
      }
    },
  });
};

export const useInvalidateQuery = (queryKey) => {
  const queryClient = useQueryClient();
  return queryClient.invalidateQueries({ queryKey });
};
