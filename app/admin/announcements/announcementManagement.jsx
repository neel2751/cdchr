"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";

import SearchDebounce from "@/components/search/searchDebounce";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
import { getAnnouncements } from "@/server/announcementServer/announcementServer";
import {
  getAllProjects,
  getSelectRoleType,
} from "@/server/selectServer/selectServer";
import AnnouncementTable from "./announcementTable";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS } from "./constants";

const AnnouncementManagement = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;

  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");

  // Departments are resolved once here rather than per row: the table only ever
  // needs their names, and the audience is stored as ids.
  const { data: departments = [] } = useFetchSelectQuery({
    queryKey: ["roleTypeSelect"],
    fetchFn: getSelectRoleType,
  });
  const { data: sites = [] } = useFetchSelectQuery({
    queryKey: ["projectSiteSelect"],
    fetchFn: getAllProjects,
  });
  const departmentNames = Object.fromEntries(
    departments.map((d) => [String(d.value), d.label])
  );
  const siteNames = Object.fromEntries(
    sites.map((s) => [String(s.value), s.label])
  );

  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
      status,
      category,
      priority,
    },
    queryKey: [
      "announcements",
      { query, currentPage, pagePerData, status, category, priority },
    ],
    fetchFn: getAnnouncements,
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
          departmentNames,
          siteNames,
        }}
      >
        <Card>
          <CardHeader>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Announcements</CardTitle>
                <CardDescription>
                  Company-wide messages. Draft one, choose who it goes to, and
                  see who has read it.
                </CardDescription>
              </div>
              <Button asChild>
                <Link href="/admin/announcements/new">
                  <Plus className="mr-1 size-4" />
                  New announcement
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SearchDebounce placeholder="Search by title..." />
              <div className="flex flex-wrap items-center gap-2">
                <SelectFilter
                  label="Status"
                  value={status}
                  frameworks={STATUS_OPTIONS}
                  placeholder="All statuses"
                  onChange={setStatus}
                  noData="No statuses"
                />
                <SelectFilter
                  label="Category"
                  value={category}
                  frameworks={[
                    { label: "All categories", value: "" },
                    ...CATEGORY_OPTIONS,
                  ]}
                  placeholder="All categories"
                  onChange={setCategory}
                  noData="No categories"
                />
                <SelectFilter
                  label="Priority"
                  value={priority}
                  frameworks={[
                    { label: "All priorities", value: "" },
                    ...PRIORITY_OPTIONS,
                  ]}
                  placeholder="All priorities"
                  onChange={setPriority}
                  noData="No priorities"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-20 w-full items-center justify-center">
                <Loader2 className="size-10 animate-spin text-neutral-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-gray-500">
                Something went wrong
              </div>
            ) : result.length <= 0 ? (
              <div className="py-8 text-center text-gray-500">
                No announcements yet.
              </div>
            ) : (
              <>
                <AnnouncementTable />
                {totalCount > 10 && (
                  <div className="mt-2 border-t pt-4">
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

export default AnnouncementManagement;
