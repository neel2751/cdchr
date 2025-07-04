import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { handleAttendanceCategory } from "@/server/category/category";
import React from "react";

const AddCategory = () => {
  const [open, setOpen] = React.useState(false);

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) => handleAttendanceCategory(data),
    invalidateKey: ["selectAttendanceCategories"],
    onSuccessMessage: (response) => ` Category created successfully`,
    onClose: () => setOpen(false),
  });

  const field = [
    {
      name: "attendanceCategoryName",
      labelText: "Category Name",
      type: "text",
      placeholder: "W.H",
      validationOptions: {
        required: "Category name is required",
      },
    },
    {
      name: "attendanceCategoryValue",
      labelText: "Category Value",
      type: "text",
      placeholder: "Work from home",
      validationOptions: {
        required: "Category value is required",
      },
    },
    {
      name: "attendanceCategoryDescription",
      labelText: "Category Description",
      type: "textarea",
      size: true,
      placeholder: "Enter attendance category description",
    },
  ];

  return (
    <>
      <Button
        variant="outline"
        className="border-neutral-300"
        onClick={() => setOpen(true)}
      >
        Add Category
      </Button>
      <Dialog open={open} onOpenChange={() => setOpen(!open)}>
        <DialogContent>
          <div className="flex flex-col gap-1">
            <DialogTitle>Add Category</DialogTitle>
            <DialogDescription> Enter category details</DialogDescription>
          </div>
          <GlobalForm
            fields={field}
            onSubmit={handleSubmit}
            btnName={"Add Category"}
            isLoading={isPending}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AddCategory;
