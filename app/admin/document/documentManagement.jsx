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
import {
  Archive,
  CheckCircle2,
  Files,
  HardDrive,
  Layers,
  Loader2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import Pagination from "@/lib/pagination";
import { formatBytes } from "@/lib/utils";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import {
  getMediaFiles,
  getMediaStats,
  getMediaTypes,
} from "@/server/document/documentManagementServer";
import DocumentTable from "./documentTable";

const STATUS_OPTIONS = [
  { label: "All Status", value: "" },
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "Deleted", value: "deleted" },
];

const SOURCE_OPTIONS = [
  { label: "All Sources", value: "" },
  { label: "Media Library", value: "media" },
  { label: "Employee Documents", value: "document" },
  { label: "Expense Receipts", value: "expense" },
];

function StatCard({ icon: Icon, label, value, hint, className }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2 ${className || "bg-neutral-100 text-neutral-600"}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
          {hint ? <p className="text-xs text-neutral-400">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

const DocumentManagement = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const query = searchParams?.query;
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [source, setSource] = useState("");

  const { data: stats } = useFetchSelectQuery({
    queryKey: ["mediaStats"],
    fetchFn: getMediaStats,
  });

  const { data: typeOptions = [] } = useFetchSelectQuery({
    queryKey: ["mediaTypes"],
    fetchFn: getMediaTypes,
  });

  const queryKey = [
    "mediaFiles",
    { query, currentPage, pagePerData, status, type, source },
  ];

  const { data, isLoading, isError } = useFetchQuery({
    params: {
      query,
      page: currentPage,
      pageSize: pagePerData,
      status,
      type,
      source,
    },
    queryKey,
    fetchFn: getMediaFiles,
  });

  const { newData: result = [], totalCount = 0 } = data || {};
  const byStatus = stats?.byStatus || { active: 0, archived: 0, deleted: 0 };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          icon={Files}
          label="Total Files"
          value={stats?.totalFiles ?? "—"}
        />
        <StatCard
          icon={HardDrive}
          label="Total Storage"
          value={formatBytes(stats?.totalBytes || 0)}
        />
        <StatCard
          icon={Layers}
          label="Document Types"
          value={stats?.typeCount ?? "—"}
        />
        <StatCard
          icon={CheckCircle2}
          label="Active"
          value={byStatus.active}
          className="bg-green-100 text-green-600"
        />
        <StatCard
          icon={Archive}
          label="Archived"
          value={byStatus.archived}
          className="bg-amber-100 text-amber-600"
        />
        <StatCard
          icon={Trash2}
          label="Deleted"
          value={byStatus.deleted}
          className="bg-red-100 text-red-600"
        />
      </div>

      <CommonContext.Provider
        value={{ result, currentPage, pagePerData, totalCount }}
      >
        <Card>
          <CardHeader>
            <div className="space-y-1 mb-4">
              <CardTitle>Media Management</CardTitle>
              <CardDescription>
                Every file uploaded across the platform — media library,
                employee documents and expense receipts.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SearchDebounce placeholder="Search by name, type..." />
              <div className="flex flex-wrap items-center gap-2">
                <SelectFilter
                  value={status}
                  frameworks={STATUS_OPTIONS}
                  placeholder={status === "" ? "All Status" : status}
                  onChange={(e) => setStatus(e)}
                  noData="No status"
                />
                <SelectFilter
                  value={source}
                  frameworks={SOURCE_OPTIONS}
                  placeholder={source === "" ? "All Sources" : source}
                  onChange={(e) => setSource(e)}
                  noData="No sources"
                />
                <SelectFilter
                  value={type}
                  frameworks={[{ label: "All Types", value: "" }, ...typeOptions]}
                  placeholder={type === "" ? "All Types" : type}
                  onChange={(e) => setType(e)}
                  noData="No types found"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-20 w-full flex justify-center items-center">
                <Loader2 className="size-10 animate-spin text-neutral-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-gray-500">Something went wrong</div>
            ) : result.length <= 0 ? (
              <div className="text-center text-gray-500">No files found</div>
            ) : (
              <>
                <DocumentTable />
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

export default DocumentManagement;
