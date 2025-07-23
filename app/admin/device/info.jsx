"use client";

import React, { useState } from "react";
import { useFetchQuery } from "@/hooks/use-query";
import { getDevice } from "@/server/deviceServer/deviceServer";
import {
  Monitor,
  Shield,
  HardDrive,
  Wifi,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Clock,
  Building,
  User,
  Mail,
  Lock,
} from "lucide-react";

export default function DeviceInfo() {
  const queryKey = ["getDevicesForEmployee"];
  const { data } = useFetchQuery({
    fetchFn: getDevice,
    queryKey,
  });
  const { newData } = data || {};

  return (
    <div>
      {/* {JSON.stringify(newData, null, 2)} */}
      <DeviceInfoDashboard />
    </div>
  );
}

const DeviceInfoDashboard = ({ data }) => {
  // Sample data that would come from form submissions

  const dashboardData = {
    userInfo: {
      name: "John Doe",

      email: "yourname@cdc.construction",

      department: "IT Department",

      workType: "Office, Work From Home, Site, WFH & Site",

      submissionDate: "2025-07-12",

      submissionId: "CDC-2025-001234",
    },

    devices: [
      {
        id: 1,

        name: "MacBook Pro 16-inch 2023",

        type: "Laptop",

        model: "Model A2485, Gen 10",

        os: "macOS 14.0",

        serialNumber: "****-****-XXXX",

        isCompanyAsset: true,

        location: {
          building: "Main Office",

          floor: "3rd Floor",

          room: "Room 301",

          desk: "Desk A-15",
        },

        security: {
          encryptionStatus: "Enabled",

          riskLevel: "Low",

          antivirusInstalled: true,

          firewallEnabled: true,
        },

        network: {
          domain: "company.local",

          vpnConfigured: true,
        },

        certificationStatus: "Approved",
      },

      {
        id: 2,

        name: "Dell OptiPlex 7090",

        type: "Desktop",

        model: "OptiPlex 7090",

        os: "Windows 11 Pro",

        serialNumber: "****-****-YYYY",

        isCompanyAsset: true,

        location: {
          building: "Branch Office",

          floor: "2nd Floor",

          room: "Room 205",

          desk: "Desk B-08",
        },

        security: {
          encryptionStatus: "Enabled",

          riskLevel: "Low",

          antivirusInstalled: true,

          firewallEnabled: true,
        },

        network: {
          domain: "company.local",

          vpnConfigured: false,
        },

        certificationStatus: "Pending Review",
      },
    ],

    applications: [
      {
        name: "Microsoft Outlook",
        version: "2309",
        category: "Communication",
        license: "Paid",
        installed: true,
        usedForWork: true,
      },

      {
        name: "Microsoft Teams",
        version: "1.6.00",
        category: "Communication",
        license: "Paid",
        installed: true,
        usedForWork: true,
      },

      {
        name: "Microsoft Excel",
        version: "365",
        category: "Productivity",
        license: "Paid",
        installed: true,
        usedForWork: true,
      },

      {
        name: "Microsoft Word",
        version: "365",
        category: "Productivity",
        license: "Paid",
        installed: true,
        usedForWork: true,
      },

      {
        name: "WhatsApp",
        version: "2.23.20",
        category: "Communication",
        license: "Free",
        installed: true,
        usedForWork: false,
      },

      {
        name: "Chrome",
        version: "138.0.0.0",
        category: "Browser",
        license: "Free",
        installed: true,
        usedForWork: true,
      },

      {
        name: "Adobe Photoshop",
        version: "2024",
        category: "Design",
        license: "Paid",
        installed: true,
        usedForWork: true,
      },
    ],

    browsers: [
      { name: "Google Chrome", version: "138.0.0.0", isDefault: true },

      { name: "Mozilla Firefox", version: "120.0.1", isDefault: false },

      { name: "Microsoft Edge", version: "119.0.2151", isDefault: false },
    ],

    securityMetrics: {
      overallRiskScore: 15,

      encryptedDevices: 2,

      totalDevices: 2,

      antivirusCompliance: 100,

      firewallCompliance: 100,

      vpnCompliance: 50,
    },
  };

  const [activeTab, setActiveTab] = useState("overview");

  // Calculate statistics

  const stats = {
    totalDevices: dashboardData.devices.length,

    companyAssets: dashboardData.devices.filter((d) => d.isCompanyAsset).length,

    secureDevices: dashboardData.devices.filter(
      (d) => d.security.riskLevel === "Low"
    ).length,

    approvedDevices: dashboardData.devices.filter(
      (d) => d.certificationStatus === "Approved"
    ).length,

    totalApps: dashboardData.applications.length,

    workApps: dashboardData.applications.filter((a) => a.usedForWork).length,

    paidApps: dashboardData.applications.filter((a) => a.license === "Paid")
      .length,
  };

  const appsByCategory = dashboardData.applications.reduce((acc, app) => {
    acc[app.category] = (acc[app.category] || 0) + 1;

    return acc;
  }, {});

  const devicesByType = dashboardData.devices.reduce((acc, device) => {
    acc[device.type] = (acc[device.type] || 0) + 1;

    return acc;
  }, {});

  const TabButton = ({ id, label, icon: Icon, isActive, onClick }) => (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
        isActive
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      <Icon className="w-4 h-4" />

      {label}
    </button>
  );

  const StatCard = ({ title, value, icon: Icon, color = "blue", subtitle }) => (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>

          <p className={`text-3xl font-bold text-${color}-600`}>{value}</p>

          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>

        <div className={`p-3 bg-${color}-100 rounded-full`}>
          <Icon className={`w-6 h-6 text-${color}-600`} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}

      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
                CDC
              </div>

              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  Device Information Dashboard
                </h1>

                <p className="text-sm text-gray-600">
                  Creative Design & Construction
                </p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm text-gray-600">
                Submission ID:{" "}
                {data?.submissionId || dashboardData.userInfo.submissionId}
              </p>

              <p className="text-sm text-gray-600">
                Date:{" "}
                {data?.submissionDate || dashboardData.userInfo.submissionDate}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* User Information Card */}

        <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-blue-600" />
            </div>

            <div>
              <h2 className="text-xl font-semibold">
                {data?.employeeName || dashboardData?.userInfo?.name}
              </h2>
              <p className="text-gray-600">
                {data?.department || dashboardData?.userInfo?.department}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-gray-500" />

              <span className="text-sm">{data?.email}</span>
            </div>

            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />

              <span className="text-sm text-green-600">
                Verified Submission
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}

        <div className="flex flex-wrap gap-2 mb-8">
          <TabButton
            id="overview"
            label="Overview"
            icon={BarChart3}
            isActive={activeTab === "overview"}
            onClick={setActiveTab}
          />

          <TabButton
            id="devices"
            label="Devices"
            icon={Monitor}
            isActive={activeTab === "devices"}
            onClick={setActiveTab}
          />

          <TabButton
            id="applications"
            label="Applications"
            icon={HardDrive}
            isActive={activeTab === "applications"}
            onClick={setActiveTab}
          />

          <TabButton
            id="security"
            label="Security"
            icon={Shield}
            isActive={activeTab === "security"}
            onClick={setActiveTab}
          />

          <TabButton
            id="network"
            label="Network"
            icon={Wifi}
            isActive={activeTab === "network"}
            onClick={setActiveTab}
          />
        </div>

        {/* Overview Tab */}

        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Stats Cards */}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="Total Devices"
                value={data?.devices?.length || stats.totalDevices}
                icon={Monitor}
                color="blue"
                subtitle="Registered devices"
              />

              <StatCard
                title="Company Assets"
                value={data?.devices?.filter((d) => d.isCompanyAsset).length}
                icon={Building}
                color="green"
                subtitle="Owned by company"
              />

              <StatCard
                title="Security Score"
                value={`${
                  100 - dashboardData.securityMetrics.overallRiskScore
                }%`}
                icon={Shield}
                color="purple"
                subtitle="Overall security rating"
              />

              <StatCard
                title="Applications"
                value={data?.workApplications?.length || stats.totalApps}
                icon={HardDrive}
                color="orange"
                subtitle={`${stats.workApps} used for work`}
              />
            </div>

            {/* Charts */}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Device Types Chart */}

              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-4">Device Types</h3>

                <div className="space-y-3">
                  {Object.entries(devicesByType).map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm font-medium">{type}</span>

                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{
                              width: `${(count / stats.totalDevices) * 100}%`,
                            }}
                          ></div>
                        </div>

                        <span className="text-sm text-gray-600">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Application Categories Chart */}

              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-4">
                  Application Categories
                </h3>

                <div className="space-y-3">
                  {Object.entries(appsByCategory).map(([category, count]) => (
                    <div
                      key={category}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm font-medium">{category}</span>

                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-600 h-2 rounded-full"
                            style={{
                              width: `${(count / stats.totalApps) * 100}%`,
                            }}
                          ></div>
                        </div>

                        <span className="text-sm text-gray-600">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Devices Tab */}

        {activeTab === "devices" && (
          <div className="space-y-6">
            {dashboardData.devices.map((device) => (
              <div
                key={device.id}
                className="bg-white rounded-lg shadow-sm border p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Monitor className="w-8 h-8 text-blue-600" />

                    <div>
                      <h3 className="text-lg font-semibold">{device.name}</h3>

                      <p className="text-sm text-gray-600">
                        {device.type} • {device.model}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {device.certificationStatus === "Approved" ? (
                      <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Approved
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Pending Review
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Device Details</h4>

                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="text-gray-600">OS:</span> {device.os}
                      </p>

                      <p>
                        <span className="text-gray-600">Serial:</span>{" "}
                        {device.serialNumber}
                      </p>

                      <p>
                        <span className="text-gray-600">Asset:</span>{" "}
                        {device.isCompanyAsset ? "Company Owned" : "Personal"}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Location</h4>

                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="text-gray-600">Building:</span>{" "}
                        {device.location.building}
                      </p>

                      <p>
                        <span className="text-gray-600">Floor:</span>{" "}
                        {device.location.floor}
                      </p>

                      <p>
                        <span className="text-gray-600">Room:</span>{" "}
                        {device.location.room}
                      </p>

                      <p>
                        <span className="text-gray-600">Desk:</span>{" "}
                        {device.location.desk}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Security Status</h4>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />

                        <span className="text-sm">
                          Encryption: {device.security.encryptionStatus}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />

                        <span className="text-sm">
                          Risk Level: {device.security.riskLevel}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {device.security.antivirusInstalled ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}

                        <span className="text-sm">
                          Antivirus:{" "}
                          {device.security.antivirusInstalled
                            ? "Installed"
                            : "Not Installed"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Applications Tab */}

        {activeTab === "applications" && (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold">Installed Applications</h3>

              <p className="text-gray-600">
                Applications installed across all devices
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Application
                    </th>

                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Version
                    </th>

                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Category
                    </th>

                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      License
                    </th>

                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Work Use
                    </th>

                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200">
                  {dashboardData.applications.map((app, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">
                          {app.name}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-sm text-gray-600">
                        {app.version}
                      </td>

                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                          {app.category}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            app.license === "Paid"
                              ? "bg-orange-100 text-orange-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {app.license}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        {app.usedForWork ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-gray-300"></div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                          Installed
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Security Tab */}

        {activeTab === "security" && (
          <div className="space-y-6">
            {/* Security Overview */}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <StatCard
                title="Overall Risk Score"
                value={`${dashboardData.securityMetrics.overallRiskScore}%`}
                icon={Shield}
                color="green"
                subtitle="Low risk level"
              />

              <StatCard
                title="Encrypted Devices"
                value={`${dashboardData.securityMetrics.encryptedDevices}/${dashboardData.securityMetrics.totalDevices}`}
                icon={Lock}
                color="blue"
                subtitle="Full encryption"
              />

              <StatCard
                title="Compliance Score"
                value={`${dashboardData.securityMetrics.antivirusCompliance}%`}
                icon={CheckCircle}
                color="purple"
                subtitle="Security compliance"
              />
            </div>

            {/* Security Details */}

            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold mb-4">
                Security Compliance Details
              </h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600" />

                    <span className="font-medium">Antivirus Protection</span>
                  </div>

                  <span className="text-green-600 font-semibold">
                    {dashboardData.securityMetrics.antivirusCompliance}%
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600" />

                    <span className="font-medium">Firewall Protection</span>
                  </div>

                  <span className="text-green-600 font-semibold">
                    {dashboardData.securityMetrics.firewallCompliance}%
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-orange-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-orange-600" />

                    <span className="font-medium">VPN Configuration</span>
                  </div>

                  <span className="text-orange-600 font-semibold">
                    {dashboardData.securityMetrics.vpnCompliance}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Network Tab */}

        {activeTab === "network" && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold mb-4">
                Network Configuration
              </h3>

              <div className="space-y-4">
                {dashboardData.devices.map((device) => (
                  <div key={device.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium">{device.name}</h4>

                      <span className="text-sm text-gray-600">
                        {device.type}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Network Domain</p>

                        <p className="font-medium">{device.network.domain}</p>
                      </div>

                      <div>
                        <p className="text-sm text-gray-600">VPN Status</p>

                        <div className="flex items-center gap-2">
                          {device.network.vpnConfigured ? (
                            <>
                              <CheckCircle className="w-4 h-4 text-green-500" />

                              <span className="text-green-600">Configured</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-4 h-4 text-orange-500" />

                              <span className="text-orange-600">
                                Not Configured
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Browser Information */}

            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold mb-4">
                Browser Information
              </h3>

              <div className="space-y-3">
                {dashboardData.browsers.map((browser, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{browser.name}</p>

                      <p className="text-sm text-gray-600">
                        Version: {browser.version}
                      </p>
                    </div>

                    {browser.isDefault && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                        Default
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
