import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { fetchCommonLeave } from "@/server/leaveServer/leaveServer";

import { EditIcon, EyeIcon, ScanSearchIcon } from "lucide-react";
import LeaveEntitlementTable from "./leave-tabel";
import SearchDebounce from "@/components/search/searchDebounce";
import { useCommonContext } from "@/context/commonContext";
import { PaginationWithLinks } from "@/components/pagination/pagination";

const EmployeeLeaveEntitlement = () => {
  const { searchParams } = useCommonContext();
  const currentPage = parseInt(searchParams.page || "1");
  const pagePerData = parseInt(searchParams.pageSize || "10");
  const query = searchParams.query;

  const queryKey = [
    "leave-entitlement",
    { query, page: currentPage < 0 ? 1 : currentPage, pagePerData },
  ];
  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
    },
    queryKey,
    fetchFn: fetchCommonLeave,
  });

  const { newData, totalCount } = data || {};

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
        <div className="flex justify-between items-center pt-2">
          <SearchDebounce />
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
