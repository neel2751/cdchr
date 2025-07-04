"use client";
import {
  searchSiteProjectByKeywordNew,
  siteProjectDelete,
  siteProjectStatus,
  updateSiteProjectById,
} from "@/server/siteProjectServer/siteProjectServer";
import React, { useState } from "react";
import SiteTable from "./siteTable";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import EmployeeForm from "../officeEmployee/employeeForm";
import { SITEFIELD } from "@/data/fields/fields";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";
import Alert from "@/components/alert/alert";
import { SelectFilter } from "@/components/selectFilter/selectFilter";

const SiteProject = ({ searchParams }) => {
  const query = searchParams.query;
  const currentPage = parseInt(searchParams.page || "1");
  const pagePerData = parseInt(searchParams.pageSize || "10");
  const [initialValues, setInitialValues] = useState({});
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [alert, setAlert] = useState({});
  const [filter, setFilter] = useState({
    type: "",
  });

  const queryKey = ["siteProject", { query, currentPage, pagePerData, filter }];
  const {
    data: queryResult,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      query: query,
      page: currentPage,
      pageSize: pagePerData,
      filter: filter,
    },
    queryKey,
    fetchFn: searchSiteProjectByKeywordNew,
  });
  const { newData: siteProjectData = [], totalCount = 0 } = queryResult || {};
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
      await updateSiteProjectById(data, initialValues._id),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `Site ${initialValues._id ? "Updated" : "Create"} successfully`,
    onClose: initialValues._id ? handleEditClose : handleClose,
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
  const [{ options }] = SITEFIELD.filter((it) => {
    if (it.name === "siteType") {
      return it.options;
    }
  });

  const { mutate: handleStatus, isPending: isStatusPending } =
    useSubmitMutation({
      mutationFn: async () =>
        alert?.type === "Delete"
          ? await siteProjectDelete(alert)
          : await siteProjectStatus(alert),
      invalidateKey: queryKey,
      onSuccessMessage: (response) =>
        `${
          alert.type === "Delete" ? "Site Delete" : "Status Update"
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
          siteProjectData,
          isPending,
          onSubmit,
          field: SITEFIELD,
          initialValues,
          handleEdit,
          handleEditClose,
          isEdit,
          setIsEdit,
          handleAlert,
        }}
      >
        <div>
          <Card>
            <CardHeader>
              <div className="mb-4">
                <CardTitle> Site Project</CardTitle>
              </div>
              <div className="flex items-center justify-between">
                <SearchDebounce />
                <div className="flex gap-2">
                  <SelectFilter
                    value={filter.type}
                    frameworks={[{ label: "All", value: "" }, ...options]}
                    placeholder={filter.type === "" ? "All" : "Select Type"}
                    onChange={(e) => setFilter({ ...filter, type: e })}
                    noData="No Data found"
                  />
                  <Button onClick={handleOpen}>
                    <Plus />
                    Add
                  </Button>
                  <Dialog open={open} onOpenChange={handleClose}>
                    <DialogContent className="sm:max-w-2xl max-h-max">
                      <DialogHeader>
                        <DialogTitle>Add New Site</DialogTitle>
                        <DialogDescription>
                          Please fill the form to add new site project
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
              {siteProjectData.length <= 0 ? (
                <div className="text-center text-gray-500">
                  No data available
                </div>
              ) : (
                <SiteTable />
              )}
              {totalCount > 10 && <PaginationWithLinks />}
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
        </div>
      </CommonContext.Provider>
    </div>
  );
};

export default SiteProject;
