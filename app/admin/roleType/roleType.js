"use client";

import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommonContext } from "@/context/commonContext";
import { ROLETYPEFIELD } from "@/data/fields/fields";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
import {
  getRoleTypes,
  handleRoleType,
  roletypeDelete,
  roletypeStatus,
} from "@/server/roleTypeServer/roleTypeServer";
import { Plus } from "lucide-react";
import { useState } from "react";
import EmployeeForm from "../officeEmployee/employeeForm";
import RoleTypeTable from "./roleTypeTable";
import Alert from "@/components/alert/alert";

const RoleType = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;
  const [initialValues, setInitialValues] = useState({});
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [alert, setAlert] = useState({});
  const queryKey = ["roleTypes", { query, currentPage, pagePerData }];

  const {
    data: queryResult,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      page: currentPage,
      pageSize: pagePerData,
      query: query,
    },
    queryKey,
    fetchFn: getRoleTypes,
  });
  const { newData: officeEmployeeData = [], totalCount = 0 } =
    queryResult || {};

  const handleClose = () => {
    setInitialValues({});
    setOpen(false);
  };
  const handleEditClose = () => {
    setInitialValues({});
    setIsEdit(false);
  };

  const { mutate: handleSubmit } = useSubmitMutation({
    mutationFn: async (data) => await handleRoleType(data, initialValues?._id),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `Department ${initialValues._id ? "Updated" : "Created"} successfully`,
    onClose: initialValues?._id ? handleEditClose : handleClose,
  });
  const onSubmit = (data) => {
    handleSubmit(data);
  };

  const handleEdit = (item) => {
    setInitialValues(item);
    setIsEdit(true);
  };

  const handleOpen = () => {
    setInitialValues({});
    setOpen(true);
  };

  const alertClose = () => {
    setAlert({});
  };

  const { mutate: handleStatus } = useSubmitMutation({
    mutationFn: async () =>
      alert?.type === "Delete"
        ? await roletypeDelete(alert)
        : await roletypeStatus(alert),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `${
        alert.type === "Delete" ? "Department Delete" : "Status Update"
      } successfully`,
    onClose: alertClose,
  });

  const handleAlert = (id, type, status) => {
    setAlert({ id, type, status });
  };

  return (
    <div className="p-4">
      <CommonContext.Provider
        value={{
          officeEmployeeData,
          handleSubmit,
          onSubmit,
          field: ROLETYPEFIELD,
          setInitialValues,
          initialValues,
          handleEdit,
          handleEditClose,
          isEdit,
          setIsEdit,
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
                <CardTitle>Role Types</CardTitle>
              </div>
              <div className="flex items-center justify-between">
                <SearchDebounce />
                <div className="flex gap-2">
                  <Button onClick={handleOpen}>
                    <Plus />
                    Add
                  </Button>
                  <Dialog open={open} onOpenChange={handleClose}>
                    <DialogContent className="sm:max-w-xl max-h-max">
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
                <div className="text-center text-gray-500">No Data found</div>
              ) : (
                <RoleTypeTable />
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
          />
        </div>
      </CommonContext.Provider>
    </div>
  );
};

export default RoleType;
