"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createPolicy } from "@/server/policyServer/policyServer";
import PolicyDetailsForm from "./policyDetailsForm";

/**
 * Start a policy. The file comes next, on the policy's own page — a policy
 * is created first so the upload has somewhere to belong.
 *
 * @param {{open: boolean, onOpenChange: Function, categories: Array, defaultCategoryId?: string}} props
 */
export default function NewPolicyDialog({
  open,
  onOpenChange,
  categories,
  defaultCategoryId,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New policy</DialogTitle>
          <DialogDescription>
            Describe it here, then upload the document on the next screen. It
            stays hidden from staff until you choose who can see it.
          </DialogDescription>
        </DialogHeader>
        {/* Inside DialogContent, so it unmounts on close and every open
            starts empty, filed under the category being looked at. */}
        <NewPolicyForm
          categories={categories}
          defaultCategoryId={defaultCategoryId}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewPolicyForm({ categories, defaultCategoryId, onDone }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [details, setDetails] = useState({
    categoryId: defaultCategoryId || null,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: () => createPolicy(details),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not create the policy");
        return;
      }
      toast.success(res.message || "Policy created");
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["policyCategories"] });
      onDone();
      const { _id } = JSON.parse(res.data);
      router.push(`/admin/policies/${_id}`);
    },
    onError: (err) => toast.error(err?.message || "Could not create the policy"),
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <PolicyDetailsForm
        value={details}
        onChange={setDetails}
        categories={categories}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending || !details.title?.trim() || !details.categoryId}
        >
          Create and add the file
        </Button>
      </DialogFooter>
    </form>
  );
}
