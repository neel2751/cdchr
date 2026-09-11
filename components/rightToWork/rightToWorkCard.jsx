"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDate } from "@/lib/formatDate";
import {
  RTW_STATUS_BADGE,
  getRightToWorkStatus,
  sortRightToWorkChecks,
} from "@/lib/rightToWork";

/**
 * Read-only right-to-work panel for an employee profile: the current standing
 * plus every check ever recorded, newest first. Each row keeps the visa expiry
 * that was on file at the time, which is what makes an old check readable — it
 * shows exactly which permission was verified.
 *
 * Checks are recorded from the employee list row action, not here.
 *
 * @param {{ immigrationType?: string, visaEndDate?: string|Date|null,
 *           checks?: Array }} props
 */
const RightToWorkCard = ({ immigrationType, visaEndDate, checks }) => {
  const status = getRightToWorkStatus({ immigrationType, visaEndDate, checks });
  const history = sortRightToWorkChecks(checks);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Right to Work</CardTitle>
          <Badge variant={RTW_STATUS_BADGE[status.level]}>{status.label}</Badge>
        </div>
        <CardDescription>{status.detail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-gray-500">Last checked</span>
          <span className="font-medium">
            {formatDisplayDate(status.lastCheckedAt, "Never checked")}
          </span>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-gray-500">
            No right-to-work checks have been recorded yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {history.map((check, index) => (
              <li key={check?._id || index} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {formatDisplayDate(check?.checkedAt)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {check?.documentType || "—"}
                    {check?.shareCode ? ` · ${check.shareCode}` : ""}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Visa expiry at the time:{" "}
                  {formatDisplayDate(check?.visaEndDate)}
                  {check?.checkedBy?.name ? ` · by ${check.checkedBy.name}` : ""}
                </div>
                {check?.note && (
                  <p className="text-xs text-gray-600">{check.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default RightToWorkCard;
