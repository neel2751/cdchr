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
  ShieldCheck,
  ShieldOff,
  BadgeCheck,
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
import { getRightToWorkStatus, RTW_STATUS_TEXT } from "@/lib/rightToWork";

const EmployeTabel = () => {
  const {
    officeEmployeeData: data,
    handleEdit,
    handleAlert,
    onSendVisaReminder,
    isSendingReminder,
    onResetPassword,
    onLockdown,
    onReset2FA,
    onRecordRightToWork,
  } = useCommonContext();

  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "superAdmin";
  const currentUserId = session?.user?._id;

  return (
    <>
      {/* The table gets its own scroll viewport rather than pushing the page
          wide: eleven columns do not fit a laptop screen, and scrolling the
          whole page moved the filters and the header off-screen to read a
          column. Vertical scrolling is capped too, so the pagination controls
          stay reachable without scrolling past every row. */}
      <Table containerClassName="max-h-[calc(100vh-22rem)] min-h-[12rem] overflow-auto rounded-md border">
        {/* z-[1] deliberately, NOT z-10: the sidebar is `fixed inset-y-0 z-10`
            (components/ui/sidebar.jsx) and the main content paints after it, so
            anything here at z-10 wins the tie and covers the sidebar. This only
            ever needs to stack above the table's own rows, which set no z-index
            at all. */}
        <TableHeader className="sticky top-0 z-[1] bg-background shadow-[inset_0_-1px_0_var(--color-border)]">
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
              "Right to work",
              "Actions",
            ].map((item, index) => (
              <TableHead
                className="uppercase text-xs whitespace-nowrap"
                key={index}
              >
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
            const rtw = getRightToWorkStatus({
              immigrationType: item?.immigrationType,
              visaEndDate: item?.visaEndDate,
              checks: item?.rightToWorkChecks,
            });
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
                  {/* Shown so the reset action above is an informed one. The
                      "·0" marks an account with no recovery codes left — one
                      lost phone away from needing a reset. */}
                  {item?.twoFactorEnabled && (
                    <Badge
                      variant="outline"
                      className="gap-1"
                      title={`2FA enabled — ${
                        item?.twoFactorBackupCodes ?? 0
                      } unused recovery code(s)`}
                    >
                      <ShieldCheck className="h-3 w-3 text-emerald-600" />
                      2FA
                      {(item?.twoFactorBackupCodes ?? 0) === 0 && (
                        <span className="text-rose-600">·0</span>
                      )}
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
              {/* The date of the latest check, plus whether it still covers the
                  visa currently on file — a check only ever proved what was
                  true on the day it was made. */}
              <TableCell>
                <div className="leading-tight">
                  <div>
                    {rtw.lastCheckedAt
                      ? format(new Date(rtw.lastCheckedAt), "PPP")
                      : "—"}
                  </div>
                  <div className={`text-xs ${RTW_STATUS_TEXT[rtw.level]}`}>
                    {rtw.label}
                  </div>
                </div>
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
                  {/* Self-reset is refused by the server action — resetting
                      your own 2FA would leave you running without it until your
                      next login — so the button is not offered for yourself. */}
                  {/* Recording a check lives on the row, not in the employee
                      form: the form could only ever hold the last one. */}
                  <Button
                    onClick={() => onRecordRightToWork?.(item)}
                    variant="outline"
                    size="icon"
                    title={`Record right to work check — ${rtw.detail}`}
                    className={rtw.needsCheck ? "border-rose-300" : ""}
                  >
                    <BadgeCheck
                      className={
                        rtw.needsCheck ? "text-rose-600" : "text-emerald-600"
                      }
                    />
                  </Button>
                  {isSuperAdmin &&
                    item?.twoFactorEnabled &&
                    String(item?._id) !== String(currentUserId) && (
                      <Button
                        onClick={() => onReset2FA?.(item)}
                        variant="outline"
                        size="icon"
                        title="Reset 2FA (user lost their authenticator app and recovery codes)"
                      >
                        <ShieldOff className="text-amber-600" />
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
