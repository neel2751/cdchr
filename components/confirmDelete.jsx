"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * A confirmation step in front of a destructive action.
 *
 * Deliberately controlled rather than trigger-based: these sit inside table
 * rows, where one dialog driven by "which row is pending" is simpler than one
 * mounted per row.
 *
 * @param {Object|null} target the row awaiting confirmation; null closes it
 * @param {Function} onCancel
 * @param {Function} onConfirm
 * @param {string} title
 * @param {React.ReactNode} description what will actually happen, in plain
 *   words — the point of the pause is that the reader learns something
 * @param {string} [confirmLabel]
 * @param {boolean} [isPending]
 */
export default function ConfirmDelete({
  target,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  isPending = false,
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(event) => {
              // The dialog closes itself on action; the caller decides when the
              // row actually goes, so the close is left to onConfirm.
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
