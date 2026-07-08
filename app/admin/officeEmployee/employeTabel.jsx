"use client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import {
  Edit,
  Eye,
  Trash2,
  Mail,
  MailCheck,
  KeyRound,
  Lock,
  ShieldAlert,
} from "lucide-react";
import React from "react";
import { useSession } from "next-auth/react";
import { useCommonContext } from "@/context/commonContext";
import { TableStatus } from "@/components/tableStatus/status";
import { Badge } from "@/components/ui/badge";
import EmployeeSheet from "./employeeSheet";
import Link from "next/link";
import { encrypt } from "@/lib/algo";
import {
  daysUntil,
  getMilestone,
  milestoneLabel,
  formatVisaRemaining,
  getVisaUrgencyLevel,
  VISA_URGENCY_TEXT,
} from "@/lib/visaMilestones";

const EmployeTabel = () => {
  const {
    officeEmployeeData: data,
    handleEdit,
    handleAlert,
    onSendVisaReminder,
    isSendingReminder,
    onResetPassword,
    onLockdown,
  } = useCommonContext();

  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "superAdmin";
  const currentUserId = session?.user?._id;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "name",
              "email",
              "contactNo",
              "status",
              "timesheet",
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
            const visaIso = item?.visaEndDate
              ? new Date(item.visaEndDate).toISOString()
              : null;
            const milestone =
              item?.immigrationType !== "British" && item?.visaEndDate
                ? getMilestone(daysUntil(item?.visaEndDate))
                : null;
            const visaUrgency =
              item?.immigrationType !== "British"
                ? getVisaUrgencyLevel(item?.visaEndDate)
                : null;
            const visaText = visaUrgency
              ? VISA_URGENCY_TEXT[visaUrgency]
              : "text-neutral-700";
            const visaRemaining =
              item?.immigrationType !== "British"
                ? formatVisaRemaining(item?.visaEndDate)
                : null;
            const sentMilestones = (item?.visaReminders || [])
              .filter((r) => r.visaEndDate === visaIso)
              .map((r) => r.milestone);
            const alreadySent =
              milestone && sentMilestones.includes(milestone);
            return (
            <TableRow key={index}>
              <TableCell className="cursor-pointer">
                <EmployeeSheet item={item} />
              </TableCell>
              <TableCell>{item?.email}</TableCell>
              <TableCell>{item?.phoneNumber}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {!item?.isSuperAdmin ||
                  (isSuperAdmin &&
                    String(item?._id) !== String(currentUserId)) ? (
                    <div
                      onClick={() =>
                        handleAlert(
                          item?._id,
                          "Update",
                          item?.isActive,
                          "isActive",
                        )
                      }
                    >
                      <TableStatus isActive={item?.isActive} />
                    </div>
                  ) : (
                    <TableStatus isActive={item?.isActive} />
                  )}
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
                <div
                  onClick={() =>
                    handleAlert(
                      item?._id,
                      "Update",
                      item?.isShowenInWeeklyTimesheet,
                      "isShowenInWeeklyTimesheet",
                    )
                  }
                >
                  <TableStatus isActive={item?.isShowenInWeeklyTimesheet} />
                </div>
              </TableCell>
              <TableCell>
                {item?.joinDate && format(new Date(item?.joinDate), "PPP")}
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
              <TableCell className={visaText}>
                {item?.immigrationType === "British"
                  ? "-"
                  : item?.visaEndDate &&
                    format(new Date(item.visaEndDate), "PPP")}
              </TableCell>
              <TableCell className={visaText}>
                {item?.immigrationType === "British" || !visaRemaining
                  ? "-"
                  : visaRemaining === "Expired"
                    ? "Visa expired"
                    : visaRemaining}
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
                  <Button
                    size={"icon"}
                    variant={"outline"}
                    asChild
                    className={"text-blue-600"}
                  >
                    <Link
                      href={`/admin/officeEmployee/${encrypt(
                        item?._id,
                      )}/overview`}
                    >
                      <Eye />
                    </Link>
                  </Button>
                  <Button
                    onClick={() => handleEdit(item)}
                    variant="outline"
                    size="icon"
                  >
                    <Edit className="text-indigo-600" />
                  </Button>
                  {isSuperAdmin && !item?.isSuperAdmin && (
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
                  {isSuperAdmin &&
                    String(item?._id) !== String(currentUserId) &&
                    item?.isActive && (
                      <Button
                        onClick={() => onLockdown?.(item)}
                        variant="outline"
                        size="icon"
                        title="Emergency lockdown (deactivate & end sessions)"
                        className="border-rose-300"
                      >
                        <ShieldAlert className="text-rose-600" />
                      </Button>
                    )}
                  {!item?.isSuperAdmin && (
                    <Button
                      onClick={() =>
                        handleAlert(item?._id, "Delete", item?.isActive)
                      }
                      variant="outline"
                      size="icon"
                    >
                      <Trash2 className="text-rose-600" />
                    </Button>
                  )}
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
