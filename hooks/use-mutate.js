import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Warn when an invalidation names a key nothing is actually caching.
 *
 * Development only. Under the old call this could not be noticed: the arguments
 * were the v4 shape, so v5 saw no `queryKey`, matched *every* query and
 * refetched the whole cache — which meant a wrong key still appeared to work.
 * With the call corrected, a wrong key silently refreshes nothing, so it needs
 * to say so.
 */
function warnIfNothingMatches(queryClient, queryKey) {
  if (process.env.NODE_ENV === "production") return;
  const matches = queryClient.getQueryCache().findAll({ queryKey });
  if (matches.length === 0) {
    console.warn(
      `[use-mutate] invalidateKey ${JSON.stringify(queryKey)} matched no ` +
        `query. Nothing will refresh — check it against the queryKey the list ` +
        `on this screen actually uses.`
    );
  }
}

export const useSubmitMutation = ({
  mutationFn,
  invalidateKey,
  onSuccessMessage,
  onClose,
}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      if (response?.success) {
        if (invalidateKey) {
          const queryKey = Array.isArray(invalidateKey)
            ? invalidateKey
            : [invalidateKey];

          warnIfNothingMatches(queryClient, queryKey);

          // v5 takes a single filters object. This was
          // `invalidateQueries(invalidateKey, { exact: true })` — the v4
          // signature — under which v5 read no `queryKey` at all and therefore
          // matched everything, refetching the entire cache after every
          // mutation in the app.
          //
          // Deliberately not `exact`. Call sites pass the *root* of a key while
          // the query that owns the list adds its own filters and page number
          // (["expenses"] against ["expenses", {…}]), so exact matching would
          // have turned the over-invalidation into no invalidation.
          queryClient.invalidateQueries({ queryKey });
        }
        if (onSuccessMessage) {
          toast.success(onSuccessMessage(response?.message));
        }
        onClose();
      } else {
        console.log(`Under this function is ${mutationFn}`, response);
        throw new Error(response?.message);
      }
    },
    onError: (error) => {
      console.log(`Under this function is ${mutationFn}`, error);
      toast.error(`Error:  ${error.message || error}`);
    },
  });
};
