"use client";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import {
  getSelectOfficeEmployee,
  getSelectProjects,
} from "@/server/selectServer/selectServer";
import {
  getAllSiteAssign,
  handleSiteAssignManager,
  handleSiteAssignManagerDelete,
  handleSiteAssignManagerStatus,
} from "@/server/siteAssignServer/siteAssignServer";
import SiteAssignTable from "./siteAssignTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ASSIGNSITEMANAGERFIELD } from "@/data/fields/fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import EmployeeForm from "../officeEmployee/employeeForm";
import { useSubmitMutation } from "@/hooks/use-mutate";
import Pagination from "@/lib/pagination";
import Alert from "@/components/alert/alert";

const SiteAssign = ({ searchParams }) => {
  const query = searchParams?.query;
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [initialValues, setInitialValues] = useState({});
  const [alert, setAlert] = useState({});

  const { data: selectSiteProject = [] } = useFetchSelectQuery({
    queryKey: ["selectSiteProject"],
    fetchFn: getSelectProjects,
  });

  const { data: selectOfficeEmployee = [] } = useFetchSelectQuery({
    queryKey: ["selectOfficeEmployee"],
    fetchFn: getSelectOfficeEmployee,
  });

  const queryKey = ["siteAssignManager", { currentPage, pagePerData, query }];
  const { data, isLoading, isError } = useFetchQuery({
    params: {
      page: currentPage,
      pageSize: pagePerData,
      query: query,
    },
    queryKey,
    fetchFn: getAllSiteAssign,
  });
  const { newData = [], totalCount } = data || {};

  const updatedRoleField = ASSIGNSITEMANAGERFIELD.map((field) => {
    if (field.name === "projectSiteID") {
      return {
        ...field,
        options: selectSiteProject,
      };
    }
    if (field.name === "roleId") {
      return { ...field, options: selectOfficeEmployee };
    }
    return field;
  });

  const handleClose = () => {
    setOpen(false);
    setInitialValues({});
  };
  const handleOpen = () => {
    setOpen(true);
    setInitialValues({});
  };

  const alertClose = () => {
    setAlert({});
  };
  const handleEdit = (item) => {
    setIsEdit(true);
    setInitialValues(item);
  };

  const handleEditClose = () => {
    setIsEdit(false);
    setInitialValues({});
  };

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await handleSiteAssignManager(data, initialValues._id),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `Site Assign${initialValues._id ? "Updated" : ""} successfully`,
    onClose: initialValues._id ? handleEditClose : handleClose,
  });

  const { mutate: handleStatus, isPending: isPendingStatus } =
    useSubmitMutation({
      mutationFn: async () =>
        alert?.type === "Delete"
          ? await handleSiteAssignManagerDelete(alert)
          : await handleSiteAssignManagerStatus(alert),
      invalidateKey: queryKey,
      onSuccessMessage: (response) =>
        `${
          alert.type === "Delete" ? "Deleted Site Assign" : "Status Updated"
        } successfully`,
      onClose: alertClose,
    });

  const handleAlert = (id, type, status) => {
    setAlert({ id, type, status });
  };

  const onSubmit = (data) => {
    handleSubmit(data);
  };

  return (
    <div className="p-4">
      <CommonContext.Provider
        value={{
          data: newData,
          totalCount,
          field: updatedRoleField,
          initialValues,
          isEdit,
          setIsEdit,
          handleEdit,
          handleEditClose,
          onSubmit,
          isPending,
          currentPage,
          pagePerData,
          totalCount,
          handleAlert,
        }}
      >
        <Card>
          <CardHeader>
            <div className="mb-4">
              <CardTitle>Site Assign</CardTitle>
            </div>
            <div className="flex items-center justify-between">
              <SearchDebounce />
              <div>
                <Button onClick={handleOpen}>
                  <Plus />
                  Add
                </Button>
                <Dialog
                  open={open}
                  onOpenChange={handleClose}
                  className="bg-black/80"
                >
                  <DialogContent className="sm:max-w-2xl max-h-max">
                    <DialogHeader>
                      <DialogTitle>Add New Site Assign</DialogTitle>
                      <DialogDescription>
                        Please fill the form to add new site assign
                      </DialogDescription>
                    </DialogHeader>
                    <EmployeeForm />
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && <div>Loading...</div>}
            {isError && (
              <div>
                <span className="text-red-500">Error loading data</span>
              </div>
            )}
            {newData?.length <= 0 ? (
              <div className="text-center text-gray-500">No data available</div>
            ) : (
              newData && <SiteAssignTable />
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
          isPending={isPendingStatus}
        />
      </CommonContext.Provider>
    </div>
  );
};

export default SiteAssign;
