// /app/admin/leads/page.jsx
"use client";
import { useState } from "react";
import { Search, QrCode, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import LeadDetailDrawer from "./leadDetailDrawer";
import { getLeadsByAgent, updateLeadStatus } from "@/server/leadServer";
import PerformanceDashboard from "./performanceDashboard";
import MarketingExport from "./marketingExport";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";

export default function LeadInbox() {
  const [selectedLead, setSelectedLead] = useState(null);

  const queryKey = ["leadsByAgent"];

  const { data } = useFetchQuery({
    fetchFn: getLeadsByAgent,
    queryKey,
  });

  const { newData: leads = [] } = data || {};

  const getStatusColor = (status) => {
    const colors = {
      new: "bg-blue-100 text-blue-700 border-blue-200",
      contacted: "bg-yellow-100 text-yellow-700 border-yellow-200",
      qualified: "bg-green-100 text-green-700 border-green-200",
      lost: "bg-red-100 text-red-700 border-red-200",
    };
    return colors[status] || "bg-gray-100";
  };

  const { mutate: updateStatus, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await updateLeadStatus({ leadId: data.leadId, newStatus: data.value }),
    invalidateKey: queryKey,
    onSuccessMessage: (message) =>
      message || "Lead status updated successfully!",
    onClose: () => setSelectedLead(null),
  });

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            Lead Inbox
          </h1>
          <p className="text-gray-500">
            Manage incoming scans and visitor data
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              className="pl-10 pr-4 py-2 border rounded-xl text-sm w-64 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Search by name or email..."
            />
          </div>
        </div>
      </div>

      <PerformanceDashboard />

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Recent Leads</CardTitle>
            <CardDescription>
              Latest QR code scans and form submissions
            </CardDescription>
          </div>
          <MarketingExport />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="py-2">ID </TableHead>
                <TableHead className="px-6 py-2">Lead Info</TableHead>
                <TableHead className="px-6 py-2">Source Campaign</TableHead>
                <TableHead className="px-6 py-2">Status</TableHead>
                <TableHead className="px-6 py-2">Update Status</TableHead>
                <TableHead className="px-6 py-2">Created At</TableHead>
                <TableHead className="px-6 py-2">Updated At</TableHead>
                <TableHead className="px-6 py-2 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y">
              {leads.map((lead) => (
                <TableRow
                  key={lead._id}
                  className="hover:bg-indigo-50/30 transition-colors group cursor-pointer"
                  onClick={() => setSelectedLead(lead)}
                >
                  <TableCell>
                    <div className="text-sm text-gray-500">
                      {lead._id.slice(-6)}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2">
                    <div className="font-bold text-gray-800">
                      {lead.data.fullName ||
                        lead.data.visitorName ||
                        "Anonymous"}
                    </div>
                    <div className="text-xs text-gray-400">
                      {lead.data.email ||
                        lead.data.visitorEmail ||
                        lead.data.emailAddress ||
                        "No email"}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <QrCode className="w-4 h-4 text-indigo-400" />
                      <span className="text-sm text-gray-600 font-medium">
                        {lead.qrCodeId?.title || "Direct Scan"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2">
                    <Badge className={getStatusColor(lead.status)}>
                      {lead.status.charAt(0).toUpperCase() +
                        lead.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-2 inline-flex items-start gap-2">
                    <UpdateStatusSelect
                      leadId={lead._id}
                      currentStatus={lead.status}
                      onUpdate={updateStatus}
                      isPending={isPending}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-gray-500 italic">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </TableCell>

                  <TableCell className="px-4 py-2">
                    {lead.updatedAt
                      ? new Date(lead.updatedAt).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <button className="p-2 hover:bg-white rounded-full border border-transparent hover:border-gray-200 shadow-sm transition-all">
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-indigo-500" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Full Detail Slide-over */}
      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </div>
  );
}

function UpdateStatusSelect({ leadId, currentStatus, onUpdate, isPending }) {
  const statuses = ["new", "contacted", "qualified", "lost"];
  return (
    <Select
      disabled={isPending}
      value={currentStatus}
      onValueChange={(value) => onUpdate({ leadId, value })}
      className="border rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500"
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Update Status" />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status} value={status}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
