"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeOffIcon, LockIcon, LockKeyholeIcon, UnlockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFetchQuery } from "@/hooks/use-query";
import {
  canViewSensitiveDetails,
  revealSensitiveDetails,
} from "@/server/officeServer/sensitiveDetailsServer";

const MASK = "••••••••";

/**
 * An employee's bank account details and National Insurance number. Neither is
 * sent with the rest of the profile — only a super admin or a user with the
 * sensitive details permission can fetch them, and only after re-entering their
 * own password. One unlock reveals both.
 *
 * @param {{ slug: string[], employeeType?: "office" | "site" }} props
 */
export default function SensitiveDetailsCard({
  slug,
  employeeType = "office",
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [details, setDetails] = useState(null);

  const { data: access } = useFetchQuery({
    fetchFn: canViewSensitiveDetails,
    queryKey: ["canViewSensitiveDetails"],
  });
  const allowed = access?.newData === true;

  const { mutate: unlock, isPending } = useMutation({
    mutationFn: async (value) =>
      revealSensitiveDetails({ slug, employeeType, password: value }),
    onSuccess: (response) => {
      if (!response?.success) {
        toast.error(response?.message || "Could not unlock these details");
        return;
      }
      setDetails(JSON.parse(response.data || "{}"));
      setPassword("");
      setOpen(false);
      toast.success("Details unlocked");
    },
    onError: (error) => {
      toast.error(`Error: ${error?.message || error}`);
    },
  });

  const handleUnlock = (e) => {
    e.preventDefault();
    if (!password) return toast.warning("Please enter your password");
    unlock(password);
  };

  const handleHide = () => {
    setDetails(null);
    setPassword("");
  };

  const groups = [
    {
      title: "Bank Account Details",
      rows: [
        { label: "Account Name", value: details?.bankDetail?.accountName },
        { label: "Bank Name", value: details?.bankDetail?.bankName },
        { label: "Account No", value: details?.bankDetail?.accountNumber },
        { label: "Sort Code", value: details?.bankDetail?.sortCode },
      ],
    },
    {
      title: "Identity",
      rows: [{ label: "National Insurance No", value: details?.employeNI }],
    },
  ];

  return (
    <div className="px-5 bg-white rounded-xl divide-y divide-dashed divide-gray-300 border">
      <div className="py-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-gray-800 font-semibold text-pretty flex items-center gap-2">
            {details ? (
              <UnlockIcon className="size-4 text-indigo-600" />
            ) : (
              <LockIcon className="size-4 text-gray-400" />
            )}
            Bank &amp; NI Details
          </h2>
          {!allowed ? (
            <span className="text-xs text-gray-500">Restricted</span>
          ) : details ? (
            <Button size="sm" variant="outline" onClick={handleHide}>
              <EyeOffIcon className="size-4" />
              Hide
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <LockKeyholeIcon className="size-4" />
              Unlock
            </Button>
          )}
        </div>

        {!allowed ? (
          <p className="text-sm text-gray-500">
            You do not have permission to view bank or NI details.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.title}>
                <h3 className="text-sm font-medium text-gray-500 mb-1">
                  {group.title}
                </h3>
                <dl className="sm:gap-y-2 sm:grid-cols-2 gap-x-4 grid-cols-1 grid">
                  {group.rows.map((row) => (
                    <DetailRow
                      key={row.label}
                      label={row.label}
                      value={row.value}
                      unlocked={Boolean(details)}
                    />
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPassword("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm your password</DialogTitle>
            <DialogDescription>
              Enter your own account password to view this employee&apos;s bank
              and NI details. This is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUnlock} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sensitive-details-password">Password</Label>
              <Input
                id="sensitive-details-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Checking..." : "Show details"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DetailRow = ({ label, value, unlocked }) => (
  <>
    <dt className="sm:py-0.5 text-gray-500 text-base">{label}</dt>
    <dd
      className={`sm:py-0.5 font-semibold text-base text-pretty ${
        unlocked ? "text-gray-700" : "text-gray-400 tracking-widest"
      }`}
    >
      {unlocked ? value || "-" : MASK}
    </dd>
  </>
);
