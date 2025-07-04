"use client";
import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCommonContext } from "@/context/commonContext";
import { Plus } from "lucide-react";

export function LeaveCategoryForm() {
  const {
    field: fields,
    onSubmit,
    showDialog,
    setShowDialog,
  } = useCommonContext();

  return (
    <div>
      <Button onClick={() => setShowDialog(true)} variant="outline">
        <Plus />
        Add
      </Button>
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Leave Category</DialogTitle>
            <DialogDescription>
              Please fill in the details below to add a new leave category.
            </DialogDescription>
          </DialogHeader>
          <GlobalForm fields={fields} onSubmit={onSubmit} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
