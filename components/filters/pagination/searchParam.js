import {
  createSearchParamsCache,
  createSerializer,
  parseAsInteger,
} from "nuqs/server";
export const searchParams = {
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(10),
};
export const searchParamsCache = createSearchParamsCache(searchParams);
export const serialize = createSerializer(searchParams);
