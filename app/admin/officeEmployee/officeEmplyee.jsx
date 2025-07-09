"use client";
import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import {
  getOfficeEmployee,
  handleOfficeEmployee,
  officeEmployeeDelete,
  OfficeEmployeeStatus,
} from "@/server/officeServer/officeServer";
import { isFuture } from "date-fns";
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
  });
  const queryKey = [
    "officeEmployee",
    { query, currentPage, pagePerData, filter },
  ];

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
    //     console.error("Error fetching office employees:", error);
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
    if (data?.visaEndDate && !isFuture(new Date(data.visaEndDate))) {
      return toast.error("Visa End date should be greater than today");
    }
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
          alert.type === "Delete" ? "Employee Delete" : "Status Update"
        } successfully`,
      onClose: alertClose,
    });

  const handleAlert = (id, type, status) => {
    setAlert({ id, type, status });
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
        }}
      >
        <div>
          <Card>
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
        </div>
      </CommonContext.Provider>
    </div>
  );
};

export default OfficeEmplyee;
