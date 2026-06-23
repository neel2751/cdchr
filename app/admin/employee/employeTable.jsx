import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, formatDistanceStrict, isPast } from "date-fns";
import {
  Edit,
  Eye,
  Trash2,
  Mail,
  MailCheck,
  KeyRound,
  Lock,
} from "lucide-react";
import React from "react";
import { useSession } from "next-auth/react";
import EmployeeForm from "../officeEmployee/employeeForm";
import { CheckBoxNormal } from "@/components/form/formFields";
import { useCommonContext } from "@/context/commonContext";
import { TableStatus } from "@/components/tableStatus/status";
import { Badge } from "@/components/ui/badge";
import EmployeeSheet from "./employeeSheet";
import Link from "next/link";
import { encrypt } from "@/lib/algo";
import { daysUntil, getMilestone, milestoneLabel } from "@/lib/visaMilestones";

const EmployeTabel = () => {
  const {
    officeEmployeeData: data,
    handleEdit,
    isEdit,
    setIsEdit,
    isChecked,
    setIsChecked,
    handleAlert,
    onSendVisaReminder,
    isSendingReminder,
    onResetPassword,
  } = useCommonContext();

  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "superAdmin";

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "id",
              "name",
              "contact",
              // "country",
              "Payrate",
              "E.type",
              "P.type",
              "status",
              "joindate",
              "Enddate",
              "VisaStart",
              "VisaEnd",
              "visa",
              "Actions",
            ].map((item, index) => (
              <TableHead className="uppercase text-xs" key={index}>
                {item}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((item, index) => {
            const visaIso = item?.eVisaExp
              ? new Date(item.eVisaExp).toISOString()
              : null;
            const milestone =
              item?.immigrationType !== "British" && item?.eVisaExp
                ? getMilestone(daysUntil(item?.eVisaExp))
                : null;
            const sentMilestones = (item?.visaReminders || [])
              .filter((r) => r.visaEndDate === visaIso)
              .map((r) => r.milestone);
            const alreadySent =
              milestone && sentMilestones.includes(milestone);
            return (
            <TableRow key={index}>
              <TableCell>{index + 1}</TableCell>
              <TableCell>
                <EmployeeSheet item={item} />
              </TableCell>
              <TableCell>{item?.phone}</TableCell>
              <TableCell>£{item?.payRate.toFixed(2)}</TableCell>
              <TableCell>{item?.employeType}</TableCell>
              <TableCell>{item?.paymentType}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div
                    onClick={() =>
                      handleAlert(item?._id, "Update", item?.isActive)
                    }
                  >
                    <TableStatus isActive={item?.isActive} />
                  </div>
                  {item?.isLocked && (
                    <Badge
                      variant="destructive"
                      className="gap-1"
                      title={
                        item?.lockedUntil
                          ? `Locked until ${format(
                              new Date(item.lockedUntil),
                              "PPp",
                            )}`
                          : "Account locked by failed logins"
                      }
                    >
                      <Lock className="h-3 w-3" /> Locked
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {item?.startDate && format(new Date(item?.startDate), "PPP")}
              </TableCell>
              <TableCell>
                {(item?.endDate && format(new Date(item?.endDate), "PPP")) ||
                  "-"}
              </TableCell>
              <TableCell>
                {item?.immigrationType === "British"
                  ? "-"
                  : item?.visaStartDate &&
                    format(new Date(item?.visaStartDate), "PPP")}
              </TableCell>

              <TableCell
                className={`${
                  isPast(new Date(item?.eVisaExp), new Date())
                    ? "text-rose-600"
                    : "text-neutral-600"
                }`}
              >
                {item?.immigrationType === "British"
                  ? "-"
                  : item?.eVisaExp && format(new Date(item?.eVisaExp), "PPP")}
              </TableCell>
              <TableCell>
                {item?.immigrationType === "British"
                  ? "-"
                  : item.eVisaExp && item?.eVisaExp
                  ? isPast(new Date(item?.eVisaExp))
                    ? "Visa expired"
                    : `${formatDistanceStrict(
                        new Date(),
                        new Date(item?.eVisaExp)
                      )}`
                  : "-"}
              </TableCell>

              <TableCell>
                <div className="flex gap-2">
                  {milestone && (
                    <Button
                      onClick={() => onSendVisaReminder?.(item)}
                      disabled={isSendingReminder}
                      variant="outline"
                      size="icon"
                      title={
                        alreadySent
                          ? `Reminder already sent (${milestoneLabel(
                              milestone,
                            )}) — click to resend`
                          : `Send visa reminder (${milestoneLabel(milestone)})`
                      }
                    >
                      {alreadySent ? (
                        <MailCheck className="text-green-600" />
                      ) : (
                        <Mail className="text-amber-600" />
                      )}
                    </Button>
                  )}
                  <Button variant="outline" size="icon" asChild>
                    <Link
                      href={`/admin/employee/${encrypt(item?._id)}/overview`}
                    >
                      <Eye className="text-blue-600" />
                    </Link>
                  </Button>

                  <Dialog open={isEdit} onOpenChange={setIsEdit}>
                    <DialogTrigger asChild>
                      <Button
                        onClick={() => handleEdit(item)}
                        variant="outline"
                        size="icon"
                      >
                        <Edit className="text-indigo-600" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-md md:max-w-lg lg:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Edit Employee Details</DialogTitle>
                        <DialogDescription>
                          Make changes to here. Click update when you're done.
                        </DialogDescription>
                      </DialogHeader>
                      <EmployeeForm />
                      <CheckBoxNormal
                        isChecked={isChecked}
                        setIsChecked={setIsChecked}
                      />
                    </DialogContent>
                  </Dialog>
                  {isSuperAdmin && (
                    <Button
                      onClick={() => onResetPassword?.(item)}
                      variant="outline"
                      size="icon"
                      title="Reset password"
                      className={item?.isLocked ? "border-rose-300" : ""}
                    >
                      <KeyRound className="text-amber-600" />
                    </Button>
                  )}
                  <Button
                    onClick={() =>
                      handleAlert(item?._id, "Delete", item?.isActive)
                    }
                    variant="outline"
                    size="icon"
                  >
                    <Trash2 className="text-rose-600" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
};

export default EmployeTabel;
