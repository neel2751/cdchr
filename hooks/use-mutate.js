import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
          queryClient.invalidateQueries(invalidateKey, { exact: true });
        }
        if (onSuccessMessage) {
          toast.success(onSuccessMessage(response?.message));
        }
        onClose();
      } else {
        throw new Error(response?.message);
      }
    },
    onError: (error) => {
      console.log(`Under this function is ${mutationFn}`, error);
      toast.error(`Error:  ${error.message || error}`);
    },
  });
};
