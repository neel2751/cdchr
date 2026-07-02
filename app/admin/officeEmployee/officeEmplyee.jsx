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
import { Plus } from "lucide-react";
import React, { useState } from "react";
import EmployeTabel from "./employeTabel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { toast } from "sonner";
import Pagination from "@/lib/pagination";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import {
  getSelectCompanies,
  getSelectRoleType,
} from "@/server/selectServer/selectServer";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { CommonContext } from "@/context/commonContext";
import { OFFICEFIELD } from "@/data/fields/fields";
import Alert from "@/components/alert/alert";
import OfficeEmployeeForm from "./components/officeEmployeeForm";
import CompanyWiseCountCard from "./components/companyWiseCountCard";
import { sendVisaReminderManually } from "@/server/visaServer/visaServer";
import VisaReminderDialog from "../_components/visaReminderDialog";
import ResetPasswordDialog from "../_components/resetPasswordDialog";
import LockdownDialog from "../_components/lockdownDialog";

const VISA_STATUS_OPTIONS = [
  { label: "All Visa", value: "" },
  { label: "Expiring (≤90d)", value: "expiring" },
  { label: "Expired", value: "expired" },
  { label: "Valid", value: "valid" },
];
const ACCOUNT_STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "All Accounts", value: "all" },
];

const OfficeEmplyee = ({ searchParams }) => {
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
    // Default to active-only; switch to "inactive" or "all" to see the rest.
    status: "active",
  });
  const queryKey = [
    "officeEmployee",
    { query, currentPage, pagePerData, filter },
  ];

  const { data: companyWiseCount } = useFetchQuery({
    fetchFn: countCompanyWiseEmployees,
    queryKey: ["countCompanyWiseEmployees"],
  });
  const { newData: companyWiseEmployeeCount = [] } = companyWiseCount || {};

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

  const { data: selectRoleType = [] } = useFetchSelectQuery({
    queryKey: ["selectRoleType"],
    fetchFn: getSelectRoleType,
  });

  const { data: selectCompany = [] } = useFetchSelectQuery({
    queryKey: ["selectCompany"],
    fetchFn: getSelectCompanies,
  });

  const field = OFFICEFIELD.map((item) => {
    if (item.name === "department") {
      return {
        ...item,
        options: selectRoleType,
      };
    }
    if (item.name === "company") {
      return {
        ...item,
        options: selectCompany,
      };
    }
    return item;
  });

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
      mutationFn: async ({ employeeId, newPassword, reason }) =>
        resetOfficeEmployeePassword({ employeeId, newPassword, reason }),
      invalidateKey: queryKey,
      onSuccessMessage: (message) => message || "Password reset successfully",
      onClose: () => setResetTarget(null),
    });

  const onResetPassword = (item) => setResetTarget(item);

  const confirmResetPassword = ({ newPassword, reason }) => {
    if (!resetTarget?._id) return;
    resetPassword({ employeeId: resetTarget._id, newPassword, reason });
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

  const immigrationField = field.find((it) => it.name === "immigrationType");
  const options = immigrationField?.options || [];

  return (
    <div className="p-4 w-full mx-auto overflow-scroll">
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
        }}
      >
        <div>
          <Card>
            <CompanyWiseCountCard data={companyWiseEmployeeCount} />
            <CardHeader>
              <div className="mb-4">
                <CardTitle>Office Management</CardTitle>
              </div>
              <div className="flex items-center justify-between">
                <SearchDebounce />
                <div className="flex gap-2">
                  <div>
                    <SelectFilter
                      value={filter?.role || ""}
                      frameworks={[
                        { label: "All", value: "" },
                        ...selectRoleType,
                      ]}
                      placeholder={filter?.role === "" ? "All" : "Select Role"}
                      onChange={(e) => setFilter({ ...filter, role: e })}
                      noData="No Data found"
                    />
                  </div>
                  <div>
                    <SelectFilter
                      value={filter.company}
                      frameworks={[
                        { label: "All", value: "" },
                        ...selectCompany,
                      ]}
                      placeholder={
                        filter.company === "" ? "All" : "Select Company"
                      }
                      onChange={(e) => setFilter({ ...filter, company: e })}
                      noData="No Data found"
                    />
                  </div>
                  <div>
                    <SelectFilter
                      value={filter?.type || ""}
                      frameworks={[{ label: "All", value: "" }, ...options]}
                      placeholder={filter.type === "" ? "All" : "Select Type"}
                      onChange={(e) => setFilter({ ...filter, type: e })}
                      noData="No Data found"
                    />
                  </div>
                  <div>
                    <SelectFilter
                      value={filter?.visaStatus || ""}
                      frameworks={VISA_STATUS_OPTIONS}
                      placeholder={
                        filter.visaStatus === "" ? "All Visa" : "Visa status"
                      }
                      onChange={(e) => setFilter({ ...filter, visaStatus: e })}
                      noData="No Data found"
                    />
                  </div>
                  <div>
                    <SelectFilter
                      value={filter?.status || ""}
                      frameworks={ACCOUNT_STATUS_OPTIONS}
                      placeholder="Account status"
                      onChange={(e) => setFilter({ ...filter, status: e })}
                      noData="No Data found"
                    />
                  </div>
                  <Button onClick={handleAdd}>
                    <Plus />
                    Add
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading && <div>Loading.....</div>}
              {isError && <div> Something went wrong</div>}

              {officeEmployeeData.length <= 0 ? (
                <div className="text-center text-gray-500">No Data found</div>
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
        </div>
      </CommonContext.Provider>
    </div>
  );
};

export default OfficeEmplyee;
