"use client";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Search,
  Eye,
  Download,
  Shield,
  Calendar,
  User,
  Building,
} from "lucide-react";
import { DataEncryption } from "@/data/device-data-storage";
import { format } from "date-fns";
import { useFetchQuery } from "@/hooks/use-query";
import {
  getCommonApplicationsAnalytics,
  GetDevice,
} from "@/server/deviceServer/deviceServer";
import { toast } from "sonner";
import { usePasswordConfirm } from "@/context/usePasswordContext";

import { DeviceInformationForm } from "@/components/deviceInfo/deviceInfo";
import ProjectDashboard from "./countEmployee";

export function DeviceSubmissionsDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const { data } = useFetchQuery({
    fetchFn: GetDevice,
    queryKey: ["deviceInfo"],
  });

  const { data: ana } = useFetchQuery({
    fetchFn: getCommonApplicationsAnalytics,
    queryKey: ["test"],
  });

  const { newData } = ana || {};

  const { newData: submissions } = data || {};

  const confirm = usePasswordConfirm();

  const filteredSubmissions = submissions?.filter(
    (submission) =>
      submission.submittedBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
      submission.submissionId
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      submission.department?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleViewDetails = async (submission) => {
    const confirmed = await confirm();
    if (!confirmed) {
      toast.error("Access denied. Please confirm your password.");
      return;
    }

    const decryptedSubmission = { ...submission };
    decryptedSubmission.devices = submission.devices.map((device) => ({
      ...device,
      serialNumber: device.serialNumber
        ? DataEncryption.decrypt(device.serialNumber, submission.encryptionKey)
        : undefined,
    }));
    setSelectedSubmission(decryptedSubmission);
    setShowDetails(true);
  };

  const handleExportData = (submission) => {
    const data = submissions.find(
      (item) => item?.submissionId === submission?.submissionId
    );
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `device-submission-${submission.submissionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <ProjectDashboard />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{submissions?.length}</div>
            <p className="text-sm text-muted-foreground">Total Submissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {submissions?.reduce((acc, sub) => acc + sub.devices.length, 0)}
            </div>
            <p className="text-sm text-muted-foreground">Total Devices</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {submissions?.reduce(
                (acc, sub) =>
                  acc + sub.devices.filter((d) => d.isCompanyAsset).length,
                0
              )}
            </div>
            <p className="text-sm text-muted-foreground">Company Assets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">100%</div>
            <p className="text-sm text-muted-foreground">Privacy Compliant</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email, submission ID, or department..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
                name="search"
                autoComplete="off"
                type="text"
                autofill="off"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submissions Table */}
      <Card>
        <CardHeader className={"flex justify-between items-center"}>
          <div>
            <CardTitle>Device Submissions</CardTitle>
            <CardDescription>
              All device information submissions with privacy protection
              indicators.
            </CardDescription>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Add Device</Button>
            </DialogTrigger>
            <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-md md:max-w-lg lg:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Add New Device Submission</DialogTitle>
                <DialogDescription>
                  Add device information and ensure compliance with privacy
                  policies. Please fill out all required fields.
                </DialogDescription>
              </DialogHeader>
              <DeviceInformationForm />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submission ID</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Devices</TableHead>
                  <TableHead>Submission Date</TableHead>
                  <TableHead>Privacy Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSubmissions?.map((submission) => (
                  <TableRow key={submission.submissionId}>
                    <TableCell className="font-mono text-sm">
                      {submission.submissionId}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {submission.submittedBy}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        {submission.department || "Not specified"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {submission.devices.length} devices
                        </Badge>
                        <Badge variant="secondary">
                          {
                            submission.devices.filter((d) => d.isCompanyAsset)
                              .length
                          }{" "}
                          company
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {format(
                          new Date(submission?.submissionDate),
                          "MMM dd, yyyy HH:mm"
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-green-600" />
                        <Badge
                          variant="default"
                          className="bg-green-100 text-green-800"
                        >
                          Compliant
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewDetails(submission)}
                        >
                          <Eye />
                        </Button>
                        {/* <Button variant="ghost" size="icon">
                          <Edit />
                        </Button> */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            toast.warning("We are Working on Download Feature")
                          }
                          // onClick={() => handleExportData(submission)}
                        >
                          <Download />
                        </Button>
                        {/* <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            toast.error("We are Working on Delete Feature")
                          }
                        >
                          <Trash2 />
                        </Button> */}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {/* Submission Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Submission Details</DialogTitle>
            <DialogDescription>
              Complete device information and privacy compliance details.
            </DialogDescription>
          </DialogHeader>
          {selectedSubmission && (
            <SubmissionDetailsView submission={selectedSubmission} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubmissionDetailsView({ submission }) {
  return (
    <div className="space-y-6">
      {/* Submission Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Submission Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Submission ID</Label>
              <p className="font-mono text-sm">{submission.submissionId}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Submitted By</Label>
              <p className="text-sm">{submission.submittedBy}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Employee Name</Label>
              <p className="text-sm">
                {submission.employeeName || "Not provided"}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Department</Label>
              <p className="text-sm">
                {submission.department || "Not specified"}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Submission Date</Label>
              <p className="text-sm">
                {format(new Date(submission.submissionDate), "PPP pp")}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">
                Privacy Policy Version
              </Label>
              <p className="text-sm">
                {submission.privacyPolicyVersion || "CDC-V1"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Privacy Compliance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-600" />
            Privacy Compliance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Badge>Accepted</Badge>
              <span className="text-sm">Privacy Policy</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge>Consented</Badge>
              <span className="text-sm">Data Retention</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Device Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Device Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {submission.devices.map((device, index) => (
              <div key={device.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium">Device {index + 1}</h4>
                  <div className="flex gap-2">
                    <Badge
                      variant={device.isCompanyAsset ? "default" : "secondary"}
                    >
                      {device.isCompanyAsset
                        ? "Company Asset"
                        : "Personal Device"}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label className="font-medium">Device Name</Label>
                    <p>{device.deviceName}</p>
                  </div>
                  <div>
                    <Label className="font-medium">Device Type</Label>
                    <p className="capitalize">{device.deviceType}</p>
                  </div>
                  {device.deviceVersion && (
                    <div>
                      <Label className="font-medium">Version/Model</Label>
                      <p>{device.deviceVersion}</p>
                    </div>
                  )}
                  {device.operatingSystem && (
                    <div>
                      <Label className="font-medium">Operating System</Label>
                      <p>{device.operatingSystem}</p>
                    </div>
                  )}
                  {device.serialNumber && (
                    <div className="col-span-2">
                      <Label className="font-medium">Serial Number</Label>
                      <p className="font-mono text-xs bg-gray-100 p-2 rounded">
                        {device.serialNumber} (Decrypted for authorized view)
                      </p>
                    </div>
                  )}
                  {device.notes && (
                    <div className="col-span-2">
                      <Label className="font-medium">Notes</Label>
                      <p>{device.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Label({ className, children, ...props }) {
  return (
    <label className={`text-sm font-medium ${className}`} {...props}>
      {children}
    </label>
  );
}
