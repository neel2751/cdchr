import { GlobalForm } from "@/components/form/form";
import { Status } from "@/components/tableStatus/status";
import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  deleteVisitorPurpose,
  updateVisitorPurpose,
} from "@/server/visitorServer";
import { ClockArrowUp, EditIcon, Notebook, Trash2 } from "lucide-react";
import React from "react";

export default function ViewVisitorHistory({ visitor, handleEdit }) {
  const data = visitor.visitorPurpose.map((purpose) => ({
    id: purpose._id,
    visitorPurpose: purpose.visitorPurpose,
    visitorType: purpose.visitorType,
    visitorStatus: purpose.visitorStatus,
    otherPurpose: purpose.otherPurpose,
    visitorCheckInTime: purpose.visitorCheckInTime,
    visitorCheckOutTime: purpose.visitorCheckOutTime,
    visitorNotes: purpose.visitorNotes,
  }));

  const { mutate: handleClockOut } = useSubmitMutation({
    mutationFn: async (data) =>
      await updateVisitorPurpose(data.purposeId, data),
    onSuccessMessage: (message) =>
      message || "Visitor clocked out successfully",
    invalidateKey: ["visitorList"],
    onClose: () => {
      // Handle any additional actions after clocking out
      console.log("Visitor clocked out");
    },
  });

  const { mutate: handleDelete } = useSubmitMutation({
    mutationFn: async (data) => await deleteVisitorPurpose(data),
    onSuccessMessage: (message) =>
      message || "Visitor purpose deleted successfully",
    invalidateKey: ["visitorList"],
    onClose: () => {
      // Handle any additional actions after clocking out
      console.log("Visitor clocked out");
    },
  });

  const { mutate: handleAddNote } = useSubmitMutation({
    mutationFn: async (data) =>
      await updateVisitorPurpose(data.purposeId, {
        visitorNotes: data.visitorNotes,
      }),
    onSuccessMessage: (message) => message || "Note added successfully",
    invalidateKey: ["visitorList"],
    onClose: () => {
      // Handle any additional actions after adding a note
      console.log("Note added");
    },
  });

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size={"sm"} variant="outline">
          View
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className={"p-4 max-w-6xl mx-auto rounded-xl"}
      >
        <SheetHeader>
          <SheetTitle>
            Visitor History of{" "}
            <span className="font-semibold text-indigo-600">
              {visitor.visitorName}
            </span>
          </SheetTitle>
          <SheetDescription>
            View the history of the visitor's activities. Total Visits:{" "}
            <span className="font-semibold text-indigo-600">
              {visitor.visitorPurpose.length}{" "}
            </span>
            Current Visit:{" "}
            <span className="font-semibold text-indigo-600">
              {visitor.visitorPurpose.some((p) => p.visitorCheckInTime)
                ? visitor.visitorPurpose.some((p) => !p.visitorCheckOutTime)
                  ? "Checked In"
                  : "Checked Out"
                : "Not Checked In"}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeaderCom
              tableHead={[
                "Type",
                "Purpose",
                "Status",
                "Other Purpose",
                "Check-In Time",
                "Check-Out Time",
                "Notes",
              ]}
            />
            <TableBody>
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className={"capitalize"}>
                    {item.visitorType}
                  </TableCell>
                  <TableCell className={"capitalize"}>
                    {item.visitorPurpose}
                  </TableCell>
                  <TableCell>
                    {item.visitorCheckOutTime ? (
                      <Status title={"Checked Out"} />
                    ) : (
                      <Status title={item.visitorStatus} />
                    )}
                  </TableCell>
                  <TableCell>{item.otherPurpose || "N/A"}</TableCell>
                  <TableCell>
                    {item.visitorCheckInTime
                      ? new Date(item.visitorCheckInTime).toLocaleString()
                      : "Not Checked In"}
                  </TableCell>
                  <TableCell>
                    {item.visitorCheckOutTime
                      ? new Date(item.visitorCheckOutTime).toLocaleString()
                      : "Not Checked Out"}
                  </TableCell>
                  <TableCell>
                    {item.visitorNotes ? (
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <span>
                            {item.visitorNotes.length > 20
                              ? `${item.visitorNotes.slice(0, 20)}...`
                              : item.visitorNotes}
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent>
                          <div className="text-sm text-gray-700">
                            {item.visitorNotes}
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    ) : (
                      <span className="text-sm text-gray-500">
                        No notes available
                      </span>
                    )}
                  </TableCell>
                  {/* You can add actions here if needed */}
                  <TableCell className="flex items-center gap-2">
                    {item.visitorCheckOutTime ? (
                      <></>
                    ) : (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          // Handle clock out action here
                          handleClockOut({
                            purposeId: item.id,
                            visitorCheckOutTime: new Date(),
                            visitorStatus: "checkedOut",
                          });
                        }}
                      >
                        <ClockArrowUp />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        handleEdit({
                          ...item,
                          purposeId: item.id,
                          visitorName: visitor.visitorName,
                          visitorEmail: visitor.visitorEmail,
                          visitorPhone: visitor.visitorPhone,
                        });
                      }}
                    >
                      <EditIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        handleDelete(item.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                    {/* Add Note  */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 p-0"
                        >
                          <Notebook />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72">
                        <GlobalForm
                          fields={[
                            {
                              name: "visitorNotes",
                              type: "textarea",
                              labelText: "Add Note",
                              placeholder: "Enter your note here...",
                              validationOptions: {
                                required: "Note is required",
                              },
                            },
                          ]}
                          onSubmit={(data) => {
                            handleAddNote({
                              purposeId: item.id,
                              visitorNotes: data.visitorNotes,
                            });
                          }}
                          initialValues={{
                            visitorNotes: item.visitorNotes || "",
                          }}
                          btnName={"Save Note"}
                        />
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
