import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EyeIcon, HistoryIcon } from "lucide-react";
import { useState } from "react";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { handleCommonLeaveStatus } from "@/server/leaveServer/getLeaveServer";
import Leavehistory from "./leave-history";
import { Switch } from "@/components/ui/switch";
import AddLeaveForEmployee from "./leave-add";
import LeaveEdit from "./leave-edit";
import LeaveDelete from "./leave-delete";
import LeaveRestore from "./leave-restore";
import LeaveTotalInput from "./leave-total-input";
import LeaveRecomputeCarry from "./leave-recompute-carry";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { carriedState, overrideFor } from "@/lib/carryForward";

/**
 * Leave types nobody may remove from an employee.
 *
 * Annual, sick, maternity and paternity are either statutory rights or something
 * the rest of the leave module assumes exists — the booking path falls back to
 * Unpaid Leave by name, and the entitlement generator re-creates all four. Taking
 * one away would be undone by the next sync anyway.
 */
const LOCKED_LEAVE_TYPES = [
  "Annual Leave",
  "Sick Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Unpaid Leave",
];

/**
 * The allowance, and where it came from.
 *
 * A total that includes carried-over days was indistinguishable from one that
 * did not: an employee on a six-day week who joined last June showed 44 days of
 * annual leave — 34 for the year plus 10 carried — with nothing on screen to say
 * so, and no way to work it out. The generator has always written
 * `carryForwarded` onto the row and nothing has ever read it.
 *
 * `baseTotal` and `carriedFrom` are only on rows written since that was fixed,
 * so both are derived when absent rather than left blank for existing records.
 */
/**
 * Whether this employee is an exception to the carry-forward rule for THIS
 * leave type.
 *
 * Read-only: exceptions are set in Leave → Settings, in one reviewable list.
 * Shown here because the entitlement sheet is one row per leave type, which is
 * exactly the grain an exception now has — so this is where somebody looking at
 * a surprising carried figure will be.
 */
function CarryForwardException({ entitlement, employee }) {
  const mode = overrideFor(employee, entitlement?.leaveType);
  if (mode === "default") return null;

  return (
    <span
      className="text-[11px] text-muted-foreground"
      title="Set under Leave → Settings → Individual exceptions"
    >
      {mode === "always"
        ? "always carries over"
        : "never carries over"}
    </span>
  );
}

function EntitlementTotal({ entitlement }) {
  const unit = entitlement?.type || "days";
  const carried = Number(entitlement?.carryForwarded) || 0;
  const lapsed = Number(entitlement?.carryForwardLapsed) || 0;
  const base =
    entitlement?.baseTotal ?? Number(entitlement?.total || 0) - carried;

  // Carried days are spent before the year's own, so how many are still live is
  // derivable — the same reading the booking path and the nightly job take.
  const state = carriedState(entitlement);

  return (
    <span className="flex flex-col leading-tight">
      <span className="flex items-center gap-1">
        {entitlement?.total}
        <span className="text-muted-foreground">{unit}</span>
      </span>

      {carried > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {base} + {carried} carried
          {entitlement?.carriedFrom ? ` from ${entitlement.carriedFrom}` : ""}
        </span>
      )}

      {/* The expiry, and what it means right now. A balance that is about to
          shrink is worth a warning before it does, not an explanation after. */}
      {state.carriedRemaining > 0 && state.expiresAt && (
        <span
          className={`text-[11px] ${
            state.hasExpired ? "text-destructive" : "text-amber-600"
          }`}
        >
          {state.hasExpired
            ? `${state.carriedRemaining} carried ${unit} expired ${format(
                state.expiresAt,
                "d MMM"
              )} — not bookable`
            : `${state.carriedRemaining} carried ${unit} expire ${format(
                state.expiresAt,
                "d MMM yyyy"
              )}`}
        </span>
      )}

      {lapsed > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {lapsed} carried {unit} expired unused
        </span>
      )}
    </span>
  );
}

export default function LeaveSheet({ item, queryKey }) {
  const [initialValues, setInitialValues] = useState(null);
  const [value, setValue] = useState(null);
  const { data } = useSession();
  const role = data?.user?.role;

  function onEdit(item, allData) {
    setInitialValues({
      ...item,
      employeeId: allData?._id,
      leaveYear: allData?.leaveYear,
    });
    setValue(item?.total);
  }

  const { mutate: handleSwitchChange, isPending } = useSubmitMutation({
    mutationFn: async (newValue) =>
      await handleCommonLeaveStatus({
        leaveType: newValue?.leaveType,
        isHide: newValue?.isHide,
        employeeId: item?._id,
        leaveYear: item?.leaveYear,
      }),
    invalidateKey: queryKey,
    onSuccessMessage: (message) => message,
    onClose: () => {
      setValue(null);
      setInitialValues(null); // reset state
    },
  });

  const adminHeader = ["Hide", "Action"];
  const isAdmin = ["superAdmin", "admin"].includes(role);

  const headers = [
    "Id",
    "Leave Type",
    "Total",
    "Used",
    "Remaining",
    "Usage",
    ...(isAdmin ? adminHeader : []),
  ];

  // In new We have to use nuqs for the open sheet

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="icon" variant="outline">
          <EyeIcon />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className={`
          ${
            isAdmin ? "max-w-7xl" : "max-w-3xl"
          } mx-auto rounded-md bottom-4 inset-x-4`}
      >
        <SheetHeader className="pb-4 ms-2">
          <div className="flex items-center justify-between mt-6">
            <div>
              <SheetTitle>Leave Details</SheetTitle>
              <SheetDescription>
                Leave details of{" "}
                <span className="font-semibold text-indigo-700">
                  {item?.name}
                </span>
              </SheetDescription>
            </div>
            <div className="space-x-2 flex items-center">
              <Button disabled size="sm" className="bg-indigo-700">
                Export
              </Button>
              {isAdmin && (
                <>
                  <AddLeaveForEmployee leaveData={item} queryKey={queryKey} />
                  {/* Only offered when there is carried-over leave to
                      recalculate — a button that can only ever answer "already
                      up to date" is noise. */}
                  {item?.leaveData?.some(
                    (row) => Number(row?.carryForwarded) > 0
                  ) && (
                    <LeaveRecomputeCarry item={item} queryKey={queryKey} />
                  )}
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button size="sm" variant="outline">
                        <HistoryIcon />
                        History
                      </Button>
                    </SheetTrigger>
                    <SheetContent className="max-w-7xl w-full rounded-md  top-2 right-4">
                      <SheetHeader className="pb-4 ms-2">
                        <SheetTitle>Leave History</SheetTitle>
                        <SheetDescription>
                          Leave history of{" "}
                          <span className="font-semibold text-indigo-700">
                            {item?.name}
                          </span>
                        </SheetDescription>
                      </SheetHeader>
                      <Leavehistory leaveHistory={item?.leaveHistory} />
                    </SheetContent>
                  </Sheet>
                </>
              )}
            </div>
          </div>
        </SheetHeader>
        <div className="px-4">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((th, index) => (
                  <TableHead key={index} className="uppercase text-xs">
                    {th}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            {item?.leaveData && (
              <TableBody>
                {item?.leaveData?.map((entitlement, index) => (
                  <TableRow key={index}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{entitlement?.leaveType}</TableCell>
                    <TableCell>
                        {initialValues?.leaveType === entitlement?.leaveType ? (
                          // Minus / number / plus, rather than a bare box. An
                          // allowance is nearly always nudged, and a stepper
                          // makes the typo the ceiling guards against much
                          // harder to make in the first place.
                          <LeaveTotalInput
                            entitlement={entitlement}
                            item={item}
                            value={value}
                            onChange={setValue}
                          />
                        ) : (
                          <span className="flex flex-col leading-tight">
                            <EntitlementTotal entitlement={entitlement} />
                            <CarryForwardException
                              entitlement={entitlement}
                              employee={item}
                            />
                          </span>
                        )}
                    </TableCell>
                    <TableCell>
                      {entitlement?.used || 0} {entitlement?.type || "days"}
                    </TableCell>
                    <TableCell>
                      {entitlement?.remaining || 0}{" "}
                      {entitlement?.type || "days"}
                    </TableCell>

                    <TableCell className="w-[200px] flex items-center gap-4">
                      <Progress
                        value={
                          entitlement?.total > 0
                            ? (entitlement.used / entitlement.total) * 100
                            : 0
                        }
                        className="w-40"
                      />
                      {entitlement?.total > 0
                        ? Math.floor(
                            (entitlement?.used / entitlement?.total) * 100
                          )
                        : 0}
                      %
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Switch
                          checked={entitlement.isHide}
                          onCheckedChange={() =>
                            handleSwitchChange(entitlement)
                          }
                          disabled={
                            isPending ||
                            entitlement?.isDelete ||
                            entitlement?.used > 0 ||
                            entitlement?.leaveType === "Maternity Leave" ||
                            entitlement?.leaveType === "Paternity Leave"
                          }
                        />
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="space-x-2">
                        {/* To be implemented */}
                        {entitlement?.isDelete ? (
                          <LeaveRestore
                            leaveType={entitlement?.leaveType}
                            leaveYear={item?.leaveYear}
                            employeeId={item?._id}
                            queryKey={queryKey}
                          />
                        ) : (
                          <>
                            <LeaveEdit
                              initialValues={initialValues}
                              onEdit={onEdit}
                              entitlement={entitlement}
                              item={item}
                              queryKey={queryKey}
                              setInitialValues={setInitialValues}
                              // `value` was missing here, which is why Save
                              // threw: the number being typed lives in this
                              // component's state and the child read a `value`
                              // that did not exist in its scope.
                              value={value}
                              setValue={setValue}
                            />
                            {/* Un-commented. The soft delete it calls is now
                                honoured by the booking dropdown and the booking
                                guard, and it refuses a type with days already
                                taken — so it is safe to offer. */}
                            {!LOCKED_LEAVE_TYPES.includes(
                              entitlement?.leaveType
                            ) && (
                              <LeaveDelete
                                leaveType={entitlement?.leaveType}
                                leaveYear={item?.leaveYear}
                                employeeId={item?._id}
                                employeeName={item?.name}
                                queryKey={queryKey}
                              />
                            )}
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
        <SheetFooter className="pt-4 border-t text-end">
          {/* Was "*This feature under development and may not be accurate." —
              which was fair while Save threw a ReferenceError on every click.
              It works now, so the note says what is actually worth knowing. */}
          <span className="text-xs text-muted-foreground">
            Changing a total recalculates what is left from what has been taken.
            Every change is recorded under History.
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
