"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { fetchCommonLeave } from "@/server/leaveServer/leaveServer";
import {
  getLeaveYearSyncStatus,
  syncLeaveAllEmployeesForCurrentYear,
} from "@/server/leaveServer/countLeaveServer";

import { EditIcon, EyeIcon, ScanSearchIcon } from "lucide-react";
import LeaveEntitlementTable from "./leave-tabel";
import SearchDebounce from "@/components/search/searchDebounce";
import { useCommonContext } from "@/context/commonContext";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const EmployeeLeaveEntitlement = () => {
  const { searchParams } = useCommonContext();
  const currentPage = parseInt(searchParams.page || "1");
  const pagePerData = parseInt(searchParams.pageSize || "10");
  const query = searchParams.query;

  const queryKey = [
    "leave-entitlement",
    { query, page: currentPage < 0 ? 1 : currentPage, pagePerData },
  ];
  const syncStatusQueryKey = ["leave-entitlement-sync-status"];
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
    },
    queryKey,
    fetchFn: fetchCommonLeave,
  });

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    queryKey: syncStatusQueryKey,
    queryFn: async () => {
      const response = await getLeaveYearSyncStatus();
      const parsed = response?.data ? JSON.parse(response.data) : {};
      return parsed;
    },
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });

  const { mutate: syncAllEmployees, isPending: isSyncingAll } = useMutation({
    mutationFn: async () => syncLeaveAllEmployeesForCurrentYear(),
    onSuccess: (response) => {
      if (!response?.success) {
        toast.error(response?.message || "Failed to sync leaves");
        return;
      }
      toast.success(response?.message || "Leave sync completed");
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: syncStatusQueryKey });
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to sync leaves");
    },
  });

  const { newData, totalCount } = data || {};
  const syncStatus = syncStatusData || {};
  const shouldShowSyncAll = Boolean(syncStatus?.showSyncAllButton);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Employee Leave Entitlement</CardTitle>
        <CardDescription>
          This is a list of all employee leave entitlements.
          {/* See all employee leaves if not already added so that you can add them. */}
        </CardDescription>
        <div className="flex items-center gap-2 text-xs pt-2 text-neutral-700">
          <span className="text-xs font-medium text-neutral-700">Note*:</span>
          {[
            { id: 1, title: "Update the Employee data", icon: EditIcon },
            { id: 2, title: "View Leave Entitlement", icon: EyeIcon },
            { id: 3, title: "Sync Leave", icon: ScanSearchIcon },
          ].map((item) => (
            <span key={item?.id} className="flex gap-2 items-center">
              <span className="border p-1 rounded-md">
                <item.icon className="h-3 w-3" />
              </span>
              <span>{item?.title}</span>
            </span>
          ))}
        </div>
        <div className="flex justify-between items-start pt-2 gap-2">
          <SearchDebounce />
          <div className="flex flex-col items-end gap-1">
            {shouldShowSyncAll && (
              <Button
                onClick={() => syncAllEmployees()}
                disabled={isSyncingAll || syncStatusLoading}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {isSyncingAll
                  ? "Syncing All Employees..."
                  : `Sync Leave All Employees (${syncStatus?.pendingEmployees || 0})`}
              </Button>
            )}

            <p className="text-xs text-neutral-600 text-right">
              Leave Year: {syncStatus?.leaveYear || "-"} | Eligible:{" "}
              {syncStatus?.totalEligibleEmployees || 0} | Synced:{" "}
              {syncStatus?.syncedEmployees || 0} | Pending:{" "}
              {syncStatus?.pendingEmployees || 0}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <LeaveEntitlementTable
          newData={newData}
          isPending={isLoading}
          queryKey={queryKey}
        />
        <div className="mt-4 border-t pt-4">
          {totalCount > 10 && (
            <PaginationWithLinks
              page={currentPage}
              pageSize={pagePerData}
              totalCount={totalCount || 0}
              pageSizeSelectOptions={{
                pageSizeOptions: [10, 20, 30, 40, 50],
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EmployeeLeaveEntitlement;
