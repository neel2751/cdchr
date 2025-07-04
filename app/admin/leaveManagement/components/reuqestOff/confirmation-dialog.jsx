"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Clock } from "lucide-react";

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  selectedStartDate,
  selectedEndDate,
  selectedRange,
  totalHours,
}) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    notes: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(formData);
    setFormData({ name: "", email: "", notes: "" });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm your details</DialogTitle>
          <DialogDescription>
            Please confirm your details before proceeding.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-3 py-4">
            <div className="flex gap-4 items-center text-neutral-500">
              <Calendar className="h-5 w-5 " />
              <span className="flex-1 whitespace-nowrap text-neutral-800 px-3 py-1.5 font-medium text-sm">
                {selectedStartDate
                  ? format(selectedStartDate, "EEEE, MMMM d, yyyy")
                  : ""}
              </span>
            </div>
            <div className="flex gap-4 items-center text-neutral-500">
              <Clock className="h-5 w-5" />
              <span className="px-3 py-1.5 rounded-md flex-1 text-neutral-800 font-medium text-sm">
                {selectedRange
                  ? `${selectedRange.start} - ${selectedRange.end}`
                  : ""}
              </span>
              <div className="px-3 py-1.5 rounded-md flex items-center gap-2 bg-indigo-100 text-indigo-600 font-semibold text-sm">
                <span>{totalHours.toFixed(1)}h</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-gray-500">Additional notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Please share anything that will help prepare for your time off."
                  className="bg-transparent border-neutral-500 mt-2 h-24"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button
                type="button"
                className="bg-white text-black hover:bg-gray-100"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              className="text-white hover:bg-indigo-700 bg-indigo-600"
            >
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
