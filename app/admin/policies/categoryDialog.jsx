"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePolicyCategory } from "@/server/policyServer/policyServer";

/**
 * Add a category, or rename one when `category` is given.
 *
 * The form lives inside DialogContent, which unmounts on close, so every
 * open starts from the category it was opened for.
 *
 * @param {{open: boolean, onOpenChange: Function, category?: object}} props
 */
export default function CategoryDialog({ open, onOpenChange, category }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "Add a category"}</DialogTitle>
          <DialogDescription>
            Categories are how staff find a policy, so name them the way
            people would look for them.
          </DialogDescription>
        </DialogHeader>
        <CategoryForm category={category} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({ category, onDone }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name || "");
  const [description, setDescription] = useState(category?.description || "");

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      savePolicyCategory({ id: category?._id, name, description }),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not save the category");
        return;
      }
      toast.success(res.message || "Saved");
      queryClient.invalidateQueries({ queryKey: ["policyCategories"] });
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      onDone();
    },
    onError: (err) => toast.error(err?.message || "Could not save the category"),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Environmental"
          maxLength={80}
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="category-description">Description</Label>
        <Textarea
          id="category-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What kind of policies go here"
          rows={2}
          maxLength={300}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || !name.trim()}>
          {category ? "Save" : "Add category"}
        </Button>
      </DialogFooter>
    </form>
  );
}
