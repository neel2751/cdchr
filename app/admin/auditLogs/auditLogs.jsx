"use client";
import SearchDebounce from "@/components/search/searchDebounce";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import Pagination from "@/lib/pagination";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import {
  getAuditLogModules,
  getAuditLogs,
} from "@/server/auditServer/auditLog";
import AuditLogTable from "./auditLogTable";

const AuditLogs = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;
  const [module, setModule] = useState("");

  const queryKey = ["auditLogs", { query, currentPage, pagePerData, module }];

  const { data: moduleOptions = [] } = useFetchSelectQuery({
    queryKey: ["auditLogModules"],
    fetchFn: getAuditLogModules,
  });

  const {
    data,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
      module,
    },
    queryKey,
    fetchFn: getAuditLogs,
  });

  const { newData: result = [], totalCount = 0 } = data || {};

  return (
    <div className="p-4">
      <CommonContext.Provider
        value={{
          result,
          currentPage,
          pagePerData,
          totalCount,
        }}
      >
        <Card>
          <CardHeader>
            <div className="space-y-1 mb-4">
              <CardTitle>Audit Logs</CardTitle>
              <CardDescription>
                Read-only history of admin and super admin actions.
              </CardDescription>
            </div>
            <div className="flex items-center justify-between gap-2">
              <SearchDebounce placeholder="Search by user, action, module..." />
              <SelectFilter
                value={module}
                frameworks={[{ label: "All Modules", value: "" }, ...moduleOptions]}
                placeholder={module === "" ? "All Modules" : module}
                onChange={(e) => setModule(e)}
                noData="No modules found"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-20 w-full flex justify-center items-center">
                <Loader2 className="size-10 animate-spin text-neutral-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-gray-500">
                Something went wrong
              </div>
            ) : result.length <= 0 ? (
              <div className="text-center text-gray-500">No logs found</div>
            ) : (
              <>
                <AuditLogTable />
                {totalCount > 10 && (
                  <div className="pt-4 mt-2 border-t">
                    <Pagination />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </CommonContext.Provider>
    </div>
  );
};

export default AuditLogs;
