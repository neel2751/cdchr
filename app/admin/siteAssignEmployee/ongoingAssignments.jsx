import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarRange, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useTerms } from "@/app/admin/providers";
import {
  endOngoing,
  getOngoingAssignments,
} from "@/server/siteAssignmentServer/standingAssignmentServer";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Who is on a site by an ongoing assignment — enrolled from a date, until a
 * date or until further notice — and the way to end one. See
 * models/standingAssignmentModel.js.
 *
 * Ending sets today as their last day, so they are on the board today and not
 * tomorrow; one that has not started yet is cancelled outright.
 */
export default function OngoingAssignments({ queryKey }) {
  const { fill } = useTerms();
  const [open, setOpen] = useState(false);

  const { data, isLoading, refetch } = useFetchQuery({
    fetchFn: getOngoingAssignments,
    params: { siteId: "All" },
    queryKey: ["ongoingAssignments"],
    enabled: open,
  });
  const rows = data?.newData || [];

  // A dialog that was just used to assign somebody must show them.
  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const { mutate: end, isPending, variables } = useSubmitMutation({
    mutationFn: async (id) => await endOngoing({ id }),
    invalidateKey: queryKey || ["siteClock"],
    onSuccessMessage: (message) => message || "Ended",
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarRange />
        Ongoing
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fill("Ongoing {siteAssignments}")}</DialogTitle>
            <DialogDescription>
              {fill(
                "People on a {site} from a date onwards. They appear on the board every day it covers, without being assigned again.",
              )}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {fill(
                "Nobody is on a {site} by an ongoing assignment. Use Assign and choose “From a date, ongoing”.",
              )}
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>{fill("{Site}")}</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Until</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.siteName}</TableCell>
                      <TableCell>{format(new Date(row.startDate), "PP")}</TableCell>
                      <TableCell>
                        {row.endDate
                          ? format(new Date(row.endDate), "PP")
                          : "Until further notice"}
                      </TableCell>
                      <TableCell>
                        {row.days?.length
                          ? row.days.map((d) => DAY_NAMES[d]).join(", ")
                          : "Every day"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `End ${row.name} on ${row.siteName}? Today is their last day.`,
                              )
                            ) {
                              end(row._id, { onSuccess: () => refetch() });
                            }
                          }}
                        >
                          {isPending && variables === row._id && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          End
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
