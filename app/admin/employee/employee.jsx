"use client";
import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isFuture } from "date-fns";
import { Plus } from "lucide-react";
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import EmployeTabel from "./employeTable";
import {
  employeeDelete,
  employeeStatus,
  getAllEmployees,
  handleEmploye,
  resetSiteEmployeePassword,
} from "@/server/employeServer/employeServer";
import { EMPLOYEFIELD } from "@/data/fields/fields";
import Pagination from "@/lib/pagination";
import { getSelectProjects } from "@/server/selectServer/selectServer";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { CommonContext } from "@/context/commonContext";
import { useSubmitMutation } from "@/hooks/use-mutate";
import EmployeeForm from "../officeEmployee/employeeForm";
import Alert from "@/components/alert/alert";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { sendVisaReminderManually } from "@/server/visaServer/visaServer";
import VisaReminderDialog from "../_components/visaReminderDialog";
import ResetPasswordDialog from "../_components/resetPasswordDialog";

const VISA_STATUS_OPTIONS = [
  { label: "All Visa", value: "" },
  { label: "Expiring (≤90d)", value: "expiring" },
  { label: "Expired", value: "expired" },
  { label: "Valid", value: "valid" },
];
const ACCOUNT_STATUS_OPTIONS = [
  { label: "All Accounts", value: "" },
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
];

const Employee = ({ searchParams }) => {
  const currentPage = parseInt(searchParams.page || "1");
  const pagePerData = parseInt(searchParams.pageSize || "10");
  const [initialValues, setInitialValues] = useState({});
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [alert, setAlert] = useState({});
  const [isChecked, setIsChecked] = useState(false);
  const [filter, setFilter] = useState({
    type: "",
    employeType: "",
    visaStatus: "",
    status: "",
  });
  const query = searchParams.query;
  const queryKey = ["employee", { query, currentPage, pagePerData, filter }];

  const { data: selectSiteProject = [] } = useFetchSelectQuery({
    queryKey: ["selectSiteProject"],
    fetchFn: getSelectProjects,
  });

  const {
    data: queryResult,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
      filter,
    },
    queryKey,
    fetchFn: getAllEmployees,
  });

  const { newData: officeEmployeeData = [], totalCount = 0 } =
    queryResult || {};

  const field = EMPLOYEFIELD.map((item) => {
    if (item.name === "projectSite") {
      return {
        ...item,
        options: selectSiteProject,
      };
    }
    return item;
  });

  const handleClose = () => {
    setInitialValues({});
    setOpen(false);
  };

  const handleEditClose = () => {
    setInitialValues({});
    setIsEdit(false);
  };

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await handleEmploye(data, isChecked, initialValues?._id),
    invalidateKey: queryKey,
    onSuccessMessage: (response) => `${response}`,
    onClose: initialValues._id ? handleEditClose : handleClose,
  });

  const handleEdit = (item) => {
    const { eAddress, bankDetail } = item;
    const newItem = {
      ...item,
      address: eAddress?.address,
      city: eAddress?.city,
      zipCode: eAddress?.zipCode,
      country: eAddress?.country,
      accountName: bankDetail?.accountName,
      accountNumber: bankDetail?.accountNumber,
      sortCode: bankDetail?.sortCode,
    };
    setInitialValues(newItem);
    setIsEdit(true);
  };
  const onSubmit = (data) => {
    // console.log(data);
    // return;

    if (data?.visaEndDate && !isFuture(new Date(data.eVisaExp))) {
      return toast.error("Visa Expiry should be greater than start date");
    }
    if (isChecked) {
      if (data?.payRate === initialValues?.payRate) {
        return toast.error(
          " Pay Rate should be different than previous one,  if you want to update"
        );
      }
      const confir = confirm(" Are you sure you want to submit this form?");
      if (confir) {
        handleSubmit(data);
      } else {
        return;
      }
    } else {
      handleSubmit(data);
    }
  };

  const alertClose = () => {
    setAlert({});
  };

  const { mutate: handleStatus, isPending: isStatusPending } =
    useSubmitMutation({
      mutationFn: async () =>
        alert?.type === "Delete"
          ? await employeeDelete(alert)
          : await employeeStatus(alert),
      invalidateKey: queryKey,
      onSuccessMessage: (response) =>
        `${
          alert.type === "Delete" ? "Employee Delete" : "Status Update"
        } successfully`,
      onClose: alertClose,
    });

  const handleAlert = (id, type, status) => {
    setAlert({ id, type, status });
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
      employeeType: "Employe",
      name: `${item?.firstName || ""} ${item?.lastName || ""}`.trim(),
      visaEndDate: item?.eVisaExp,
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
        resetSiteEmployeePassword({ employeeId, newPassword, reason }),
      invalidateKey: queryKey,
      onSuccessMessage: (message) => message || "Password reset successfully",
      onClose: () => setResetTarget(null),
    });

  const onResetPassword = (item) => setResetTarget(item);

  const confirmResetPassword = ({ newPassword, reason }) => {
    if (!resetTarget?._id) return;
    resetPassword({ employeeId: resetTarget._id, newPassword, reason });
  };

  const handleOpen = () => {
    setInitialValues({});
    setOpen(true);
  };

  return (
    <div className="p-4">
      <CommonContext.Provider
        value={{
          officeEmployeeData,
          isPending,
          onSubmit,
          field,
          setInitialValues,
          initialValues,
          handleEdit,
          handleEditClose,
          isEdit,
          handleAlert,
          setIsEdit,
          isChecked,
          setIsChecked,
          currentPage,
          pagePerData,
          totalCount,
          onSendVisaReminder,
          isSendingReminder,
          onResetPassword,
        }}
      >
        <div className="overflow-hidden">
          <Card>
            <CardHeader>
              <div className="mb-4">
                <CardTitle>Employee List</CardTitle>
              </div>
              <div className="flex items-center justify-between">
                <SearchDebounce />
                <div className="flex gap-2">
                  <div>
                    <SelectFilter
                      value={filter.employeType}
                      frameworks={[
                        { label: "All", value: "" },
                        {
                          label: "Monthly",
                          value: "Monthly",
                        },
                        {
                          label: "Weekly",
                          value: "Weekly",
                        },
                      ]}
                      placeholder={
                        filter.employeType === "" ? "All" : "Select Type"
                      }
                      onChange={(e) => setFilter({ ...filter, employeType: e })}
                      noData="No Data found"
                    />
                  </div>
                  <div>
                    <SelectFilter
                      value={filter.type}
                      frameworks={[
                        { label: "All", value: "" },
                        {
                          label: "British",
                          value: "British",
                        },
                        {
                          label: "Immigrant",
                          value: "Immigrant",
                        },
                      ]}
                      placeholder={filter.type === "" ? "All" : "Select Type"}
                      onChange={(e) => setFilter({ ...filter, type: e })}
                      noData="No Data found"
                    />
                  </div>
                  <div>
                    <SelectFilter
                      value={filter.visaStatus}
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
                      value={filter.status}
                      frameworks={ACCOUNT_STATUS_OPTIONS}
                      placeholder={
                        filter.status === "" ? "All Accounts" : "Account status"
                      }
                      onChange={(e) => setFilter({ ...filter, status: e })}
                      noData="No Data found"
                    />
                  </div>
                  <Button onClick={handleOpen}>
                    <Plus />
                    Add
                  </Button>
                  <Dialog open={open} onOpenChange={handleClose}>
                    <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-md md:max-w-lg lg:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Add New Role</DialogTitle>
                        <DialogDescription>
                          Please fill the form to add new role
                        </DialogDescription>
                      </DialogHeader>
                      <EmployeeForm />
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading && <div>Loading.....</div>}
              {isError && <div> Something went wrong</div>}
              {officeEmployeeData.length <= 0 ? (
                <div className="text-center text-gray-500">
                  No data available
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
        </div>
      </CommonContext.Provider>
    </div>
  );
};

export default Employee;
