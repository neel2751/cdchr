import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

import { Shield, Target, Cloud, BarChart3 } from "lucide-react";
import {
  getDeviceComplianceOverview,
  getEmployeeSubmissionProgress,
  getNetworkConnectivityMonitoring,
  getSecurityHygieneSummary,
  workApplications,
} from "@/server/deviceServer/deviceServer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

const ProjectDashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    submissions: null,
    compliance: null,
    security: null,
    network: null,
    applications: [],
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [
        submissionsResult,
        complianceResult,
        securityResult,
        networkResult,
        applicationsResult,
      ] = await Promise.all([
        getEmployeeSubmissionProgress(),
        getDeviceComplianceOverview(),
        getSecurityHygieneSummary(),
        getNetworkConnectivityMonitoring(),
        workApplications(),
      ]);

      setDashboardData({
        submissions: submissionsResult.success ? submissionsResult.data : null,
        compliance: complianceResult.success ? complianceResult.data : null,
        security: securityResult.success ? securityResult.data : null,
        network: networkResult?.success ? networkResult?.data : null,
        applications: applicationsResult?.success
          ? applicationsResult?.data
          : null,
      });
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const filename =
      "dashboard-report-" + new Date().toISOString().split("T")[0] + ".csv";

    console.log("Exporting report:", filename);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-400 rounded-full flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-800" />
            </div>

            <div>
              <h1 className="text-sm text-gray-600">
                Device Management Dashboard
              </h1>

              <h2 className="text-xl font-semibold text-gray-900">
                Security & Compliance Overview
              </h2>
            </div>
          </div>

          {/* <Button variant="outline" size="sm" onClick={handleExport}>
            Export Report
          </Button> */}
        </div>
        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Employee Submission Progress */}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-600">
                  Employee Submissions
                </CardTitle>

                <Badge
                  className={
                    dashboardData?.submissions?.completionRate >= 80
                      ? "bg-green-100 text-green-800"
                      : "bg-orange-100 text-orange-800"
                  }
                >
                  {dashboardData.submissions?.completionRate}% Complete
                </Badge>
              </div>
            </CardHeader>

            <div className="p-6 pt-0">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-16">
                    <svg
                      className="w-16 h-16 transform -rotate-90"
                      viewBox="0 0 36 36"
                    >
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#e5e7eb"
                        strokeWidth="2"
                      />

                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeDasharray={`${
                          dashboardData.submissions?.completionRate || 0
                        }, 100`}
                      />
                    </svg>

                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xl font-bold text-gray-900">
                        {dashboardData.submissions?.completionRate || 0}%
                      </span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="text-sm text-gray-600">
                      {dashboardData.submissions?.submissions || 0} of{" "}
                      {dashboardData.submissions?.totalEmployees || 0} employees
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Device Compliance */}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-600">
                  Device Compliance
                </CardTitle>

                <Badge
                  className={
                    dashboardData.compliance?.encryption >= 80
                      ? "bg-green-100 text-green-800"
                      : "bg-orange-100 text-orange-800"
                  }
                >
                  {dashboardData.compliance?.encryption || 0}% Encrypted
                </Badge>
              </div>
            </CardHeader>

            <div className="p-6 pt-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Encryption</span>

                  <Progress
                    value={dashboardData.compliance?.encryption}
                    className="w-20 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Antivirus</span>

                  <Progress
                    value={dashboardData.compliance?.antivirus}
                    className="w-20 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Firewall</span>

                  <Progress
                    value={dashboardData.compliance?.firewall}
                    className="w-20 h-2"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Security Hygiene */}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-600">
                  Security Hygiene
                </CardTitle>

                <Badge
                  className={
                    dashboardData.security?.screenLock >= 80
                      ? "bg-green-100 text-green-800"
                      : "bg-orange-100 text-orange-800"
                  }
                >
                  {dashboardData.security?.screenLock || 0}% Protected
                </Badge>
              </div>
            </CardHeader>

            <div className="p-6 pt-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Screen Lock</span>

                  <Progress
                    value={dashboardData.security?.screenLock}
                    className="w-20 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">OS Updates</span>

                  <Progress
                    value={dashboardData.security?.osUpdates}
                    className="w-20 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Remote Wipe</span>

                  <Progress
                    value={dashboardData.security?.remoteWipe}
                    className="w-20 h-2"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Network Security */}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-600">
                  Network Security
                </CardTitle>

                <Badge
                  className={
                    dashboardData.network?.vpnConfigured >= 80
                      ? "bg-green-100 text-green-800"
                      : "bg-orange-100 text-orange-800"
                  }
                >
                  {dashboardData.network?.vpnConfigured || 0}% VPN Usage
                </Badge>
              </div>
            </CardHeader>

            <div className="p-6 pt-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">VPN Config</span>

                  <Progress
                    value={dashboardData.network?.vpnConfigured}
                    className="w-20 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Public WiFi Risk</span>

                  <Progress
                    value={dashboardData.network?.publicWifiRisk}
                    className="w-20 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Local Data </span>

                  <Progress
                    value={dashboardData.network?.localDataStorage}
                    className="w-20 h-2"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Offline Email</span>

                  <Progress
                    value={dashboardData.network?.emailOfflineAccess}
                    className="w-20 h-2"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Additional Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* ISO Compliance */}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                ISO Compliance Status
              </CardTitle>
            </CardHeader>

            <div className="p-6 pt-0">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>

                  <div className="flex-1">
                    <p className="text-sm font-medium">Compliant</p>

                    <p className="text-xs text-gray-500">
                      {dashboardData.compliance?.isoCompliance.compliant || 0}{" "}
                      devices
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>

                  <div className="flex-1">
                    <p className="text-sm font-medium">Pending Review</p>

                    <p className="text-xs text-gray-500">
                      {dashboardData.compliance?.isoCompliance.pending || 0}{" "}
                      devices
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>

                  <div className="flex-1">
                    <p className="text-sm font-medium">Non-Compliant</p>

                    <p className="text-xs text-gray-500">
                      {dashboardData.compliance?.isoCompliance.nonCompliant ||
                        0}{" "}
                      devices
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="w-5 h-5" />
                Cloud Services Usage
              </CardTitle>
            </CardHeader>

            <div className="p-6 pt-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">OneDrive</span>

                  <Progress
                    value={dashboardData.cloudServices?.oneDrive}
                    className="w-24 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">SharePoint</span>

                  <Progress
                    value={dashboardData.cloudServices?.sharePoint}
                    className="w-24 h-2"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Teams</span>

                  <Progress
                    value={dashboardData.cloudServices?.teams}
                    className="w-24 h-2"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Cloud Services */}

          <Card className="w-full max-w-7xl mx-auto bg-white col-span-2">
            <CardHeader className="pb-4">
              <div className="flex items-start gap-3">
                <BarChart3 className="w-6 h-6 text-gray-600 mt-1 flex-shrink-0" />

                <div className="flex-1">
                  <CardTitle className="text-lg font-medium text-gray-900 leading-tight">
                    Which application do primarily used in our company?
                  </CardTitle>

                  <p className="text-sm text-gray-500 mt-1">
                    Multiple choice •{" "}
                    {dashboardData.submissions?.submissions || 0} responses
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <ScrollArea className={"h-72"}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>App Name</TableHead>
                      <TableHead>User Count</TableHead>
                      <TableHead>Total Install</TableHead>
                      <TableHead>Percantage</TableHead>
                      <TableHead>Usage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardData?.applications?.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className={"capitalize"}>
                          {item?.appName}
                        </TableCell>
                        <TableCell>{item?.userCount || 0}</TableCell>
                        <TableCell>{item?.totalInstalls || 0}</TableCell>
                        <TableCell>
                          {Math.round(item?.installPercentage) || 0} %
                        </TableCell>
                        <TableCell>
                          <Progress value={item?.installPercentage} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProjectDashboard;
