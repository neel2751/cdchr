import { useQuery, useQueryClient } from "@tanstack/react-query";

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
      const parsedData = JSON.parse(response?.data);
      return {
        newData: parsedData || [],
        totalCount: response?.totalCount || 0,
      };
    },
    enabled,
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

export const useFetchSelectQuery = ({ queryKey, fetchFn }) => {
  return useQuery({
    queryKey: queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetchFn(signal);
      const parsedData = JSON.parse(response?.data);
      return parsedData || [];
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
