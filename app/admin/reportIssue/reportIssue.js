"use client";
import { GlobalForm } from "@/components/form/form";
import SearchDebounce from "@/components/search/searchDebounce";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CommonContext } from "@/context/commonContext";
import { ISSUEREPORTFIELD } from "@/data/fields/fields";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery } from "@/hooks/use-query";
import { generateTicket, getIssueToken } from "@/server/dev/generateTicket";
import { Ticket } from "lucide-react";
import React from "react";
import EmployeeForm from "../officeEmployee/employeeForm";
import ReportIssueTable from "./reportIssueTable";

const ReportIssue = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;
  const [open, setOpen] = React.useState(false);
  const queryKey = ["ticket", { query, currentPage, pagePerData }];

  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
    },
    queryKey,
    fetchFn: getIssueToken,
  });

  const { newData: result = [], totalCount = 0 } = data || {};

  const { mutate: onSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) => generateTicket(data),
    invalidateKey: queryKey,
    onSuccessMessage: (response) => response,
    onClose: () => setOpen(false),
  });

  return (
    <div className="p-4">
      <CommonContext.Provider
        value={{
          result,
          totalCount,
          field: ISSUEREPORTFIELD,
          isPending,
          onSubmit,
        }}
      >
        <Card>
          <CardHeader>
            <div className="space-y-1 mb-4">
              <CardTitle>Generate a Ticket</CardTitle>
              <CardDescription>
                Please fill out the form below to generate a ticket.
              </CardDescription>
            </div>
            <div className=" flex items-center justify-between">
              <SearchDebounce />
              <Dialog open={open} onOpenChange={() => setOpen(!open)}>
                <DialogTrigger asChild>
                  <Button>
                    <Ticket className="size-4" />
                    Create a Ticket
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Generate Ticket</DialogTitle>
                    <DialogDescription>
                      Please fill in the form below to generate a ticket.
                    </DialogDescription>
                  </DialogHeader>
                  <EmployeeForm />
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <ReportIssueTable />
          </CardContent>
        </Card>
      </CommonContext.Provider>
    </div>
  );
};

export default ReportIssue;
