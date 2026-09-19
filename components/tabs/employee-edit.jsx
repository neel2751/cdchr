"use client";
import React, { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { UserAvatar } from "../Avatar/Avatar";
import { useAvatar } from "../Avatar/AvatarContext";
import { GlobalForm } from "../form/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery } from "@/hooks/use-query";
import { useCommonContext } from "@/context/commonContext";
import {
  canManageEmployees,
  handleOfficeEmployee,
} from "@/server/officeServer/officeServer";
import {
  PROTECTED_FIELD_NAMES,
  useOfficeEmployeeFields,
} from "@/hooks/useOfficeEmployeeFields";
import { LockIcon } from "lucide-react";

/**
 * How OFFICEFIELD is split across the tabs.
 *
 * Order within a group is the order given here; anything in OFFICEFIELD that no
 * group claims falls into "Other" rather than disappearing. That catch-all is
 * the point — this tab previously hand-picked three field names, so the twenty
 * or so that nobody had thought about were quietly missing, and adding a field
 * to the form never reached this screen at all.
 */
const FIELD_GROUPS = [
  {
    id: "personal",
    title: "Personal",
    description: "Who this person is, and how to reach them.",
    names: ["name", "employeId", "dateOfBirth", "phoneNumber", "email"],
  },
  {
    id: "address",
    title: "Address",
    description: "Home address, as held for payroll and correspondence.",
    names: ["address", "streetAddress", "city", "postCode", "country"],
  },
  {
    id: "employment",
    title: "Employment",
    description: "Where they sit in the company, and for how long.",
    names: ["department", "roleType", "company", "employeType", "joinDate", "endDate"],
  },
  {
    id: "hours",
    title: "Hours",
    description:
      "The contracted week. Leave holiday entitlement to recalculate after a change here.",
    names: [
      "dayPerWeek",
      "weeklyHourType",
      "weeklyHours",
      "hoursPerWeek",
      "weeksPerYear",
    ],
  },
  {
    id: "rightToWork",
    title: "Right to work",
    description: "Immigration status and visa dates. Drives the expiry reminders.",
    names: [
      "immigrationType",
      "immigrationCategory",
      "countryOfWork",
      "visaStartDate",
      "visaEndDate",
    ],
  },
  {
    id: "emergency",
    title: "Emergency",
    description: "Who to call if something happens at work.",
    names: [
      "emergencyName",
      "emergencyRelation",
      "emergencyPhoneNumber",
      "emergencyAddress",
    ],
  },
];

const EmployeeEdit = () => {
  const { newData } = useAvatar();
  const { searchParams } = useCommonContext();

  // Bank details and the NI number are deliberately absent. employeeDeatils()
  // strips them from every profile read — they are released only by
  // revealSensitiveDetails(), against a re-typed password — so a form here
  // would show blanks and ask HR to retype an NI number to save a visa date.
  // They are read on the Overview tab, through the card built for it.
  //
  // Leaving them out is also what keeps the stored values safe: the payload
  // then carries no bank fields, so buildOfficeEmployeePayload leaves
  // `bankDetail` alone, and no `employeNI` to overwrite with a blank.
  const { fields } = useOfficeEmployeeFields({ omit: PROTECTED_FIELD_NAMES });

  const { data: manageAccess } = useFetchQuery({
    fetchFn: canManageEmployees,
    queryKey: ["canManageEmployees"],
  });
  const canManage = manageAccess?.newData === true;

  const tabList = useMemo(() => {
    const claimed = new Set(FIELD_GROUPS.flatMap((group) => group.names));
    const groups = FIELD_GROUPS.map((group) => ({
      ...group,
      // Filtered against what the hook actually returned, so a field hidden by
      // permission does not leave an empty slot behind.
      content: group.names
        .map((name) => fields.find((item) => item.name === name))
        .filter(Boolean),
    })).filter((group) => group.content.length > 0);

    const unclaimed = fields.filter((item) => !claimed.has(item.name));
    if (unclaimed.length > 0) {
      groups.push({
        id: "other",
        title: "Other",
        description: "Fields not yet grouped on this screen.",
        content: unclaimed,
      });
    }
    return groups;
  }, [fields]);

  const queryKey = ["employeeDeatils", searchParams];

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) => await handleOfficeEmployee(data, newData?._id),
    invalidateKey: queryKey,
    onSuccessMessage: () => "Employee updated successfully",
    onClose: () => {},
  });

  return (
    <div className="w-full">
      <Card>
        <CardHeader>
          {/* Was "Account Settings — Manage your account information", left
              over from when this component was also the signed-in user's own
              account page. It is not: this is HR editing somebody else, and the
              heading should say whose record is open. */}
          <CardTitle>
            Edit {newData?.name || newData?.fullName || "employee"}
          </CardTitle>
          <CardDescription>
            Changes here are recorded against this employee in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* The picker of stock faces that used to sit here is gone — it wrote
              one shared browser-wide key, so it was never this employee's
              picture. People set their own photo in My Profile. */}
          <div className="flex items-center gap-4 border-b pb-5">
            <UserAvatar
              className="h-14 w-14"
              fallbackName={newData?.name || newData?.fullName || "CDC"}
            />
            <div className="space-y-0.5">
              <Label className="text-sm">
                {newData?.name || newData?.fullName || "—"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {newData?.profileImage?.key
                  ? "Photo set by the employee in My Profile."
                  : "No photo yet — employees add their own from My Profile."}
              </p>
            </div>
          </div>

          <Tabs defaultValue={tabList[0]?.id || "personal"}>
            {/* Wraps rather than a fixed four-column grid: the number of tabs
                depends on what this viewer may edit, so a fixed count was
                always going to be wrong for somebody. */}
            <TabsList className="flex flex-wrap h-auto justify-start gap-1">
              {tabList.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabList.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="pt-4">
                <p className="text-xs text-muted-foreground mb-4">
                  {tab.description}
                </p>
                <GlobalForm
                  fields={tab.content}
                  initialValues={newData}
                  btnName="Save changes"
                  isLoading={isPending}
                  isHide={!canManage}
                  onSubmit={(data) => handleSubmit(data)}
                />
                {!canManage && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                    <LockIcon className="size-3" />
                    You can see this record but not change it. Ask a super admin
                    for staff management access.
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground border-t pt-4">
            <LockIcon className="size-3 mt-0.5 shrink-0" />
            <span>
              Bank details and the National Insurance number are not edited
              here. They are protected, and open on the Overview tab against
              your own password.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmployeeEdit;
