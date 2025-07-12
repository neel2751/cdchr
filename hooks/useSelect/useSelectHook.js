import { useFetchSelectQuery } from "../use-query";
export function createSelectHook(fetchFn, queryKey) {
  return function useSelect() {
    const { data } = useFetchSelectQuery({ fetchFn, queryKey });
    return data;
  };
}
