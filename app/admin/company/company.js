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
import { COMPANYFIELD } from "@/data/fields/fields";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
import { Plus } from "lucide-react";
import { useState } from "react";
import EmployeeForm from "../officeEmployee/employeeForm";
import {
  companyDelete,
  companyStatus,
  getCompanies,
  handleCompany,
} from "@/server/companyServer/companyServer";
import CompanyTable from "./companyTable";
import Alert from "@/components/alert/alert";

const Company = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;
  const [initialValues, setInitialValues] = useState({});
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [alert, setAlert] = useState({});
  const queryKey = ["companies", { query, currentPage, pagePerData }];

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
    fetchFn: getCompanies,
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

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) => await handleCompany(data, initialValues._id),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `Company ${initialValues._id ? "Updated" : "Created"} successfully`,
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
        ? await companyDelete(alert)
        : await companyStatus(alert),
    invalidateKey: queryKey,
    onSuccessMessage: (response) =>
      `${
        alert.type === "Delete" ? "Company Delete" : "Status Update"
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
          isPending,
          onSubmit,
          field: COMPANYFIELD,
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
                <CardTitle>Company List</CardTitle>
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
                        <DialogTitle>Add Compnay</DialogTitle>
                        <DialogDescription>
                          Please fill the form to add new Company
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
                <CompanyTable />
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
        {/* <NewDesignCompany /> */}
      </CommonContext.Provider>
    </div>
  );
};

export default Company;

export const NewDesignCompany = () => {
  return (
    <section className="relative grid w-screen overflow-hidden py-32">
      <div className="container relative z-10 h-full grid-cols-1 items-center justify-center gap-6">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="bg-muted-foreground/5 text-muted-foreground mb-10 flex items-center justify-center gap-3 rounded-full p-1 pr-4 text-sm font-medium tracking-tight">
            <div className="bg-muted-foreground/10 flex items-center gap-3 rounded-full px-4 py-1.5">
              <span className="inline-block size-2 rounded-full bg-blue-500"></span>
              <span>We're Hiring</span>
            </div>
            <div className="flex items-center gap-2">
              Join Our Team{" "}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-arrow-right size-4"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </div>
          </div>
          <h1 className="max-w-2xl text-5xl font-semibold tracking-tighter lg:text-6xl">
            Elevate Your Next Project With,
            <div className="relative w-fit inline-block">
              <span>Production-Ready</span>
              <div className="pointer-events-none absolute inset-0 z-0">
                <div className="absolute inset-0 border border-neutral-800 dark:border-neutral-200"></div>
                <div className="pointer-events-none absolute">
                  <svg
                    stroke="currentColor"
                    fill="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 16 16"
                    height="1em"
                    width="1em"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-blue-500"
                  >
                    <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"></path>
                  </svg>
                </div>
              </div>
            </div>
            Shadcnblocks
          </h1>
          <p className="text-muted-foreground mt-10 max-w-lg">
            Lorem, ipsum dolor sit amet consectetur adipisicing elit. Officiis
            atque perferendis fugit molestiae quae ad molestias eveniet alias
          </p>
          <div className="mt-10 flex w-full flex-col items-center justify-center gap-2">
            <button
              data-slot="button"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg:not([class*='size-'])]:size-4 shrink-0 [&amp;_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary hover:bg-primary/90 h-9 has-[&gt;svg]:px-3 text-background rounded-2xl px-6 py-6 shadow-[0px_1px_3px_#0000001a,inset_0px_2px_0px_#ffffff40] md:rounded-3xl md:px-7 md:py-7 md:text-base"
            >
              <p className="text-background mr-1 text-xl md:mr-3 md:text-2xl">
                
              </p>
              Download for Mac
            </button>
            <button
              data-slot="button"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg:not([class*='size-'])]:size-4 shrink-0 [&amp;_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive underline-offset-4 hover:underline h-9 px-4 py-2 has-[&gt;svg]:px-3 text-muted-foreground text-sm"
            >
              Download for Windows
            </button>
          </div>
        </div>
        <div className="rounded-4xl relative mt-10 flex h-[80vh] w-full items-center justify-center overflow-hidden border">
          <img
            src="/images/block/guri3/img7.jpeg"
            alt="hero"
            className="size-full object-cover"
          />
        </div>
      </div>
      <div className="absolute inset-0 flex h-full w-full items-center justify-between">
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
        <div className="to-muted/50 h-full w-10 bg-gradient-to-l from-transparent"></div>
      </div>
    </section>
  );
};
