"use client";
import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import {
  countCompanyWiseEmployees,
  getOfficeEmployee,
  handleOfficeEmployee,
  officeEmployeeDelete,
  OfficeEmployeeStatus,
  resetOfficeEmployeePassword,
  emergencyLockdownAccount,
} from "@/server/officeServer/officeServer";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import React, { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import EmployeTabel from "./employeTabel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { toast } from "sonner";
import Pagination from "@/lib/pagination";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { CommonContext } from "@/context/commonContext";
import { useOfficeEmployeeFields } from "@/hooks/useOfficeEmployeeFields";
import Alert from "@/components/alert/alert";
import OfficeEmployeeForm from "./components/officeEmployeeForm";
import CompanyWiseCountCard from "./components/companyWiseCountCard";
import { sendVisaReminderManually } from "@/server/visaServer/visaServer";
import VisaReminderDialog from "../_components/visaReminderDialog";
import ResetPasswordDialog from "../_components/resetPasswordDialog";
import LockdownDialog from "../_components/lockdownDialog";
import ResetTwoFactorDialog from "../_components/resetTwoFactorDialog";
import { resetTwoFactorForEmployee } from "@/server/2FAServer/TwoAuthserver";
import RightToWorkDialog from "../_components/rightToWorkDialog";
import { recordRightToWorkCheck } from "@/server/visaServer/rightToWorkServer";

const VISA_STATUS_OPTIONS = [
  { label: "All Visa", value: "" },
  { label: "Expiring (≤90d)", value: "expiring" },
  { label: "Expired", value: "expired" },
  { label: "Valid", value: "valid" },
];
const OfficeEmplyee = ({ searchParams, variant = "active" }) => {
  // "active" = the main Office Management page (active staff only);
  // "previous" = the Previous Office Employees page (inactive staff only).
  const isPrevious = variant === "previous";
  const currentPage = parseInt(searchParams.page || "1");
  const pagePerData = parseInt(searchParams.pageSize || "10");
  const query = searchParams.query;
  const [showDialog, setShowDialog] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [initialValues, setInitialValues] = useState({});
  const [alert, setAlert] = useState({});
  const [filter, setFilter] = useState({
    company: "",
    role: "",
    type: "",
    visaStatus: "",
    // Locked per page: the main list shows active staff, the Previous
    // Office Employees page shows inactive staff. No in-page status toggle.
    status: isPrevious ? "inactive" : "active",
  });

  const pathname = usePathname();
  const { replace } = useRouter();
  const urlSearchParams = useSearchParams();

  // Apply a filter change AND jump back to page 1. Without the reset, a filter
  // applied while on page 2+ would query the smaller result set on a page that
  // no longer exists, showing "No data found" even though matches exist.
  const updateFilter = (patch) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    const params = new URLSearchParams(urlSearchParams);
    if (params.get("page") && params.get("page") !== "1") {
      params.set("page", "1");
      replace(`${pathname}?${params.toString()}`);
    }
  };
  const queryKey = [
    "officeEmployee",
    { query, currentPage, pagePerData, filter },
  ];

  // Keyed on the company so the cards re-fetch whenever that filter changes.
  // Skipped entirely on the Previous Office Employees page: the stats describe
  // current staff, so they say nothing about the leavers listed there.
  const { data: companyWiseCount } = useFetchQuery({
    params: { company: filter.company },
    fetchFn: countCompanyWiseEmployees,
    queryKey: ["countCompanyWiseEmployees", filter.company],
    enabled: !isPrevious,
  });
  const { newData: employeeStats } = companyWiseCount || {};

  const {
    data: queryResult,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      page: currentPage || 1,
      pageSize: pagePerData || 10,
      query: query || "",
      filter: filter || {}, // Ensure filter is always an object
    },
    queryKey,
    fetchFn: getOfficeEmployee,
    // fetchFn: async () => {
    //   try {
    //     return await getOfficeEmployee();
    //   } catch (error) {
    //     console.log("Error fetching office employees:", error);
    //     return { newData: [], totalCount: 0 };
    //   }
    // },
  });

  const { newData: officeEmployeeData = [], totalCount = 0 } =
    queryResult || {};

  // The form's fields, the sensitive-field filter and the three database-backed
  // option lists, all from one place. This used to be forty lines here and a
  // different forty on the employee Edit tab, which is how that tab ended up
  // showing three fields out of thirty — the two copies had nothing holding
  // them together. The department and company lists come back out because the
  // filter row below needs the same two.
  const {
    fields: field,
    selectRoleType,
    selectCompany,
  } = useOfficeEmployeeFields();

  const handleClose = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(false);
    setIsEdit(false);
  };
  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await handleOfficeEmployee(data, initialValues?._id),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `Employee ${initialValues?._id ? "Updated" : "Created"} successfully`,
    onClose: () => handleClose(),
  });

  const onSubmit = (data) => {
    // Previous / historical employees are entered with a visa end date that has
    // already passed, so we no longer block past visa end dates here.
    handleSubmit(data);
  };

  const handleEdit = (item) => {
    setInitialValues({
      ...item,
      department: item.department._id,
      company: item.company._id,
      accountName: item?.bankDetail?.accountName,
      bankName: item?.bankDetail?.bankName,
      accountNumber: item?.bankDetail?.accountNumber,
      sortCode: item?.bankDetail?.sortCode,
    });
    setIsEdit(true);
    setShowDialog(true);
  };

  const handleAdd = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(true);
  };

  const alertClose = () => {
    setAlert({});
  };

  const { mutate: handleStatus, isPending: isStatusPending } =
    useSubmitMutation({
      mutationFn: async () =>
        alert?.type === "Delete"
          ? await officeEmployeeDelete(alert)
          : await OfficeEmployeeStatus(alert),
      invalidateKey: queryKey,
      onSuccessMessage: (response) =>
        `${
          alert.type === "Delete"
            ? "Employee Delete"
            : alert.name === "isActive"
              ? "Status Updated"
              : "Timesheet status updated"
        } successfully`,
      onClose: alertClose,
    });

  const handleAlert = (id, type, status, name) => {
    setAlert({ id, type, status, name });
  };

  const [reminderTarget, setReminderTarget] = useState(null);

  const { mutate: sendVisaReminder, isPending: isSendingReminder } =
    useSubmitMutation({
      mutationFn: async (payload) => sendVisaReminderManually(payload),
      invalidateKey: queryKey,
      onSuccessMessage: (message) => message,
      onClose: () => setReminderTarget(null),
    });

  const onSendVisaReminder = (item) =>
    setReminderTarget({
      employeeId: item?._id,
      employeeType: "OfficeEmploye",
      name: item?.name,
      visaEndDate: item?.visaEndDate,
      // The reminder dialog also reports when right to work was last checked:
      // an expiring visa is exactly what prompts the next check.
      immigrationType: item?.immigrationType,
      checks: item?.rightToWorkChecks,
    });

  const confirmVisaReminder = (ccHr) => {
    if (!reminderTarget) return;
    sendVisaReminder({
      employeeId: reminderTarget.employeeId,
      employeeType: reminderTarget.employeeType,
      ccHr,
    });
  };

  const [resetTarget, setResetTarget] = useState(null);

  const { mutate: resetPassword, isPending: isResettingPassword } =
    useSubmitMutation({
      mutationFn: async ({
        employeeId,
        newPassword,
        reason,
        signOutEverywhere,
        requirePasswordChange,
      }) =>
        resetOfficeEmployeePassword({
          employeeId,
          newPassword,
          reason,
          signOutEverywhere,
          requirePasswordChange,
        }),
      invalidateKey: queryKey,
      onSuccessMessage: (message) => message || "Password reset successfully",
      onClose: () => setResetTarget(null),
    });

  const onResetPassword = (item) => setResetTarget(item);

  const confirmResetPassword = ({
    newPassword,
    reason,
    signOutEverywhere,
    requirePasswordChange,
  }) => {
    if (!resetTarget?._id) return;
    resetPassword({
      employeeId: resetTarget._id,
      newPassword,
      reason,
      signOutEverywhere,
      requirePasswordChange,
    });
  };

  const [lockdownTarget, setLockdownTarget] = useState(null);

  const { mutate: lockdown, isPending: isLockingDown } = useSubmitMutation({
    mutationFn: async ({ employeeId, reason }) =>
      emergencyLockdownAccount({ employeeId, reason }),
    invalidateKey: queryKey,
    onSuccessMessage: (message) => message || "Account locked down",
    onClose: () => setLockdownTarget(null),
  });

  const onLockdown = (item) => setLockdownTarget(item);

  const confirmLockdown = ({ reason }) => {
    if (!lockdownTarget?._id) return;
    lockdown({ employeeId: lockdownTarget._id, reason });
  };

  // Last resort for someone who has lost both their authenticator app and their
  // recovery codes. Invalidates the list so the 2FA badge on the row clears.
  const [reset2FATarget, setReset2FATarget] = useState(null);

  const { mutate: resetTwoFactor, isPending: isResettingTwoFactor } =
    useSubmitMutation({
      mutationFn: async ({ employeeId, reason }) =>
        resetTwoFactorForEmployee({ employeeId, reason }),
      invalidateKey: queryKey,
      onSuccessMessage: (message) => message || "2FA reset",
      onClose: () => setReset2FATarget(null),
    });

  const onReset2FA = (item) => setReset2FATarget(item);

  const confirmReset2FA = ({ reason }) => {
    if (!reset2FATarget?._id) return;
    resetTwoFactor({ employeeId: reset2FATarget._id, reason });
  };

  // Right-to-work checks are recorded from a row action rather than the
  // employee form: each check is a dated event kept alongside the previous
  // ones, and the visa reminder is what prompts HR to record the next one.
  const [rightToWorkTarget, setRightToWorkTarget] = useState(null);

  const { mutate: recordRightToWork, isPending: isRecordingRightToWork } =
    useSubmitMutation({
      mutationFn: async (payload) => recordRightToWorkCheck(payload),
      invalidateKey: queryKey,
      onSuccessMessage: (message) => message || "Right-to-work check recorded",
      onClose: () => setRightToWorkTarget(null),
    });

  const onRecordRightToWork = (item) =>
    setRightToWorkTarget({
      employeeId: item?._id,
      employeeType: "OfficeEmploye",
      name: item?.name,
      email: item?.email,
      immigrationType: item?.immigrationType,
      immigrationCategory: item?.immigrationCategory,
      visaStartDate: item?.visaStartDate,
      visaEndDate: item?.visaEndDate,
      checks: item?.rightToWorkChecks,
    });

  const confirmRightToWork = (payload) => {
    if (!rightToWorkTarget?.employeeId) return;
    recordRightToWork({
      employeeId: rightToWorkTarget.employeeId,
      employeeType: rightToWorkTarget.employeeType,
      ...payload,
    });
  };

  const immigrationField = field.find((it) => it.name === "immigrationType");
  const options = immigrationField?.options || [];

  // `status` is fixed per page (active vs previous), so it is not a filter the
  // user set and must not be counted or cleared.
  const activeFilterCount = ["company", "role", "type", "visaStatus"].filter(
    (key) => filter[key]
  ).length;

  const clearFilters = () =>
    updateFilter({ company: "", role: "", type: "", visaStatus: "" });

  return (
    // `overflow-scroll` here used to make the whole page scroll sideways to
    // reach the table's later columns. The table now owns its own scrolling, so
    // this only needs to not overflow: min-w-0 lets the flex/grid parent shrink
    // it instead of letting the wide table dictate the page width.
    <div className="w-full min-w-0 p-4">
      <CommonContext.Provider
        value={{
          officeEmployeeData,
          isPending,
          onSubmit,
          field,
          setInitialValues,
          initialValues,
          handleEdit,
          currentPage,
          pagePerData,
          totalCount,
          handleAlert,
          onSendVisaReminder,
          isSendingReminder,
          onResetPassword,
          onLockdown,
          onReset2FA,
          onRecordRightToWork,
        }}
      >
        <div>
          <Card>
            {!isPrevious && (
              <CompanyWiseCountCard
                data={employeeStats}
                companyName={
                  selectCompany.find((c) => c.value === filter.company)?.label
                }
              />
            )}
            <CardHeader>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CardTitle>
                    {isPrevious ? "Previous Office Staff" : "Office Staff"}
                  </CardTitle>
                  {totalCount > 0 && (
                    <Badge variant="secondary" className="tabular-nums">
                      {totalCount}
                    </Badge>
                  )}
                </div>
                {!isPrevious && (
                  <Button onClick={handleAdd}>
                    <Plus className="mr-1 size-4" />
                    Add employee
                  </Button>
                )}
              </div>

              {/* Filters wrap instead of overflowing, and say how many are
                  active — four dropdowns all reading "All" gave no clue that a
                  short result list was the filters' doing rather than the data's. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-56 flex-1">
                  <SearchDebounce placeholder="Search name or email..." />
                </div>
                <SelectFilter
                  label="Department"
                  value={filter?.role || ""}
                  frameworks={[{ label: "All", value: "" }, ...selectRoleType]}
                  placeholder="All"
                  onChange={(e) => updateFilter({ role: e })}
                  noData="No Data found"
                />
                {/* Only shown when there is a genuine choice. Inside a tenant
                    every employee belongs to that one company, so the filter
                    could never narrow anything — see getSelectCompanies. */}
                {selectCompany.length > 1 && (
                  <SelectFilter
                    label="Company"
                    value={filter.company}
                    frameworks={[{ label: "All", value: "" }, ...selectCompany]}
                    placeholder="All"
                    onChange={(e) => updateFilter({ company: e })}
                    noData="No Data found"
                  />
                )}
                <SelectFilter
                  label="Immigration"
                  value={filter?.type || ""}
                  frameworks={[{ label: "All", value: "" }, ...options]}
                  placeholder="All"
                  onChange={(e) => updateFilter({ type: e })}
                  noData="No Data found"
                />
                <SelectFilter
                  label="Visa"
                  value={filter?.visaStatus || ""}
                  frameworks={VISA_STATUS_OPTIONS}
                  placeholder="All Visa"
                  onChange={(e) => updateFilter({ visaStatus: e })}
                  noData="No Data found"
                />
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="text-neutral-500"
                  >
                    <X className="mr-1 size-4" />
                    Clear {activeFilterCount}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading && <div>Loading.....</div>}
              {isError && <div> Something went wrong</div>}

              {officeEmployeeData.length <= 0 ? (
                // Distinguishes "you filtered everything out" from "there is
                // nothing here", and offers the way back.
                <div className="py-12 text-center">
                  <p className="text-sm text-gray-500">
                    {activeFilterCount > 0 || query
                      ? "No one matches these filters."
                      : isPrevious
                        ? "No previous office staff."
                        : "No office staff yet."}
                  </p>
                  {(activeFilterCount > 0 || query) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <EmployeTabel />
              )}
              {totalCount > 10 && (
                <div className="pt-4 mt-2 border-t">
                  <Pagination />
                </div>
              )}
            </CardContent>
          </Card>
          <OfficeEmployeeForm
            showDialog={showDialog}
            setShowDialog={setShowDialog}
            fields={field}
            initialValues={initialValues}
            handleSubmit={onSubmit}
            isEdit={isEdit}
            isPending={isPending}
          />
          <Alert
            open={alert?.type ? true : false}
            label={alert}
            setOpen={setAlert}
            onClose={alertClose}
            onConfirm={handleStatus}
            isPending={isStatusPending}
          />
          <VisaReminderDialog
            target={reminderTarget}
            onOpenChange={(o) => {
              if (!o) setReminderTarget(null);
            }}
            onConfirm={confirmVisaReminder}
            isPending={isSendingReminder}
          />
          <ResetPasswordDialog
            target={resetTarget}
            onOpenChange={(o) => {
              if (!o) setResetTarget(null);
            }}
            onConfirm={confirmResetPassword}
            isPending={isResettingPassword}
          />
          <LockdownDialog
            target={lockdownTarget}
            onOpenChange={(o) => {
              if (!o) setLockdownTarget(null);
            }}
            onConfirm={confirmLockdown}
            isPending={isLockingDown}
          />
          <ResetTwoFactorDialog
            target={reset2FATarget}
            onOpenChange={(o) => {
              if (!o) setReset2FATarget(null);
            }}
            onConfirm={confirmReset2FA}
            isPending={isResettingTwoFactor}
          />
          <RightToWorkDialog
            target={rightToWorkTarget}
            onOpenChange={(o) => {
              if (!o) setRightToWorkTarget(null);
            }}
            onConfirm={confirmRightToWork}
            isPending={isRecordingRightToWork}
          />
        </div>
      </CommonContext.Provider>
    </div>
  );
};

export default OfficeEmplyee;
