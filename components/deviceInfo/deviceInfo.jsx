"use client";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Plus,
  Trash2,
  HelpCircle,
  Shield,
  Lock,
  CheckCircle,
  AlertCircle,
  Info,
  Smartphone,
  Laptop,
  Monitor,
  Server,
  Settings,
  Globe,
  Clock,
  Key,
  Wifi,
  FileText,
  CircleHelp,
  Building,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deviceDataStorage,
  DEVICE_IDENTIFICATION_GUIDE,
  DEVICE_TYPES,
  BROWSER_TYPE,
} from "@/data/device-data-storage";
import Image from "next/image";
import { SystemDetection } from "@/lib/system-detection";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const defaultWorkApplications = [
  {
    name: "Microsoft Outlook",
    version: "2309",
    isInstalled: true,
    usedForWork: true,
    category: "communication",
    licenseType: "paid",
  },
  {
    name: "Microsoft Teams",
    version: "",
    isInstalled: false,
    usedForWork: false,
    category: "communication",
    licenseType: "paid",
  },
  {
    name: "Microsoft Excel",
    version: "",
    isInstalled: false,
    usedForWork: false,
    category: "productivity",
    licenseType: "paid",
  },
  {
    name: "Microsoft Word",
    version: "",
    isInstalled: false,
    usedForWork: false,
    category: "productivity",
    licenseType: "paid",
  },
  {
    name: "Whatsapp",
    version: "",
    isInstalled: false,
    usedForWork: false,
    category: "communication",
    licenseType: "free",
  },
  {
    name: "Whatsapp Business",
    version: "",
    isInstalled: false,
    usedForWork: false,
    category: "communication",
    licenseType: "free",
  },
  {
    name: "Gmail",
    version: "",
    isInstalled: false,
    usedForWork: false,
    category: "communication",
    licenseType: "free",
  },
];

export function DeviceInformationForm() {
  const [devices, setDevices] = useState([
    {
      tempId: "1",
      deviceName: "",
      deviceType: "",
      isCompanyAsset: false,
      deviceVersion: "",
      operatingSystem: "",
      serialNumber: "",
      activationStatus: "",
      windowsKey: "",
      licenseType: "",
      osUpdateStatus: "",
      encryptionStatus: "unknown",
      antivirusInstalled: false,
      firewallEnabled: false,
      vulnerabilityStatus: "secure",
      networkInfo: {
        vpnConfigured: false,
      },
      iso9001Compliance: {
        deviceLocation: {},
        userAssignment: {
          primaryUser: "",
          department: "",
        },
        complianceDocumentation: {
          certificationStatus: "pending-review",
        },
        maintenanceInfo: {},
      },
      workApplications: [...defaultWorkApplications],
      detailedSecuritySettings: {
        screenLock: { enabled: false, type: "unknown" },
        deviceEncryption: { enabled: false, type: "unknown" },
        antivirus: { installed: false, realTimeProtection: false },
        autoUpdates: {
          osUpdatesEnabled: false,
          appUpdatesEnabled: false,
          securityUpdatesEnabled: false,
        },
        remoteWipe: { available: false, managedBy: "unknown" },
        backup: { enabled: false, type: "none", frequency: "unknown" },
        deviceSharing: { isShared: false, accessLevel: "none" },
      },
      connectivityAndDataHandling: {
        publicWifiUsage: {
          accessesCompanyData: false,
          usesVpn: false,
          frequency: "never",
        },
        dataStorage: { storesCompanyDataLocally: false, encryptionUsed: false },
        emailAccess: {
          method: "web-only",
          syncEnabled: false,
          offlineAccess: false,
        },
        cloudServices: {
          oneDriveUsed: false,
          sharePointAccess: false,
          teamsUsage: false,
          dataClassification: "public",
        },
      },
      notes: "",
    },
  ]);
  const [browsers, setBrowsers] = useState([
    {
      tempId: "1",
      browserName: "",
      version: "",
    },
  ]);
  const [userInfo, setUserInfo] = useState({
    submittedBy: "",
    employeeId: "",
    workType: "",
    employeeName: "",
    department: "",
  });
  const [privacyConsent, setPrivacyConsent] = useState({
    privacyPolicyAccepted: false,
    dataRetentionConsent: false,
    marketingConsent: false,
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);

  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [systemInfo, setSystemInfo] = useState(null);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const privacyPolicy = deviceDataStorage.getCurrentPrivacyPolicy();

  useEffect(() => {
    const detectedSystemInfo = SystemDetection.getSystemInfo();
    const deviceType = SystemDetection.getDeviceType();
    setSystemInfo({ ...detectedSystemInfo, deviceType });

    // Auto-populate OS information for the first device
    if (devices.length > 0) {
      updateDevice(
        devices[0].tempId,
        "operatingSystem",
        `${detectedSystemInfo.os.name} ${detectedSystemInfo.os.version}`
      );
      updateDevice(devices[0].tempId, "osLicensing", {
        ...devices[0].osLicensing,
        osUpdateStatus:
          detectedSystemInfo.os.securityUpdateStatus === "current"
            ? "current"
            : detectedSystemInfo.os.securityUpdateStatus === "extended"
            ? "outdated"
            : "end-of-life",
      });
    }
  }, []);

  const addDevice = () => {
    if (devices.length < 5) {
      setDevices([
        ...devices,
        {
          tempId: Date.now().toString(),
          deviceName: "",
          deviceType: "",
          isCompanyAsset: false,
          deviceVersion: "",
          operatingSystem: "",
          serialNumber: "",
          activationStatus: "",
          windowsKey: "",
          licenseType: "",
          osUpdateStatus: "",
          encryptionStatus: "unknown",
          antivirusInstalled: false,
          firewallEnabled: false,
          vulnerabilityStatus: "secure",
          networkInfo: {
            vpnConfigured: false,
          },
          iso9001Compliance: {
            deviceLocation: {},
            userAssignment: {
              primaryUser: "",
              department: "",
            },
            complianceDocumentation: {
              certificationStatus: "pending-review",
            },
            maintenanceInfo: {},
          },
          workApplications: [...defaultWorkApplications],
          detailedSecuritySettings: {
            screenLock: { enabled: false, type: "unknown" },
            deviceEncryption: { enabled: false, type: "unknown" },
            antivirus: { installed: false, realTimeProtection: false },
            autoUpdates: {
              osUpdatesEnabled: false,
              appUpdatesEnabled: false,
              securityUpdatesEnabled: false,
            },
            remoteWipe: { available: false, managedBy: "unknown" },
            backup: { enabled: false, type: "none", frequency: "unknown" },
            deviceSharing: { isShared: false, accessLevel: "none" },
          },
          connectivityAndDataHandling: {
            publicWifiUsage: {
              accessesCompanyData: false,
              usesVpn: false,
              frequency: "never",
            },
            dataStorage: {
              storesCompanyDataLocally: false,
              encryptionUsed: false,
            },
            emailAccess: {
              method: "web-only",
              syncEnabled: false,
              offlineAccess: false,
            },
            cloudServices: {
              oneDriveUsed: false,
              sharePointAccess: false,
              teamsUsage: false,
              dataClassification: "public",
            },
          },
          notes: "",
        },
      ]);
    }
  };

  const addBrowser = () => {
    if (browsers.length < 5) {
      setBrowsers([
        ...browsers,
        {
          tempId: Date.now().toString(),
          browserName: "",
          version: "",
        },
      ]);
    }
  };

  const removeDevice = (tempId) => {
    if (devices.length > 1) {
      setDevices(devices.filter((device) => device.tempId !== tempId));
    }
  };

  const removeBrowser = (tempId) => {
    if (browsers.length > 1) {
      setBrowsers(browsers.filter((browser) => browser.tempId !== tempId));
    }
  };

  const updateNestedField = (tempId, parentField, childField, value) => {
    setDevices(
      devices.map((device) => {
        if (device.tempId === tempId) {
          return {
            ...device,
            [parentField]: {
              ...device[parentField],
              [childField]: value,
            },
          };
        }
        return device;
      })
    );
  };

  // Add these helper functions for updating nested application data
  const updateWorkApplication = (tempId, appIndex, field, value) => {
    setDevices(
      devices.map((device) => {
        if (device.tempId === tempId) {
          const updatedApps = [...device.workApplications];
          updatedApps[appIndex] = { ...updatedApps[appIndex], [field]: value };
          return { ...device, workApplications: updatedApps };
        }
        return device;
      })
    );
  };

  const addCustomWorkApplication = (tempId) => {
    setDevices(
      devices.map((device) => {
        if (device.tempId === tempId) {
          return {
            ...device,
            workApplications: [
              ...device.workApplications,
              {
                name: "",
                version: "",
                isInstalled: false,
                usedForWork: false,
                category: "other",
              },
            ],
          };
        }
        return device;
      })
    );
  };

  const removeWorkApplication = (tempId, appIndex) => {
    setDevices(
      devices.map((device) => {
        if (device.tempId === tempId) {
          const updatedApps = device.workApplications.filter(
            (_, index) => index !== appIndex
          );
          return { ...device, workApplications: updatedApps };
        }
        return device;
      })
    );
  };

  const updateDevice = (tempId, field, value) => {
    setDevices(
      devices.map((device) =>
        device.tempId === tempId ? { ...device, [field]: value } : device
      )
    );

    // Clear field-specific errors
    const errorKey = `${tempId}.${field}`;
    if (errors[errorKey]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }
  };

  const updateBrowser = (tempId, field, value) => {
    setBrowsers(
      browsers.map((browser) =>
        browser.tempId === tempId ? { ...browser, [field]: value } : browser
      )
    );

    // Clear field-specific errors
    const errorKey = `${tempId}.${field}`;
    if (errors[errorKey]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }
  };

  const validateForm = () => {
    const newErrors = {};

    // Validate user info
    if (!userInfo.submittedBy.trim()) {
      newErrors["userInfo.submittedBy"] = "Email address is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userInfo.submittedBy)) {
      newErrors["userInfo.submittedBy"] = "Please enter a valid email address";
    }
    if (!userInfo?.employeeName.trim()) {
      newErrors["userInfo.employeeName"] = "Name is required";
    }

    // Validate devices
    devices.forEach((device, index) => {
      if (!device.deviceName.trim()) {
        newErrors[`${device.tempId}.deviceName`] = "Device name is required";
      }
      if (!device.deviceType) {
        newErrors[`${device.tempId}.deviceType`] = "Device type is required";
      }
      // if (!device.operatingSystem.trim()) {
      //   newErrors[`${device.tempId}.operatingSystem`] =
      //     "Operating System is required";
      // }
    });

    // Validate Browser
    browsers.forEach((browser, index) => {
      if (!browser.browserName) {
        newErrors[`${browser.tempId}.browserName`] = "Browser name is required";
      }
      if (!browser.version) {
        newErrors[`${browser.tempId}.version`] = "Browser Version is required";
      }
    });

    // Validate privacy consent
    if (!privacyConsent.privacyPolicyAccepted) {
      newErrors["privacy.policy"] =
        "You must accept the privacy policy to continue";
    }
    if (!privacyConsent.dataRetentionConsent) {
      newErrors["privacy.retention"] = "Data retention consent is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await deviceDataStorage.submitDeviceInformation(
        devices.map(({ tempId, ...device }) => device),
        browsers.map(({ tempId, ...browser }) => browser),
        userInfo,
        privacyConsent,
        systemInfo
      );
      setSubmissionResult(result);
      setShowSuccessDialog(true);

      if (result.success) {
        // Reset form on success
        setDevices([
          {
            tempId: "1",
            deviceName: "",
            deviceType: "",
            isCompanyAsset: false,
            deviceVersion: "",
            operatingSystem: "",
            serialNumber: "",
            activationStatus: "",
            windowsKey: "",
            licenseType: "",
            osUpdateStatus: "",
            encryptionStatus: "unknown",
            antivirusInstalled: false,
            firewallEnabled: false,
            vulnerabilityStatus: "secure",
            networkInfo: {
              vpnConfigured: false,
            },
            iso9001Compliance: {
              deviceLocation: {},
              userAssignment: {
                primaryUser: "",
                department: "",
              },
              complianceDocumentation: {
                certificationStatus: "pending-review",
              },
              maintenanceInfo: {},
            },
            workApplications: [...defaultWorkApplications],
            detailedSecuritySettings: {
              screenLock: { enabled: false, type: "unknown" },
              deviceEncryption: { enabled: false, type: "unknown" },
              antivirus: { installed: false, realTimeProtection: false },
              autoUpdates: {
                osUpdatesEnabled: false,
                appUpdatesEnabled: false,
                securityUpdatesEnabled: false,
              },
              remoteWipe: { available: false, managedBy: "unknown" },
              backup: { enabled: false, type: "none", frequency: "unknown" },
              deviceSharing: { isShared: false, accessLevel: "none" },
            },
            connectivityAndDataHandling: {
              publicWifiUsage: {
                accessesCompanyData: false,
                usesVpn: false,
                frequency: "never",
              },
              dataStorage: {
                storesCompanyDataLocally: false,
                encryptionUsed: false,
              },
              emailAccess: {
                method: "web-only",
                syncEnabled: false,
                offlineAccess: false,
              },
              cloudServices: {
                oneDriveUsed: false,
                sharePointAccess: false,
                teamsUsage: false,
                dataClassification: "public",
              },
            },
          },
        ]);
        setBrowsers([
          {
            tempId: "1",
            browserName: "",
            version: "",
          },
        ]);
        setUserInfo({
          submittedBy: "",
          employeeId: "",
          department: "",
          employeeName: "",
        });
        setPrivacyConsent({
          privacyPolicyAccepted: false,
          dataRetentionConsent: false,
          marketingConsent: false,
        });
      }
    } catch (error) {
      setSubmissionResult({
        success: false,
        error: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getOSStatusBadge = (status) => {
    switch (status) {
      case "current":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            Current
          </Badge>
        );
      case "outdated":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            Outdated
          </Badge>
        );
      case "end-of-life":
        return <Badge variant="destructive">End of Life</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getDeviceIcon = (deviceType) => {
    switch (deviceType) {
      case "laptop":
        return <Laptop className="h-4 w-4" />;
      case "smartphone":
      case "tablet":
        return <Smartphone className="h-4 w-4" />;
      case "desktop":
      case "monitor":
        return <Monitor className="h-4 w-4" />;
      case "server":
        return <Server className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <Card className={"bg-gradient-to-bl from-blue-50 via-blue-200"}>
        <CardHeader className={"flex items-center gap-4"}>
          <Image
            src={
              "https://res.cloudinary.com/drcjzx0sw/image/upload/v1736432686/CDC_Logo_tm3exk.svg"
            }
            alt="CDC Logo"
            height={40}
            width={40}
          />
          <CardTitle className={"sm:text-base text-sm"}>
            Creative Design & Construction
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-600" />
            Device Information Submission{" "}
            <Badge>{systemInfo?.deviceType}</Badge>
          </CardTitle>
          <CardDescription>
            Please provide information about your devices for asset management
            and security compliance. All information is encrypted and handled
            according to our privacy policy.
          </CardDescription>
          {systemInfo && (
            <div className="flex sm:flex-row flex-col sm:items-center gap-4 mt-4 p-3 bg-blue-50 rounded-lg">
              <Info className="h-5 w-5 text-blue-600 sm:block hidden" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900">
                  Auto-detected: {systemInfo.browser.name}{" "}
                  {systemInfo.browser.version} on {systemInfo.os.name}
                </p>
                <p className="text-xs text-blue-700">
                  OS Status:{" "}
                  {getOSStatusBadge(systemInfo.os.securityUpdateStatus)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSystemInfo(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                View Details
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Submission Result */}
      {submissionResult && (
        <Card
          className={cn(
            "border-2",
            submissionResult.success
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          )}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              {submissionResult.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600" />
              )}
              <div>
                {submissionResult.success ? (
                  <div>
                    <p className="font-medium text-green-800">
                      Submission Successful!
                    </p>
                    <p className="text-sm text-green-700">
                      Your submission ID is:{" "}
                      <code className="bg-green-100 px-2 py-1 rounded">
                        {submissionResult.submissionId}
                      </code>
                    </p>
                    <p className="text-sm text-green-700 mt-1">
                      Please save this ID for your records. You can use it to
                      reference your submission.
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium text-red-800">
                      Submission Failed
                    </p>
                    <p className="text-sm text-red-700">
                      {submissionResult.error}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* User Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Information</CardTitle>
            <CardDescription>
              Please provide your contact information for this submission.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="submittedBy">Email Address *</Label>
                <Input
                  id="submittedBy"
                  type="email"
                  value={userInfo.submittedBy}
                  onChange={(e) =>
                    setUserInfo((prev) => ({
                      ...prev,
                      submittedBy: e.target.value,
                    }))
                  }
                  placeholder="yourname@cdc.construction"
                  className={
                    errors["userInfo.submittedBy"] ? "border-red-500" : ""
                  }
                />
                {errors["userInfo.submittedBy"] && (
                  <p className="text-sm text-red-500">
                    {errors["userInfo.submittedBy"]}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="employeeName">Name</Label>
                <Input
                  id="employeeName"
                  value={userInfo.employeeName}
                  onChange={(e) =>
                    setUserInfo((prev) => ({
                      ...prev,
                      employeeName: e.target.value,
                    }))
                  }
                  className={
                    errors["userInfo.employeeName"] ? "border-red-500" : ""
                  }
                  placeholder="John Doe"
                />
                {errors["userInfo.employeeName"] && (
                  <p className="text-sm text-red-500">
                    {errors["userInfo.employeeName"]}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="department">Department (Optional)</Label>
                <div className="container">
                  <Select
                    value={userInfo.department}
                    onValueChange={(value) =>
                      setUserInfo((prev) => ({ ...prev, department: value }))
                    }
                  >
                    <SelectTrigger className={"w-full"}>
                      <SelectValue placeholder="Select your department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="board-member">Board Member</SelectItem>
                      <SelectItem value="project-management">
                        Project Management
                      </SelectItem>
                      <SelectItem value="hr">Human Resources</SelectItem>
                      <SelectItem value="design">Design</SelectItem>
                      <SelectItem value="procurement">Procurement</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="finance">Finance</SelectItem>
                      <SelectItem value="operations">Operations</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="it">Information Technology</SelectItem>
                      <SelectItem value="electric">Electric</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workType">Work Type</Label>
                <Input
                  id="workType"
                  value={userInfo.workType}
                  onChange={(e) =>
                    setUserInfo((prev) => ({
                      ...prev,
                      workType: e.target.value,
                    }))
                  }
                  placeholder="Office, Work From Home, Site, WFH & Site"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Device Information */}
        <Card>
          <CardHeader>
            <div className="sm:flex items-center justify-between space-y-4 sm:space-y-0">
              <div>
                <CardTitle className="text-lg">Device Information</CardTitle>
                <CardDescription>
                  Add up to 5 devices. Click the help button for guidance on
                  finding device information.
                </CardDescription>
              </div>
              <div className="sm:flex sm:space-x-0 space-x-3 sm:space-y-0 space-y-3 gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <HelpCircle className="sm:block hidden" />
                      Device Guide
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Device Identification Guide</DialogTitle>
                      <DialogDescription>
                        Follow these instructions to accurately identify your
                        devices.
                      </DialogDescription>
                    </DialogHeader>
                    <DeviceIdentificationGuide />
                  </DialogContent>
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Key className="sm:block hidden" />
                      OS Key Guide
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Operating System Key Guide</DialogTitle>
                      <DialogDescription>
                        Instructions for finding and validating OS license keys.
                      </DialogDescription>
                    </DialogHeader>
                    <OSKeyGuide />
                  </DialogContent>
                </Dialog>

                {devices.length < 5 && (
                  <Button type="button" onClick={addDevice} size="sm">
                    <Plus />
                    Add Device
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm tracking-tight text-red-600 font-medium">
              Note: If you are using your private device for company purpose
              please mention it here.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {devices.map((device, index) => (
              <div
                key={device.tempId}
                className="rounded-lg sm:p-6 border p-2 border-neutral-800 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getDeviceIcon(device.deviceType)}
                    <h3 className="font-medium">Device {index + 1}</h3>
                    {device?.deviceName && (
                      <Badge
                        variant="outline"
                        className="sm:max-w-xl max-w-24 px-2 py-1"
                      >
                        <div className="overflow-x-auto whitespace-nowrap">
                          {device?.deviceName}
                        </div>
                      </Badge>
                    )}
                  </div>
                  {devices.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDevice(device.tempId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`deviceName-${device.tempId}`}>
                      Device Name *
                    </Label>
                    <Input
                      id={`deviceName-${device.tempId}`}
                      value={device.deviceName}
                      onChange={(e) =>
                        updateDevice(
                          device.tempId,
                          "deviceName",
                          e.target.value
                        )
                      }
                      placeholder="e.g., MacBook Pro 16-inch 2023"
                      className={
                        errors[`${device.tempId}.deviceName`]
                          ? "border-red-500"
                          : ""
                      }
                    />
                    {errors[`${device.tempId}.deviceName`] && (
                      <p className="text-sm text-red-500">
                        {errors[`${device.tempId}.deviceName`]}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 w-full">
                    <Label htmlFor={`deviceType-${device.tempId}`}>
                      Device Type *
                    </Label>
                    <Select
                      className="w-full"
                      value={device.deviceType}
                      onValueChange={(value) =>
                        updateDevice(device.tempId, "deviceType", value)
                      }
                    >
                      <SelectTrigger
                        className={`w-full 
                          ${errors[`${device.tempId}.deviceType`]}
                            ? "border-red-500"
                            : ""
                        `}
                      >
                        <SelectValue placeholder="Select device type" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEVICE_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex items-center gap-2">
                              <span>{type.icon}</span>
                              {type.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors[`${device.tempId}.deviceType`] && (
                      <p className="text-sm text-red-500">
                        {errors[`${device.tempId}.deviceType`]}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`deviceVersion-${device.tempId}`}>
                      Device Version/Model
                    </Label>
                    <Input
                      id={`deviceVersion-${device.tempId}`}
                      value={device.deviceVersion}
                      onChange={(e) =>
                        updateDevice(
                          device.tempId,
                          "deviceVersion",
                          e.target.value
                        )
                      }
                      placeholder="e.g., Model A2485, Gen 10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`operatingSystem-${device.tempId}`}>
                      Operating System
                    </Label>
                    <Input
                      id={`operatingSystem-${device.tempId}`}
                      value={device.operatingSystem}
                      onChange={(e) =>
                        updateDevice(
                          device.tempId,
                          "operatingSystem",
                          e.target.value
                        )
                      }
                      placeholder="e.g., macOS 14.0, Windows 11"
                      className={
                        errors[`${device.tempId}.operatingSystem`]
                          ? "border-red-500"
                          : ""
                      }
                    />
                    {errors[`${device.tempId}.operatingSystem`] && (
                      <p className="text-sm text-red-500">
                        {errors[`${device.tempId}.operatingSystem`]}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`serialNumber-${device.tempId}`}>
                    Serial Number (Optional)
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="relative">
                        <Input
                          id={`serialNumber-${device.tempId}`}
                          value={device.serialNumber}
                          onChange={(e) =>
                            updateDevice(
                              device.tempId,
                              "serialNumber",
                              e.target.value
                            )
                          }
                          placeholder="Device serial number (will be encrypted)"
                          className="font-mono"
                        />
                        <Lock className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Serial numbers are encrypted for security and
                        traceability
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Serial numbers are encrypted for security
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`isCompanyAsset-${device.tempId}`}
                      checked={device.isCompanyAsset}
                      onCheckedChange={(checked) =>
                        updateDevice(device.tempId, "isCompanyAsset", checked)
                      }
                    />
                    <Label
                      htmlFor={`isCompanyAsset-${device.tempId}`}
                      className="font-medium"
                    >
                      This is a company asset
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground ml-6">
                    Check this box if the device is owned by the company
                  </p>
                </div>

                {/* OS & Licensing */}

                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    OS & Licensing Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`windowsKey-${device.tempId}`}>
                        Windows/OS License Key
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="relative">
                            <Input
                              id={`windowsKey-${device.tempId}`}
                              value={device.windowsKey}
                              onChange={(e) =>
                                updateDevice(
                                  device.tempId,
                                  "windowsKey",
                                  e.target.value
                                )
                              }
                              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                              className="font-mono"
                            />
                            <HelpCircle className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            Enter your Windows product key or "Digital License"
                            if linked to Microsoft account
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        OS Key are encrypted for security
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`licenseType-${device.tempId}`}>
                        License Type
                      </Label>
                      <Select
                        value={device.licenseType}
                        onValueChange={(value) =>
                          updateDevice(device.tempId, "licenseType", value)
                        }
                      >
                        <SelectTrigger className={"w-full"}>
                          <SelectValue placeholder="Select license type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="retail">Retail License</SelectItem>
                          <SelectItem value="oem">OEM License</SelectItem>
                          <SelectItem value="volume">Volume License</SelectItem>
                          <SelectItem value="subscription">
                            Subscription
                          </SelectItem>
                          <SelectItem value="digital">
                            Digital License
                          </SelectItem>
                          <SelectItem value="unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`activationStatus-${device.tempId}`}>
                        Activation Status
                      </Label>
                      <Select
                        value={device?.activationStatus}
                        onValueChange={(value) =>
                          updateDevice(device.tempId, "activationStatus", value)
                        }
                      >
                        <SelectTrigger className={"w-full"}>
                          <SelectValue placeholder="Select activation status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="activated">
                            ✅ Activated
                          </SelectItem>
                          <SelectItem value="not-activated">
                            ❌ Not Activated
                          </SelectItem>
                          <SelectItem value="expired">⏰ Expired</SelectItem>
                          <SelectItem value="unknown">❓ Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`osUpdateStatus-${device.tempId}`}>
                        OS Update Status
                      </Label>
                      <Select
                        value={device?.osUpdateStatus}
                        onValueChange={(value) =>
                          updateDevice(device.tempId, "osUpdateStatus", value)
                        }
                      >
                        <SelectTrigger className={"w-full"}>
                          <SelectValue placeholder="Select update status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="current">✅ Current</SelectItem>
                          <SelectItem value="outdated">⚠️ Outdated</SelectItem>
                          <SelectItem value="end-of-life">
                            ❌ End of Life
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* ISO 9001 Compliance Information */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    Compliance Information
                  </h4>

                  {/* Device Location */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Device Location *
                    </Label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Input
                        placeholder="Building"
                        value={
                          device.iso9001Compliance.deviceLocation.building || ""
                        }
                        onChange={(e) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "deviceLocation",
                            {
                              ...device.iso9001Compliance.deviceLocation,
                              building: e.target.value,
                            }
                          )
                        }
                      />
                      <Input
                        placeholder="Floor"
                        value={
                          device.iso9001Compliance.deviceLocation.floor || ""
                        }
                        onChange={(e) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "deviceLocation",
                            {
                              ...device.iso9001Compliance.deviceLocation,
                              floor: e.target.value,
                            }
                          )
                        }
                      />
                      <Input
                        placeholder="Room"
                        value={
                          device.iso9001Compliance.deviceLocation.room || ""
                        }
                        onChange={(e) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "deviceLocation",
                            {
                              ...device.iso9001Compliance.deviceLocation,
                              room: e.target.value,
                            }
                          )
                        }
                      />
                      <Input
                        placeholder="Desk/Position"
                        value={
                          device.iso9001Compliance.deviceLocation.desk || ""
                        }
                        onChange={(e) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "deviceLocation",
                            {
                              ...device.iso9001Compliance.deviceLocation,
                              desk: e.target.value,
                            }
                          )
                        }
                      />
                    </div>
                  </div>

                  {/* User Assignment */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`primaryUser-${device.tempId}`}>
                        Primary User *
                      </Label>
                      <Input
                        id={`primaryUser-${device.tempId}`}
                        value={
                          device.iso9001Compliance.userAssignment.primaryUser
                        }
                        onChange={(e) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "userAssignment",
                            {
                              ...device.iso9001Compliance.userAssignment,
                              primaryUser: e.target.value,
                            }
                          )
                        }
                        placeholder="Primary user name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`department-${device.tempId}`}>
                        Department *
                      </Label>
                      <Select
                        value={
                          device.iso9001Compliance.userAssignment.department
                        }
                        onValueChange={(value) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "userAssignment",
                            {
                              ...device.iso9001Compliance.userAssignment,
                              department: value,
                            }
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="engineering">
                            Engineering
                          </SelectItem>
                          <SelectItem value="marketing">Marketing</SelectItem>
                          <SelectItem value="sales">Sales</SelectItem>
                          <SelectItem value="hr">Human Resources</SelectItem>
                          <SelectItem value="finance">Finance</SelectItem>
                          <SelectItem value="operations">Operations</SelectItem>
                          <SelectItem value="it">
                            Information Technology
                          </SelectItem>
                          <SelectItem value="quality">
                            Quality Assurance
                          </SelectItem>
                          <SelectItem value="compliance">Compliance</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Compliance Documentation */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`assetTag-${device.tempId}`}>
                        Asset Tag
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="relative">
                            <Input
                              id={`assetTag-${device.tempId}`}
                              value={
                                device.iso9001Compliance.complianceDocumentation
                                  .assetTag || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "iso9001Compliance",
                                  "complianceDocumentation",
                                  {
                                    ...device.iso9001Compliance
                                      .complianceDocumentation,
                                    assetTag: e.target.value,
                                  }
                                )
                              }
                              placeholder="e.g., AST-2024-001"
                            />
                            <FileText className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Physical asset tag number for traceability</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`certificationStatus-${device.tempId}`}>
                        Certification Status
                      </Label>
                      <Select
                        value={
                          device.iso9001Compliance.complianceDocumentation
                            .certificationStatus
                        }
                        onValueChange={(value) =>
                          updateNestedField(
                            device.tempId,
                            "iso9001Compliance",
                            "complianceDocumentation",
                            {
                              ...device.iso9001Compliance
                                .complianceDocumentation,
                              certificationStatus: value,
                            }
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compliant">
                            ✅ Compliant
                          </SelectItem>
                          <SelectItem value="pending-review">
                            ⏳ Pending Review
                          </SelectItem>
                          <SelectItem value="non-compliant">
                            ❌ Non-Compliant
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Security Information */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Security Information
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`encryptionStatus-${device.tempId}`}>
                        Encryption Status
                      </Label>
                      <Select
                        value={device?.encryptionStatus}
                        onValueChange={(value) =>
                          updateDevice(
                            device?.tempId,
                            "encryptionStatus",
                            value
                          )
                        }
                      >
                        <SelectTrigger className={"w-full"}>
                          <SelectValue placeholder="Select encryption status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="encrypted">
                            🔒 Fully Encrypted
                          </SelectItem>
                          <SelectItem value="partially-encrypted">
                            🔓 Partially Encrypted
                          </SelectItem>
                          <SelectItem value="not-encrypted">
                            ❌ Not Encrypted
                          </SelectItem>
                          <SelectItem value="unknown">❓ Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`vulnerabilityStatus-${device.tempId}`}>
                        Security Risk Level
                      </Label>
                      <Select
                        value={device?.vulnerabilityStatus}
                        onValueChange={(value) =>
                          updateDevice(
                            device?.tempId,
                            "vulnerabilityStatus",
                            value
                          )
                        }
                      >
                        <SelectTrigger className={"w-full"}>
                          <SelectValue placeholder="Select risk level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="secure">🟢 Secure</SelectItem>
                          <SelectItem value="low-risk">🔵 Low Risk</SelectItem>
                          <SelectItem value="medium-risk">
                            🟡 Medium Risk
                          </SelectItem>
                          <SelectItem value="high-risk">
                            🟠 High Risk
                          </SelectItem>
                          <SelectItem value="critical">🔴 Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`antivirusInstalled-${device.tempId}`}
                        checked={device?.antivirusInstalled}
                        onCheckedChange={(checked) =>
                          updateDevice(
                            device?.tempId,
                            "antivirusInstalled",
                            checked
                          )
                        }
                      />
                      <Label htmlFor={`antivirusInstalled-${device.tempId}`}>
                        Antivirus Software Installed
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`firewallEnabled-${device.tempId}`}
                        checked={device.firewallEnabled}
                        onCheckedChange={(checked) =>
                          updateDevice(
                            device?.tempId,
                            "firewallEnabled",
                            checked
                          )
                        }
                      />
                      <Label htmlFor={`firewallEnabled-${device.tempId}`}>
                        Firewall Enabled
                      </Label>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <CircleHelp className="sm:block hidden" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Firewall Guide</DialogTitle>
                            <DialogDescription>
                              Instructions for finding Firewall.
                            </DialogDescription>
                          </DialogHeader>
                          <FirewallGuide />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>

                  {device?.antivirusInstalled && (
                    <div className="space-y-2">
                      <Label htmlFor={`antivirusName-${device.tempId}`}>
                        Antivirus Software Name
                      </Label>
                      <Input
                        id={`antivirusName-${device.tempId}`}
                        value={device?.antivirusName || ""}
                        onChange={(e) =>
                          updateDevice(
                            device.tempId,
                            "antivirusName",
                            e.target.value
                          )
                        }
                        placeholder="e.g., Windows Defender, Norton, McAfee"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-2">
                  <Label htmlFor={`notes-${device.tempId}`}>
                    Additional Notes
                  </Label>
                  <Textarea
                    id={`notes-${device.tempId}`}
                    value={device.notes}
                    onChange={(e) =>
                      updateDevice(device.tempId, "notes", e.target.value)
                    }
                    placeholder="Any additional information about this device..."
                    rows={2}
                  />
                </div>

                {/* Network Information */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Wifi className="h-4 w-4" />
                    Network Information
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`networkDomain-${device.tempId}`}>
                        Network Domain
                      </Label>
                      <Input
                        id={`networkDomain-${device.tempId}`}
                        value={device.networkInfo.networkDomain || ""}
                        onChange={(e) =>
                          updateNestedField(
                            device.tempId,
                            "networkInfo",
                            "networkDomain",
                            e.target.value
                          )
                        }
                        placeholder="e.g., company.local"
                      />
                    </div>

                    <div className="flex items-center space-x-2 pt-6">
                      <Checkbox
                        id={`vpnConfigured-${device.tempId}`}
                        checked={device.networkInfo.vpnConfigured}
                        onCheckedChange={(checked) =>
                          updateNestedField(
                            device.tempId,
                            "networkInfo",
                            "vpnConfigured",
                            checked
                          )
                        }
                      />
                      <Label htmlFor={`vpnConfigured-${device.tempId}`}>
                        VPN Configured
                      </Label>
                    </div>
                  </div>
                </div>

                {/* Work-Related Applications */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <FileText className="h-4 w-4 sm:block hidden" />
                    Installed Work-Related Applications
                  </h4>

                  <div className="sm:border rounded-lg sm:p-4 space-y-4">
                    <div className="flex sm:flex-row flex-col sm:gap-0 gap-2 items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Please indicate which applications are installed and
                        used for work purposes.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addCustomWorkApplication(device.tempId)}
                        className={"sm:flex hidden"}
                      >
                        <Plus />
                        Custom App
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {device.workApplications.map((app, appIndex) => (
                        <div
                          key={appIndex}
                          className="grid sm:grid-cols-12 gap-3 items-center p-3 border rounded-lg"
                        >
                          <div className="col-span-3">
                            <Input
                              placeholder="Application name"
                              value={app.name}
                              onChange={(e) =>
                                updateWorkApplication(
                                  device.tempId,
                                  appIndex,
                                  "name",
                                  e.target.value
                                )
                              }
                              className="text-sm"
                            />
                          </div>

                          <div className="col-span-2">
                            <Input
                              placeholder="Version"
                              value={app.version || ""}
                              onChange={(e) =>
                                updateWorkApplication(
                                  device.tempId,
                                  appIndex,
                                  "version",
                                  e.target.value
                                )
                              }
                              className="text-sm"
                              disabled={!app.isInstalled}
                            />
                          </div>

                          <div className="col-span-2 flex items-center space-x-2">
                            <Checkbox
                              id={`installed-${device.tempId}-${appIndex}`}
                              checked={app.isInstalled}
                              onCheckedChange={(checked) =>
                                updateWorkApplication(
                                  device.tempId,
                                  appIndex,
                                  "isInstalled",
                                  checked
                                )
                              }
                            />
                            <Label
                              htmlFor={`installed-${device.tempId}-${appIndex}`}
                              className="text-sm"
                            >
                              Installed
                            </Label>
                          </div>

                          <div className="col-span-2 flex items-center space-x-2">
                            <Checkbox
                              id={`work-${device.tempId}-${appIndex}`}
                              checked={app.usedForWork}
                              onCheckedChange={(checked) =>
                                updateWorkApplication(
                                  device.tempId,
                                  appIndex,
                                  "usedForWork",
                                  checked
                                )
                              }
                            />
                            <Label
                              htmlFor={`work-${device.tempId}-${appIndex}`}
                              className="text-sm"
                            >
                              Used for Work
                            </Label>
                          </div>

                          <div className="col-span-2 space-y-2">
                            <Select
                              value={app.category}
                              onValueChange={(value) =>
                                updateWorkApplication(
                                  device.tempId,
                                  appIndex,
                                  "category",
                                  value
                                )
                              }
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Category" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="communication">
                                  Communication
                                </SelectItem>
                                <SelectItem value="productivity">
                                  Productivity
                                </SelectItem>
                                <SelectItem value="development">
                                  Development
                                </SelectItem>
                                <SelectItem value="security">
                                  Security
                                </SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                            <Select
                              value={app.licenseType}
                              onValueChange={(value) =>
                                updateWorkApplication(
                                  device.tempId,
                                  appIndex,
                                  "licenseType",
                                  value
                                )
                              }
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="License type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="paid">Paid</SelectItem>
                                <SelectItem value="free">Free</SelectItem>
                                <SelectItem value="crack">Crack</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="col-span-1 sm:ml-4">
                            {appIndex >= 6 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={"hover:text-red-600"}
                                onClick={() =>
                                  removeWorkApplication(device.tempId, appIndex)
                                }
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addCustomWorkApplication(device.tempId)}
                        className={"sm:hidden w-full"}
                      >
                        <Plus />
                        Custom App
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Device Security Settings */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Device Security Settings
                  </h4>

                  <div className="space-y-4">
                    {/* Screen Lock */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">
                          Screen Lock Protection
                        </Label>
                        <Checkbox
                          id={`screenLock-${device.tempId}`}
                          checked={
                            device.detailedSecuritySettings.screenLock.enabled
                          }
                          onCheckedChange={(checked) =>
                            updateNestedField(
                              device.tempId,
                              "detailedSecuritySettings",
                              "screenLock",
                              {
                                ...device.detailedSecuritySettings.screenLock,
                                enabled: checked,
                              }
                            )
                          }
                        />
                      </div>

                      {device.detailedSecuritySettings.screenLock.enabled && (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`screenLockType-${device.tempId}`}>
                              Lock Type
                            </Label>
                            <Select
                              value={
                                device.detailedSecuritySettings.screenLock.type
                              }
                              onValueChange={(value) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "screenLock",
                                  {
                                    ...device.detailedSecuritySettings
                                      .screenLock,
                                    type: value,
                                  }
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select lock type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pin">PIN</SelectItem>
                                <SelectItem value="password">
                                  Password
                                </SelectItem>
                                <SelectItem value="biometric">
                                  Biometric (Face/Fingerprint)
                                </SelectItem>
                                <SelectItem value="pattern">Pattern</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`screenLockNotes-${device.tempId}`}>
                              Notes
                            </Label>
                            <Input
                              id={`screenLockNotes-${device.tempId}`}
                              placeholder="Additional details"
                              value={
                                device.detailedSecuritySettings.screenLock
                                  .notes || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "screenLock",
                                  {
                                    ...device.detailedSecuritySettings
                                      .screenLock,
                                    notes: e.target.value,
                                  }
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Device Encryption */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">
                          Device Encryption (BitLocker, FileVault, etc.)
                        </Label>
                        <Checkbox
                          id={`encryption-${device.tempId}`}
                          checked={
                            device.detailedSecuritySettings.deviceEncryption
                              .enabled
                          }
                          onCheckedChange={(checked) =>
                            updateNestedField(
                              device.tempId,
                              "detailedSecuritySettings",
                              "deviceEncryption",
                              {
                                ...device.detailedSecuritySettings
                                  .deviceEncryption,
                                enabled: checked,
                              }
                            )
                          }
                        />
                      </div>

                      {device.detailedSecuritySettings.deviceEncryption
                        .enabled && (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`encryptionType-${device.tempId}`}>
                              Encryption Type
                            </Label>
                            <Select
                              value={
                                device.detailedSecuritySettings.deviceEncryption
                                  .type
                              }
                              onValueChange={(value) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "deviceEncryption",
                                  {
                                    ...device.detailedSecuritySettings
                                      .deviceEncryption,
                                    type: value,
                                  }
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select encryption type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="bitlocker">
                                  BitLocker (Windows)
                                </SelectItem>
                                <SelectItem value="filevault">
                                  FileVault (macOS)
                                </SelectItem>
                                <SelectItem value="device-encryption">
                                  Device Encryption
                                </SelectItem>
                                <SelectItem value="luks">
                                  LUKS (Linux)
                                </SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`encryptionNotes-${device.tempId}`}>
                              Notes
                            </Label>
                            <Input
                              id={`encryptionNotes-${device.tempId}`}
                              placeholder="Additional details"
                              value={
                                device.detailedSecuritySettings.deviceEncryption
                                  .notes || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "deviceEncryption",
                                  {
                                    ...device.detailedSecuritySettings
                                      .deviceEncryption,
                                    notes: e.target.value,
                                  }
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Antivirus/Antimalware */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">
                          Antivirus/Antimalware Software
                        </Label>
                        <Checkbox
                          id={`antivirus-${device.tempId}`}
                          checked={
                            device.detailedSecuritySettings.antivirus.installed
                          }
                          onCheckedChange={(checked) =>
                            updateNestedField(
                              device.tempId,
                              "detailedSecuritySettings",
                              "antivirus",
                              {
                                ...device.detailedSecuritySettings.antivirus,
                                installed: checked,
                              }
                            )
                          }
                        />
                      </div>

                      {device.detailedSecuritySettings.antivirus.installed && (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`antivirusName-${device.tempId}`}>
                              Software Name
                            </Label>
                            <Input
                              id={`antivirusName-${device.tempId}`}
                              placeholder="e.g., Windows Defender, Norton"
                              value={
                                device.detailedSecuritySettings.antivirus
                                  .name || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "antivirus",
                                  {
                                    ...device.detailedSecuritySettings
                                      .antivirus,
                                    name: e.target.value,
                                  }
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor={`antivirusVersion-${device.tempId}`}
                            >
                              Version
                            </Label>
                            <Input
                              id={`antivirusVersion-${device.tempId}`}
                              placeholder="Software version"
                              value={
                                device.detailedSecuritySettings.antivirus
                                  .version || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "antivirus",
                                  {
                                    ...device.detailedSecuritySettings
                                      .antivirus,
                                    version: e.target.value,
                                  }
                                )
                              }
                            />
                          </div>

                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`realtimeProtection-${device.tempId}`}
                              checked={
                                device.detailedSecuritySettings.antivirus
                                  .realTimeProtection
                              }
                              onCheckedChange={(checked) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "antivirus",
                                  {
                                    ...device.detailedSecuritySettings
                                      .antivirus,
                                    realTimeProtection: checked,
                                  }
                                )
                              }
                            />
                            <Label
                              htmlFor={`realtimeProtection-${device.tempId}`}
                            >
                              Real-time Protection Enabled
                            </Label>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Auto Updates */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <Label className="font-medium">Automatic Updates</Label>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`osUpdates-${device.tempId}`}
                            checked={
                              device.detailedSecuritySettings.autoUpdates
                                .osUpdatesEnabled
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "detailedSecuritySettings",
                                "autoUpdates",
                                {
                                  ...device.detailedSecuritySettings
                                    .autoUpdates,
                                  osUpdatesEnabled: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`osUpdates-${device.tempId}`}>
                            OS Updates
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`appUpdates-${device.tempId}`}
                            checked={
                              device.detailedSecuritySettings.autoUpdates
                                .appUpdatesEnabled
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "detailedSecuritySettings",
                                "autoUpdates",
                                {
                                  ...device.detailedSecuritySettings
                                    .autoUpdates,
                                  appUpdatesEnabled: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`appUpdates-${device.tempId}`}>
                            App Updates
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`securityUpdates-${device.tempId}`}
                            checked={
                              device.detailedSecuritySettings.autoUpdates
                                .securityUpdatesEnabled
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "detailedSecuritySettings",
                                "autoUpdates",
                                {
                                  ...device.detailedSecuritySettings
                                    .autoUpdates,
                                  securityUpdatesEnabled: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`securityUpdates-${device.tempId}`}>
                            Security Updates
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Remote Wipe */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">
                          Remote Wipe Capability
                        </Label>
                        <Checkbox
                          id={`remoteWipe-${device.tempId}`}
                          checked={
                            device.detailedSecuritySettings.remoteWipe.available
                          }
                          onCheckedChange={(checked) =>
                            updateNestedField(
                              device.tempId,
                              "detailedSecuritySettings",
                              "remoteWipe",
                              {
                                ...device.detailedSecuritySettings.remoteWipe,
                                available: checked,
                              }
                            )
                          }
                        />
                      </div>

                      {device.detailedSecuritySettings.remoteWipe.available && (
                        <div className="space-y-2">
                          <Label htmlFor={`remoteWipeManager-${device.tempId}`}>
                            Managed By
                          </Label>
                          <Select
                            value={
                              device.detailedSecuritySettings.remoteWipe
                                .managedBy
                            }
                            onValueChange={(value) =>
                              updateNestedField(
                                device.tempId,
                                "detailedSecuritySettings",
                                "remoteWipe",
                                {
                                  ...device.detailedSecuritySettings.remoteWipe,
                                  managedBy: value,
                                }
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select management system" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="m365">
                                Microsoft 365
                              </SelectItem>
                              <SelectItem value="mdm">
                                Mobile Device Management (MDM)
                              </SelectItem>
                              <SelectItem value="company-policy">
                                Company Policy
                              </SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {/* Backup */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">Backup Enabled</Label>
                        <Checkbox
                          id={`backup-${device.tempId}`}
                          checked={
                            device.detailedSecuritySettings.backup.enabled
                          }
                          onCheckedChange={(checked) =>
                            updateNestedField(
                              device.tempId,
                              "detailedSecuritySettings",
                              "backup",
                              {
                                ...device.detailedSecuritySettings.backup,
                                enabled: checked,
                              }
                            )
                          }
                        />
                      </div>

                      {device.detailedSecuritySettings.backup.enabled && (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`backupType-${device.tempId}`}>
                              Backup Type
                            </Label>
                            <Select
                              value={
                                device.detailedSecuritySettings.backup.type
                              }
                              onValueChange={(value) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "backup",
                                  {
                                    ...device.detailedSecuritySettings.backup,
                                    type: value,
                                  }
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select backup type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cloud">
                                  Cloud Backup
                                </SelectItem>
                                <SelectItem value="local">
                                  Local Backup
                                </SelectItem>
                                <SelectItem value="hybrid">
                                  Hybrid (Cloud + Local)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`backupFrequency-${device.tempId}`}>
                              Frequency
                            </Label>
                            <Select
                              value={
                                device.detailedSecuritySettings.backup.frequency
                              }
                              onValueChange={(value) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "backup",
                                  {
                                    ...device.detailedSecuritySettings.backup,
                                    frequency: value,
                                  }
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select frequency" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="real-time">
                                  Real-time
                                </SelectItem>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="manual">Manual</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Device Sharing */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">
                          Device Shared with Others
                        </Label>
                        <Checkbox
                          id={`deviceSharing-${device.tempId}`}
                          checked={
                            device.detailedSecuritySettings.deviceSharing
                              .isShared
                          }
                          onCheckedChange={(checked) =>
                            updateNestedField(
                              device.tempId,
                              "detailedSecuritySettings",
                              "deviceSharing",
                              {
                                ...device.detailedSecuritySettings
                                  .deviceSharing,
                                isShared: checked,
                              }
                            )
                          }
                        />
                      </div>

                      {device.detailedSecuritySettings.deviceSharing
                        .isShared && (
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`sharedWith-${device.tempId}`}>
                              Shared With (Names/Roles)
                            </Label>
                            <Textarea
                              id={`sharedWith-${device.tempId}`}
                              placeholder="List names or roles of people who share this device"
                              value={
                                device.detailedSecuritySettings.deviceSharing.sharedWith?.join(
                                  ", "
                                ) || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "deviceSharing",
                                  {
                                    ...device.detailedSecuritySettings
                                      .deviceSharing,
                                    sharedWith: e.target.value
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter((s) => s),
                                  }
                                )
                              }
                              rows={2}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`accessLevel-${device.tempId}`}>
                              Access Level
                            </Label>
                            <Select
                              value={
                                device.detailedSecuritySettings.deviceSharing
                                  .accessLevel
                              }
                              onValueChange={(value) =>
                                updateNestedField(
                                  device.tempId,
                                  "detailedSecuritySettings",
                                  "deviceSharing",
                                  {
                                    ...device.detailedSecuritySettings
                                      .deviceSharing,
                                    accessLevel: value,
                                  }
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select access level" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="full">
                                  Full Access
                                </SelectItem>
                                <SelectItem value="limited">
                                  Limited Access
                                </SelectItem>
                                <SelectItem value="guest">
                                  Guest Access
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Connectivity and Data Handling */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Wifi className="h-4 w-4" />
                    Connectivity and Data Handling
                  </h4>

                  <div className="space-y-4">
                    {/* Public Wi-Fi Usage */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <Label className="font-medium">
                        Public Wi-Fi and Company Data Access
                      </Label>

                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`publicWifi-${device.tempId}`}
                            checked={
                              device.connectivityAndDataHandling.publicWifiUsage
                                .accessesCompanyData
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "connectivityAndDataHandling",
                                "publicWifiUsage",
                                {
                                  ...device.connectivityAndDataHandling
                                    .publicWifiUsage,
                                  accessesCompanyData: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`publicWifi-${device.tempId}`}>
                            Do you access company data via public Wi-Fi?
                          </Label>
                        </div>

                        {device.connectivityAndDataHandling.publicWifiUsage
                          .accessesCompanyData && (
                          <div className="ml-6 space-y-3">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`vpnUsage-${device.tempId}`}
                                checked={
                                  device.connectivityAndDataHandling
                                    .publicWifiUsage.usesVpn
                                }
                                onCheckedChange={(checked) =>
                                  updateNestedField(
                                    device.tempId,
                                    "connectivityAndDataHandling",
                                    "publicWifiUsage",
                                    {
                                      ...device.connectivityAndDataHandling
                                        .publicWifiUsage,
                                      usesVpn: checked,
                                    }
                                  )
                                }
                              />
                              <Label htmlFor={`vpnUsage-${device.tempId}`}>
                                Do you use a VPN?
                              </Label>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor={`vpnProvider-${device.tempId}`}>
                                  VPN Provider
                                </Label>
                                <Input
                                  id={`vpnProvider-${device.tempId}`}
                                  placeholder="e.g., Company VPN, NordVPN"
                                  value={
                                    device.connectivityAndDataHandling
                                      .publicWifiUsage.vpnProvider || ""
                                  }
                                  onChange={(e) =>
                                    updateNestedField(
                                      device.tempId,
                                      "connectivityAndDataHandling",
                                      "publicWifiUsage",
                                      {
                                        ...device.connectivityAndDataHandling
                                          .publicWifiUsage,
                                        vpnProvider: e.target.value,
                                      }
                                    )
                                  }
                                />
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`wifiFrequency-${device.tempId}`}
                                >
                                  Frequency
                                </Label>
                                <Select
                                  value={
                                    device.connectivityAndDataHandling
                                      .publicWifiUsage.frequency
                                  }
                                  onValueChange={(value) =>
                                    updateNestedField(
                                      device.tempId,
                                      "connectivityAndDataHandling",
                                      "publicWifiUsage",
                                      {
                                        ...device.connectivityAndDataHandling
                                          .publicWifiUsage,
                                        frequency: value,
                                      }
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="How often?" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="rarely">
                                      Rarely
                                    </SelectItem>
                                    <SelectItem value="sometimes">
                                      Sometimes
                                    </SelectItem>
                                    <SelectItem value="often">Often</SelectItem>
                                    <SelectItem value="always">
                                      Always
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Local Data Storage */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <Label className="font-medium">Local Data Storage</Label>

                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`localData-${device.tempId}`}
                            checked={
                              device.connectivityAndDataHandling.dataStorage
                                .storesCompanyDataLocally
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "connectivityAndDataHandling",
                                "dataStorage",
                                {
                                  ...device.connectivityAndDataHandling
                                    .dataStorage,
                                  storesCompanyDataLocally: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`localData-${device.tempId}`}>
                            Do you store company data locally on this device?
                          </Label>
                        </div>

                        {device.connectivityAndDataHandling.dataStorage
                          .storesCompanyDataLocally && (
                          <div className="ml-6 space-y-3">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`dataEncryption-${device.tempId}`}
                                checked={
                                  device.connectivityAndDataHandling.dataStorage
                                    .encryptionUsed
                                }
                                onCheckedChange={(checked) =>
                                  updateNestedField(
                                    device.tempId,
                                    "connectivityAndDataHandling",
                                    "dataStorage",
                                    {
                                      ...device.connectivityAndDataHandling
                                        .dataStorage,
                                      encryptionUsed: checked,
                                    }
                                  )
                                }
                              />
                              <Label
                                htmlFor={`dataEncryption-${device.tempId}`}
                              >
                                Is the data encrypted?
                              </Label>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`dataTypes-${device.tempId}`}>
                                Types of Data Stored
                              </Label>
                              <Textarea
                                id={`dataTypes-${device.tempId}`}
                                placeholder="e.g., Documents, Spreadsheets, Customer data, etc."
                                value={
                                  device.connectivityAndDataHandling.dataStorage.dataTypes?.join(
                                    ", "
                                  ) || ""
                                }
                                onChange={(e) =>
                                  updateNestedField(
                                    device.tempId,
                                    "connectivityAndDataHandling",
                                    "dataStorage",
                                    {
                                      ...device.connectivityAndDataHandling
                                        .dataStorage,
                                      dataTypes: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter((s) => s),
                                    }
                                  )
                                }
                                rows={2}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Email Access */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <Label className="font-medium">Email Access Method</Label>

                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor={`emailMethod-${device.tempId}`}>
                            How do you access email?
                          </Label>
                          <Select
                            value={
                              device.connectivityAndDataHandling.emailAccess
                                .method
                            }
                            onValueChange={(value) =>
                              updateNestedField(
                                device.tempId,
                                "connectivityAndDataHandling",
                                "emailAccess",
                                {
                                  ...device.connectivityAndDataHandling
                                    .emailAccess,
                                  method: value,
                                }
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select email access method" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="native-app">
                                Native Mail App
                              </SelectItem>
                              <SelectItem value="outlook">
                                Microsoft Outlook
                              </SelectItem>
                              <SelectItem value="web-only">
                                Web Browser Only
                              </SelectItem>
                              <SelectItem value="multiple">
                                Multiple Methods
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {device.connectivityAndDataHandling.emailAccess
                          .method === "native-app" && (
                          <div className="space-y-2">
                            <Label htmlFor={`nativeAppName-${device.tempId}`}>
                              Native App Name
                            </Label>
                            <Input
                              id={`nativeAppName-${device.tempId}`}
                              placeholder="e.g., Apple Mail, Gmail App"
                              value={
                                device.connectivityAndDataHandling.emailAccess
                                  .nativeAppName || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "connectivityAndDataHandling",
                                  "emailAccess",
                                  {
                                    ...device.connectivityAndDataHandling
                                      .emailAccess,
                                    nativeAppName: e.target.value,
                                  }
                                )
                              }
                            />
                          </div>
                        )}

                        {device.connectivityAndDataHandling.emailAccess
                          .method === "outlook" && (
                          <div className="space-y-2">
                            <Label htmlFor={`outlookVersion-${device.tempId}`}>
                              Outlook Version
                            </Label>
                            <Input
                              id={`outlookVersion-${device.tempId}`}
                              placeholder="e.g., Outlook 2021, Outlook 365"
                              value={
                                device.connectivityAndDataHandling.emailAccess
                                  .outlookVersion || ""
                              }
                              onChange={(e) =>
                                updateNestedField(
                                  device.tempId,
                                  "connectivityAndDataHandling",
                                  "emailAccess",
                                  {
                                    ...device.connectivityAndDataHandling
                                      .emailAccess,
                                    outlookVersion: e.target.value,
                                  }
                                )
                              }
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`emailSync-${device.tempId}`}
                              checked={
                                device.connectivityAndDataHandling.emailAccess
                                  .syncEnabled
                              }
                              onCheckedChange={(checked) =>
                                updateNestedField(
                                  device.tempId,
                                  "connectivityAndDataHandling",
                                  "emailAccess",
                                  {
                                    ...device.connectivityAndDataHandling
                                      .emailAccess,
                                    syncEnabled: checked,
                                  }
                                )
                              }
                            />
                            <Label htmlFor={`emailSync-${device.tempId}`}>
                              Email Sync Enabled
                            </Label>
                          </div>

                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`offlineAccess-${device.tempId}`}
                              checked={
                                device.connectivityAndDataHandling.emailAccess
                                  .offlineAccess
                              }
                              onCheckedChange={(checked) =>
                                updateNestedField(
                                  device.tempId,
                                  "connectivityAndDataHandling",
                                  "emailAccess",
                                  {
                                    ...device.connectivityAndDataHandling
                                      .emailAccess,
                                    offlineAccess: checked,
                                  }
                                )
                              }
                            />
                            <Label htmlFor={`offlineAccess-${device.tempId}`}>
                              Offline Access
                            </Label>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cloud Services */}
                    <div className="border rounded-lg p-4 space-y-3">
                      <Label className="font-medium">
                        Cloud Services Usage
                      </Label>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`oneDrive-${device.tempId}`}
                            checked={
                              device.connectivityAndDataHandling.cloudServices
                                .oneDriveUsed
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "connectivityAndDataHandling",
                                "cloudServices",
                                {
                                  ...device.connectivityAndDataHandling
                                    .cloudServices,
                                  oneDriveUsed: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`oneDrive-${device.tempId}`}>
                            OneDrive
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`sharePoint-${device.tempId}`}
                            checked={
                              device.connectivityAndDataHandling.cloudServices
                                .sharePointAccess
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "connectivityAndDataHandling",
                                "cloudServices",
                                {
                                  ...device.connectivityAndDataHandling
                                    .cloudServices,
                                  sharePointAccess: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`sharePoint-${device.tempId}`}>
                            SharePoint
                          </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`teams-${device.tempId}`}
                            checked={
                              device.connectivityAndDataHandling.cloudServices
                                .teamsUsage
                            }
                            onCheckedChange={(checked) =>
                              updateNestedField(
                                device.tempId,
                                "connectivityAndDataHandling",
                                "cloudServices",
                                {
                                  ...device.connectivityAndDataHandling
                                    .cloudServices,
                                  teamsUsage: checked,
                                }
                              )
                            }
                          />
                          <Label htmlFor={`teams-${device.tempId}`}>
                            Microsoft Teams
                          </Label>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`dataClassification-${device.tempId}`}>
                          Data Classification Level
                        </Label>
                        <Select
                          value={
                            device.connectivityAndDataHandling.cloudServices
                              .dataClassification
                          }
                          onValueChange={(value) =>
                            updateNestedField(
                              device.tempId,
                              "connectivityAndDataHandling",
                              "cloudServices",
                              {
                                ...device.connectivityAndDataHandling
                                  .cloudServices,
                                dataClassification: value,
                              }
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select data classification" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="public">Public</SelectItem>
                            <SelectItem value="internal">Internal</SelectItem>
                            <SelectItem value="confidential">
                              Confidential
                            </SelectItem>
                            <SelectItem value="restricted">
                              Restricted
                            </SelectItem>
                            <SelectItem value="mixed">
                              Mixed Classification
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Browser Information */}
        <Card>
          <CardHeader>
            <div className="sm:flex items-center justify-between space-y-4 sm:space-y-0">
              <div>
                <CardTitle className="text-lg">Browser Information</CardTitle>
                <CardDescription>
                  Add up to 5 broswers. Click the help button for guidance on
                  finding browser information.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Globe />
                      Browser Guide
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Operating System Key Guide</DialogTitle>
                      <DialogDescription>
                        Instructions for finding and validating OS license keys.
                      </DialogDescription>
                    </DialogHeader>
                    <BrowserVersionGuide />
                  </DialogContent>
                </Dialog>

                {devices.length < 5 && (
                  <Button type="button" onClick={addBrowser} size="sm">
                    <Plus />
                    Add Browser
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {browsers.map((browser, index) => (
              <div
                key={browser.tempId}
                className="border rounded-lg p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">Browser {index + 1}</h3>
                    {browser.browserName && (
                      <Badge
                        variant="outline"
                        className="sm:max-w-xl max-w-24 px-2 py-1"
                      >
                        <div className="overflow-x-auto whitespace-nowrap">
                          {browser.browserName}
                        </div>
                      </Badge>
                    )}
                  </div>
                  {browsers.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBrowser(browser.tempId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 w-full">
                    <Label htmlFor={`browserName-${browser.tempId}`}>
                      Browser Name *
                    </Label>
                    <Select
                      className="w-full"
                      value={browser.browserName}
                      onValueChange={(value) =>
                        updateBrowser(browser.tempId, "browserName", value)
                      }
                    >
                      <SelectTrigger
                        className={`w-full
                          ${
                            errors[`${browser.tempId}.browserName`]
                              ? "border-red-500 border"
                              : ""
                          } 
                        `}
                      >
                        <SelectValue placeholder="Choose Browser" />
                      </SelectTrigger>
                      <SelectContent>
                        {BROWSER_TYPE.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex items-center gap-2">
                              {type.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors[`${browser.tempId}.browserName`] && (
                      <p className="text-sm text-red-500">
                        {errors[`${browser.tempId}.browserName`]}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`version-${browser.tempId}`}>
                      Browser Version *
                    </Label>
                    <Input
                      id={`version-${browser.tempId}`}
                      value={browser.version}
                      onChange={(e) =>
                        updateBrowser(browser.tempId, "version", e.target.value)
                      }
                      placeholder="e.g., 136.0.7103.114"
                      className={
                        errors[`${browser.tempId}.version`]
                          ? "border-red-500"
                          : ""
                      }
                    />
                    {errors[`${browser.tempId}.version`] && (
                      <p className="text-sm text-red-500">
                        {errors[`${browser.tempId}.version`]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Privacy Policy and Consent */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Privacy Policy and Consent
            </CardTitle>
            <CardDescription>
              Please review and accept our privacy policy before submitting your
              device information.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-lg p-4 bg-blue-50">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="space-y-2">
                  <h4 className="font-medium text-blue-900">
                    Data Protection Summary
                  </h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>
                      • All data is encrypted during storage and transmission
                    </li>
                    <li>
                      • Information is used only for asset management and
                      security compliance
                    </li>
                    <li>
                      • You have the right to access, correct, or delete your
                      data
                    </li>
                    <li>
                      • Data retention period: 7 years or until employment
                      termination + 2 years
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="privacyPolicyAccepted"
                  checked={privacyConsent.privacyPolicyAccepted}
                  onCheckedChange={(checked) =>
                    setPrivacyConsent((prev) => ({
                      ...prev,
                      privacyPolicyAccepted: !!checked,
                    }))
                  }
                  className={errors["privacy.policy"] ? "border-red-500" : ""}
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="privacyPolicyAccepted"
                    className="font-medium"
                  >
                    I have read and accept the{" "}
                    <Dialog
                      open={showPrivacyPolicy}
                      onOpenChange={setShowPrivacyPolicy}
                    >
                      <DialogTrigger asChild>
                        <Button
                          type="button"
                          variant="link"
                          className="p-0 h-auto text-blue-600"
                        >
                          Privacy Policy
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Privacy Policy</DialogTitle>
                          <DialogDescription>
                            Version {privacyPolicy.version} - Effective{" "}
                            {privacyPolicy.effectiveDate}
                          </DialogDescription>
                        </DialogHeader>
                        <PrivacyPolicyContent policy={privacyPolicy} />
                      </DialogContent>
                    </Dialog>
                    {" *"}
                  </Label>
                  {errors["privacy.policy"] && (
                    <p className="text-sm text-red-500">
                      {errors["privacy.policy"]}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="dataRetentionConsent"
                  checked={privacyConsent.dataRetentionConsent}
                  onCheckedChange={(checked) =>
                    setPrivacyConsent((prev) => ({
                      ...prev,
                      dataRetentionConsent: !!checked,
                    }))
                  }
                  className={
                    errors["privacy.retention"] ? "border-red-500" : ""
                  }
                />
                <div className="space-y-1">
                  <Label htmlFor="dataRetentionConsent" className="font-medium">
                    I consent to the retention of my device information for the
                    specified period *
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Your data will be retained for asset management and
                    compliance purposes as outlined in the privacy policy.
                  </p>
                  {errors["privacy.retention"] && (
                    <p className="text-sm text-red-500">
                      {errors["privacy.retention"]}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="marketingConsent"
                  checked={privacyConsent.marketingConsent}
                  onCheckedChange={(checked) =>
                    setPrivacyConsent((prev) => ({
                      ...prev,
                      marketingConsent: !!checked,
                    }))
                  }
                />
                <div className="space-y-1">
                  <Label htmlFor="marketingConsent" className="font-medium">
                    I confirm that all information provided is accurate and
                    complete
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    This declaration is required for documentation integrity.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <Card>
          <CardContent className="">
            <div className="border rounded-lg p-4 bg-green-50 mb-4">
              <div className="flex items-start gap-3">
                <Lock className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="space-y-2">
                  <h4 className="font-medium text-green-900">
                    Enhanced Data Protection
                  </h4>
                  <ul className="text-sm text-green-800 space-y-1">
                    <li>• All data encrypted with enterprise-grade security</li>
                    <li>• Compliant data management and retention</li>
                    <li>• Automatic system detection for accuracy</li>
                    <li>• GDPR, CCPA, and SOX compliance</li>
                    <li>• Complete audit trail and version control</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex sm:flex-row sm:gap-0 gap-8 flex-col sm:items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <p>
                  By submitting this form, you confirm that the information
                  provided is accurate and complete.
                </p>
                <p className="mt-1">
                  Submission ID will be provided for your records upon
                  successful submission.
                </p>
              </div>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="min-w-32"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Submitting...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Submit Securely
                  </div>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* System Information Dialog */}
      <Dialog open={showSystemInfo} onOpenChange={setShowSystemInfo}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Auto-Detected System Information</DialogTitle>
            <DialogDescription>
              Comprehensive system detection for enhanced device management and
              compliance.
            </DialogDescription>
          </DialogHeader>
          {systemInfo && <SystemInfoDisplay systemInfo={systemInfo} />}
        </DialogContent>
      </Dialog>

      <SuccessfulSubmit
        showSuccessDialog={showSuccessDialog}
        setShowSuccessDialog={setShowSuccessDialog}
        submissionId={submissionResult?.submissionId}
      />
    </div>
  );
}

function SystemInfoDisplay({ systemInfo }) {
  return (
    <div className="space-y-6">
      {/* Browser Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Browser Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Browser</Label>
              <p className="text-sm">
                {systemInfo.browser.name} {systemInfo.browser.version}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Platform</Label>
              <p className="text-sm">{systemInfo.browser.platform}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Language</Label>
              <p className="text-sm">{systemInfo.browser.language}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Online Status</Label>
              <p className="text-sm">
                {systemInfo.browser.onlineStatus ? "🟢 Online" : "🔴 Offline"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Operating System Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Operating System Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Operating System</Label>
              <p className="text-sm">
                {systemInfo.os.name} {systemInfo.os.version}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Architecture</Label>
              <p className="text-sm">{systemInfo.os.architecture}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Support Status</Label>
              <div className="flex items-center gap-2">
                {systemInfo.os.isSupported ? (
                  <Badge
                    variant="default"
                    className="bg-green-100 text-green-800"
                  >
                    Supported
                  </Badge>
                ) : (
                  <Badge variant="destructive">Unsupported</Badge>
                )}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Security Updates</Label>
              <div className="flex items-center gap-2">
                {systemInfo.os.securityUpdateStatus === "current" && (
                  <Badge
                    variant="default"
                    className="bg-green-100 text-green-800"
                  >
                    Current
                  </Badge>
                )}
                {systemInfo.os.securityUpdateStatus === "extended" && (
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800"
                  >
                    Extended Support
                  </Badge>
                )}
                {systemInfo.os.securityUpdateStatus === "expired" && (
                  <Badge variant="destructive">Expired</Badge>
                )}
              </div>
            </div>
          </div>
          {systemInfo.os.supportEndDate && (
            <div>
              <Label className="text-sm font-medium">Support End Date</Label>
              <p className="text-sm">{systemInfo.os.supportEndDate}</p>
            </div>
          )}
          {systemInfo.os.buildNumber && (
            <div>
              <Label className="text-sm font-medium">Build Number</Label>
              <p className="text-sm font-mono">{systemInfo.os.buildNumber}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Screen Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Display Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Resolution</Label>
              <p className="text-sm">
                {systemInfo.screen.width} × {systemInfo.screen.height}
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Color Depth</Label>
              <p className="text-sm">{systemInfo.screen.colorDepth}-bit</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Pixel Ratio</Label>
              <p className="text-sm">{systemInfo.screen.pixelRatio}x</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Timezone</Label>
              <p className="text-sm">{systemInfo.timezone}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detection Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Detection Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <Label className="text-sm font-medium">Detection Timestamp</Label>
            <p className="text-sm font-mono">
              {new Date(systemInfo.detectionTimestamp).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeviceIdentificationGuide() {
  return (
    <div className="space-y-6">
      <Accordion type="single" collapsible className="w-full">
        {Object.entries(DEVICE_IDENTIFICATION_GUIDE).map(
          ([deviceType, guide]) => {
            const deviceInfo = DEVICE_TYPES.find(
              (type) => type.value === deviceType
            );
            return (
              <AccordionItem key={deviceType} value={deviceType}>
                <AccordionTrigger className="text-left">
                  <div className="flex items-center gap-2">
                    <span>{deviceInfo?.icon}</span>
                    {deviceInfo?.label}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Finding Device Name:</h4>
                    <p className="text-sm text-muted-foreground">
                      {guide.nameInstructions}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Finding Version/Model:</h4>
                    <p className="text-sm text-muted-foreground">
                      {guide.versionInstructions}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Examples:</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {guide.examples.map((example, index) => (
                        <li key={index}>• {example}</li>
                      ))}
                    </ul>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          }
        )}
      </Accordion>

      <div className="border rounded-lg p-4 bg-blue-50">
        <h4 className="font-medium text-blue-900 mb-2">General Tips:</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Look for stickers on the device with model information</li>
          <li>• Check system settings or "About" sections in your device</li>
          <li>• For Windows: Right-click "This PC" → Properties</li>
          <li>• For Mac: Apple Menu → About This Mac</li>
          <li>• For mobile devices: Settings → About Phone/Device</li>
          <li>• If unsure, provide as much detail as possible</li>
        </ul>
      </div>
    </div>
  );
}

function OSKeyGuide() {
  return (
    <div className="space-y-6">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="windows">
          <AccordionTrigger className="text-left">
            <div className="flex items-center gap-2">
              <span>🪟</span>
              Windows Product Keys
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Finding Your Windows Key:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • <strong>Command Prompt:</strong> Run "wmic path
                  softwarelicensingservice get OA3xOriginalProductKey"
                </li>
                <li>
                  • <strong>PowerShell:</strong> Run "(Get-WmiObject -query
                  'select * from
                  SoftwareLicensingService').OA3xOriginalProductKey"
                </li>
                <li>
                  • <strong>Registry:</strong> Check
                  HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows
                  NT\CurrentVersion
                </li>
                <li>
                  • <strong>Sticker:</strong> Look for a product key sticker on
                  your computer case
                </li>
                <li>
                  • <strong>Digital License:</strong> If linked to Microsoft
                  account, enter "Digital License"
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Key Formats:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • <strong>Windows 10/11:</strong>{" "}
                  XXXXX-XXXXX-XXXXX-XXXXX-XXXXX (25 characters)
                </li>
                <li>
                  • <strong>Digital License:</strong> "Digital License" or
                  "Linked to Microsoft Account"
                </li>
                <li>
                  • <strong>Volume License:</strong> Different format for
                  enterprise installations
                </li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="macos">
          <AccordionTrigger className="text-left">
            <div className="flex items-center gap-2">
              <span>🍎</span>
              macOS Activation
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">macOS Licensing:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• macOS doesn't use traditional product keys</li>
                <li>• Activation is tied to your Apple ID</li>
                <li>• Enter "Apple ID Linked" if you're signed in</li>
                <li>
                  • For enterprise: Check with your IT department for volume
                  licensing
                </li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="office">
          <AccordionTrigger className="text-left">
            <div className="flex items-center gap-2">
              <span>📄</span>
              Microsoft Office Keys
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Finding Office Keys:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • <strong>Office 365:</strong> Subscription-based, enter
                  "Office 365 Subscription"
                </li>
                <li>
                  • <strong>Retail Version:</strong> Check your purchase email
                  or product card
                </li>
                <li>
                  • <strong>Pre-installed:</strong> May be linked to Windows
                  product key
                </li>
                <li>
                  • <strong>Volume License:</strong> Contact your IT
                  administrator
                </li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="validation">
          <AccordionTrigger className="text-left">
            <div className="flex items-center gap-2">
              <span>✅</span>
              Key Validation
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Valid Key Formats:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • <strong>Standard:</strong> XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
                </li>
                <li>
                  • <strong>Digital:</strong> "Digital License", "Microsoft
                  Account Linked"
                </li>
                <li>
                  • <strong>Subscription:</strong> "Office 365", "Microsoft 365"
                </li>
                <li>
                  • <strong>Volume:</strong> Contact IT for enterprise keys
                </li>
              </ul>
            </div>
            <div className="border rounded-lg p-3 bg-yellow-50">
              <p className="text-sm text-yellow-800">
                <strong>Security Note:</strong> Product keys are encrypted and
                stored securely for compliance and audit purposes.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function BrowserVersionGuide() {
  return (
    <div>
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="chrome">
          <AccordionTrigger>Google Chrome</AccordionTrigger>
          <AccordionContent>
            1. Click the <strong>three dots</strong> (⋮) in the top-right
            corner.
            <br />
            2. Go to <strong>Help</strong> &gt;{" "}
            <strong>About Google Chrome</strong>.<br />
            3. The version number will be displayed at the top.
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="firefox">
          <AccordionTrigger>Mozilla Firefox</AccordionTrigger>
          <AccordionContent>
            1. Click the <strong>menu button</strong> (☰) in the top-right
            corner.
            <br />
            2. Select <strong>Help</strong> &gt; <strong>About Firefox</strong>.
            <br />
            3. A window will open showing the version number.
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="edge">
          <AccordionTrigger>Microsoft Edge</AccordionTrigger>
          <AccordionContent>
            1. Click the <strong>three dots</strong> (⋮) in the top-right
            corner.
            <br />
            2. Go to <strong>Help and feedback</strong> &gt;{" "}
            <strong>About Microsoft Edge</strong>.<br />
            3. The version will be shown on the page.
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="safari">
          <AccordionTrigger>Safari (Mac)</AccordionTrigger>
          <AccordionContent>
            1. Open Safari.
            <br />
            2. Click <strong>Safari</strong> in the top menu bar.
            <br />
            3. Select <strong>About Safari</strong>.<br />
            4. A small window will appear showing the version number.
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="opera">
          <AccordionTrigger>Opera</AccordionTrigger>
          <AccordionContent>
            1. Click the <strong>Opera logo</strong> in the top-left corner.
            <br />
            2. Go to <strong>Help</strong> &gt; <strong>About Opera</strong>.
            <br />
            3. The version number will be displayed.
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="brave">
          <AccordionTrigger>Brave</AccordionTrigger>
          <AccordionContent>
            1. Click the <strong>three lines</strong> (≡) or{" "}
            <strong>three dots</strong> in the top-right corner.
            <br />
            2. Go to <strong>Help</strong> &gt; <strong>About Brave</strong>.
            <br />
            3. The version will be listed on the page.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function PrivacyPolicyContent({ policy }) {
  return (
    <ScrollArea className="h-96">
      <div className="space-y-6 pr-4">
        <div>
          <h3 className="font-semibold mb-2">Privacy Policy</h3>
          <div className="text-sm text-muted-foreground whitespace-pre-line">
            {policy.content}
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="font-medium mb-2">How We Use Your Information:</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            {policy.dataUsage.map((usage, index) => (
              <li key={index}>• {usage}</li>
            ))}
          </ul>
        </div>

        <Separator />

        <div>
          <h4 className="font-medium mb-2">Data Retention:</h4>
          <p className="text-sm text-muted-foreground">
            {policy.retentionPeriod}
          </p>
        </div>

        <Separator />

        <div>
          <h4 className="font-medium mb-2">Your Rights:</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            {policy.userRights.map((right, index) => (
              <li key={index}>• {right}</li>
            ))}
          </ul>
        </div>

        <div className="border rounded-lg p-3 bg-gray-50">
          <p className="text-sm text-muted-foreground">
            <strong>Contact Information:</strong> For questions about this
            privacy policy or to exercise your rights, please contact our Data
            Protection Officer at info@cdc.construction or call 020-8004-3327.
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}

function FirewallGuide() {
  return (
    <Accordion type="single" collapsible className="w-full">
      {/* Windows Guide */}
      <AccordionItem value="windows">
        <AccordionTrigger>Windows (10 & 11)</AccordionTrigger>
        <AccordionContent>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              Press <strong>Windows + I</strong> to open{" "}
              <strong>Settings</strong>.
            </li>
            <li>
              Click on <strong>Update & Security</strong> &gt;{" "}
              <strong>Windows Security</strong>.
            </li>
            <li>
              Select <strong>Firewall & network protection</strong>.
            </li>
            <li>
              Choose your network profile: <em>Domain</em>, <em>Private</em>, or{" "}
              <em>Public</em>.
            </li>
            <li>
              Toggle <strong>Microsoft Defender Firewall</strong> to <em>On</em>{" "}
              or <em>Off</em>.
            </li>
            <li>Look for a green checkmark (enabled) or red X (disabled).</li>
          </ol>
        </AccordionContent>
      </AccordionItem>

      {/* Mac Guide */}
      <AccordionItem value="mac">
        <AccordionTrigger>Mac (macOS Ventura and earlier)</AccordionTrigger>
        <AccordionContent>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              Click the <strong>Apple menu</strong>  &gt;{" "}
              <strong>System Settings</strong> or{" "}
              <strong>System Preferences</strong>.
            </li>
            <li>
              Go to <strong>Network</strong> or{" "}
              <strong>Security & Privacy</strong> &gt; <strong>Firewall</strong>
              .
            </li>
            <li>
              Click the <strong>lock icon</strong> 🔒 and enter your admin
              password.
            </li>
            <li>
              Click <strong>Turn On Firewall</strong> or{" "}
              <strong>Turn Off Firewall</strong>.
            </li>
            <li>Check the status to confirm if it’s enabled or disabled.</li>
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function SuccessfulSubmit({
  showSuccessDialog,
  setShowSuccessDialog,
  submissionId,
}) {
  return (
    <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
      <DialogContent className={"sm:max-w-md"}>
        <div className="flex items-center justify-center">
          <div>
            {/* Illustration */}
            <div className="flex justify-center mb-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                version="1.0"
                viewBox="0 0 517.000000 506.000000"
              >
                <g
                  transform="translate(0.000000,506.000000) scale(0.100000,-0.100000)"
                  fill="#000000"
                  stroke="none"
                >
                  <path d="M2730 4380 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M2777 4203 c-4 -3 -7 -13 -7 -21 0 -8 -6 -28 -14 -45 -13 -31 -36 -106 -42 -137 -2 -8 -6 -34 -10 -57 -4 -24 -10 -43 -13 -43 -10 0 -71 64 -71 74 0 5 -25 40 -56 78 -84 104 -90 98 -86 -97 2 -137 0 -157 -12 -142 -7 9 -19 17 -27 17 -8 0 -29 9 -47 20 -41 25 -62 25 -62 1 0 -11 -6 -22 -12 -24 -10 -4 -10 -6 -1 -6 17 -1 67 -101 51 -101 -7 0 -67 9 -133 20 -154 26 -185 26 -185 2 0 -12 18 -29 50 -46 28 -15 50 -31 50 -37 0 -5 7 -9 15 -9 16 0 110 -53 138 -78 10 -9 25 -17 33 -18 18 -3 30 -12 23 -18 -2 -2 -52 -27 -111 -56 -79 -38 -108 -57 -108 -70 0 -14 11 -20 50 -25 27 -4 53 -11 56 -16 3 -5 10 -7 15 -3 10 6 79 -14 79 -23 0 -3 -16 -23 -35 -44 -51 -56 -50 -58 33 -79 l43 -11 -18 -31 c-37 -64 -382 -374 -397 -357 -2 2 -6 41 -8 85 -5 81 -4 82 24 99 36 21 55 63 36 81 -7 7 -49 23 -93 36 -77 24 -80 25 -81 56 -3 68 -20 77 -69 37 -30 -25 -21 -34 15 -15 13 7 19 6 24 -5 15 -40 -22 -59 -56 -28 -13 12 -22 13 -29 6 -8 -8 -8 -13 0 -17 12 -8 15 -56 4 -56 -5 0 -9 -17 -10 -38 l-3 -37 25 28 c14 15 25 39 25 53 0 16 6 24 17 24 25 0 193 -61 193 -70 0 -4 -15 -19 -34 -33 l-34 -26 5 -88 6 -88 -102 -2 c-55 -1 -101 1 -101 5 1 4 7 18 15 32 20 36 19 70 -3 70 -27 0 -62 29 -62 51 0 21 12 24 41 8 23 -12 49 3 49 28 0 13 -3 13 -15 3 -10 -8 -19 -9 -27 -3 -7 6 -25 13 -39 17 -22 5 -28 2 -33 -17 -12 -46 -6 -66 29 -94 34 -27 46 -53 24 -53 -6 0 -9 -7 -5 -15 3 -10 -2 -17 -17 -20 -16 -5 -44 7 -94 37 -83 52 -103 70 -103 95 0 22 44 75 78 92 13 7 22 21 22 35 0 36 33 70 89 90 46 16 99 62 86 74 -7 8 -147 -58 -172 -80 -12 -11 -27 -34 -34 -51 -7 -17 -32 -50 -55 -72 -79 -75 -72 -130 24 -183 35 -19 62 -36 60 -37 -2 -2 -43 8 -93 21 -119 33 -306 48 -372 31 -61 -16 -116 -57 -137 -102 -9 -19 -26 -78 -37 -132 -16 -78 -19 -112 -12 -168 4 -38 7 -85 5 -103 -2 -19 1 -39 7 -46 7 -8 4 -29 -10 -67 -17 -45 -28 -60 -65 -82 -52 -31 -58 -67 -14 -77 15 -4 26 -15 30 -30 5 -21 12 -25 45 -26 l39 0 12 -60 c19 -95 90 -254 139 -315 25 -29 45 -61 45 -70 0 -26 -278 -235 -390 -294 -65 -33 -120 -84 -120 -109 0 -23 64 -78 129 -111 l33 -17 -24 -26 c-43 -47 -88 -115 -88 -133 0 -19 80 -95 174 -166 33 -25 79 -63 101 -83 46 -44 161 -107 211 -116 32 -6 64 7 64 26 0 4 -20 35 -45 69 -25 34 -45 68 -45 76 0 8 -9 19 -20 25 -15 8 -19 17 -15 31 5 14 0 21 -19 28 -18 8 -23 15 -19 30 4 16 1 21 -16 21 -15 0 -27 13 -43 45 -12 24 -19 47 -16 50 3 3 28 -6 57 -20 78 -40 183 -75 197 -67 50 28 264 381 317 524 27 69 47 108 59 108 4 0 45 -39 93 -87 l86 -88 -6 -65 c-12 -145 -25 -370 -25 -448 0 -79 1 -83 26 -92 14 -6 65 -10 113 -10 l88 0 6 -58 c4 -31 12 -79 19 -107 l13 -50 52 -3 c28 -2 108 6 177 18 70 11 139 20 155 20 43 0 154 38 205 70 74 48 58 77 -48 87 -36 3 -71 12 -77 19 -8 10 -15 11 -30 1 -17 -10 -23 -9 -35 8 -12 17 -17 18 -35 7 -18 -11 -23 -11 -33 4 -10 14 -16 14 -33 4 -13 -8 -30 -10 -49 -5 -26 6 -20 9 51 26 53 13 88 28 104 44 24 23 24 26 12 82 -6 32 -27 105 -46 163 -19 58 -45 143 -59 190 -35 123 -110 313 -153 389 -44 80 -208 327 -223 336 -16 10 -12 22 10 28 14 4 20 14 20 34 l1 28 33 -39 c41 -48 56 -44 90 23 14 27 30 52 36 56 5 3 10 17 10 31 0 23 -14 50 -78 147 -14 20 -23 39 -21 41 2 1 33 25 69 52 36 27 90 77 121 109 94 100 257 324 304 419 l44 89 17 -41 c19 -50 33 -53 57 -12 21 36 25 36 70 10 l35 -21 -15 -48 c-29 -90 4 -141 92 -141 56 0 87 -19 100 -61 3 -10 23 -23 43 -30 22 -7 62 -37 97 -73 33 -34 74 -73 91 -87 29 -24 188 -89 219 -89 8 0 28 -21 46 -46 l31 -46 -21 -22 c-12 -13 -24 -43 -28 -71 -6 -45 -4 -50 23 -71 l28 -23 -60 -54 c-68 -62 -174 -205 -212 -287 -51 -112 -53 -281 -3 -351 l19 -25 -59 -99 c-33 -55 -59 -103 -59 -107 0 -13 -49 -116 -80 -169 -35 -58 -38 -89 -10 -114 15 -14 17 -22 9 -37 -14 -26 11 -64 54 -82 l32 -14 -29 -11 c-28 -11 -184 -41 -320 -61 -65 -10 -80 -19 -74 -46 7 -40 369 -109 447 -85 20 6 49 23 65 38 l29 27 24 -30 c12 -16 26 -37 29 -46 3 -10 13 -18 22 -18 13 0 20 16 30 67 8 40 23 80 37 99 21 28 31 32 84 36 73 5 105 28 98 71 -3 24 1 30 37 46 67 29 104 68 140 146 19 41 48 94 65 119 l32 46 74 -3 c61 -2 78 1 102 19 16 12 43 25 59 28 37 8 84 55 115 115 21 40 23 42 36 25 35 -47 43 -165 18 -248 -19 -62 -19 -100 -1 -115 22 -19 48 0 104 76 52 69 86 152 98 241 10 77 0 100 -51 123 -25 11 -45 26 -45 33 0 8 22 29 50 47 56 39 69 75 23 65 -16 -3 -70 -13 -121 -22 -89 -15 -94 -14 -107 3 -15 20 -14 23 27 73 31 40 105 216 114 272 6 34 9 37 34 32 15 -4 31 -1 34 5 4 6 16 11 27 11 10 0 24 9 31 20 7 11 23 20 35 20 14 0 28 10 37 28 8 15 17 26 20 25 33 -15 41 39 20 137 l-17 79 32 26 c23 20 31 35 31 61 0 29 5 36 39 54 50 25 71 55 71 100 0 42 -20 75 -60 95 -27 14 -28 18 -19 43 6 15 11 59 12 97 1 108 -38 170 -129 205 -81 30 -165 35 -284 16 -58 -9 -130 -17 -160 -19 -30 -2 -81 -10 -113 -17 -57 -13 -58 -13 -87 15 -17 16 -30 35 -30 42 0 7 -4 13 -10 13 -19 0 -10 33 15 56 30 27 41 68 29 103 -8 23 -16 27 -68 31 -49 5 -62 10 -80 34 -69 91 -109 107 -157 66 l-24 -21 46 7 47 6 42 -56 c23 -30 50 -58 61 -61 10 -4 19 -15 19 -27 0 -19 2 -18 31 7 38 31 53 28 57 -12 4 -39 -41 -81 -65 -61 -12 10 -18 9 -29 -7 -31 -42 -6 -93 40 -81 18 4 25 1 29 -14 4 -17 0 -20 -24 -20 -16 0 -47 -13 -70 -29 -53 -39 -87 -45 -155 -30 -54 12 -58 15 -77 58 -12 28 -22 76 -25 121 -4 66 -1 82 22 129 25 54 27 76 4 53 -20 -20 -28 -14 -28 23 0 31 5 38 37 53 27 13 37 14 40 5 7 -20 26 -15 52 12 19 20 33 25 75 25 28 0 61 -6 72 -14 28 -20 104 -41 136 -38 14 2 29 -2 33 -7 8 -14 25 -14 25 -1 0 6 -6 10 -14 10 -8 0 -16 7 -20 15 -3 9 -18 15 -36 15 -17 0 -61 14 -97 31 -56 26 -74 30 -112 25 -25 -3 -58 -15 -73 -26 -15 -11 -42 -20 -60 -20 -71 0 -106 -51 -83 -125 9 -32 11 -56 4 -78 -12 -42 -11 -134 1 -177 9 -30 8 -37 -10 -49 -11 -7 -20 -19 -20 -27 0 -20 -152 65 -231 130 -76 62 -89 78 -118 153 l-21 53 39 26 c44 29 58 52 36 60 -25 10 -17 20 28 39 74 31 86 38 92 53 9 24 -14 32 -92 32 -40 0 -73 4 -73 9 0 5 12 17 27 27 15 9 79 67 143 129 63 61 130 121 148 134 40 28 58 59 43 74 -13 13 -91 -1 -204 -35 -39 -12 -78 -17 -93 -14 -15 4 -23 3 -20 -2 5 -9 -122 -47 -130 -39 -4 4 -1 15 51 163 56 162 47 185 -44 114 -28 -23 -56 -38 -61 -35 -5 3 -7 0 -4 -8 6 -16 -68 -81 -101 -89 -20 -5 -22 2 -33 105 -6 60 -9 114 -5 120 3 6 1 7 -5 3 -9 -5 -12 7 -12 39 0 62 -21 101 -43 78z m270 -605 c-2 -13 -4 -3 -4 22 0 25 2 35 4 23 2 -13 2 -33 0 -45z m-335 -66 c7 3 17 20 24 39 l12 34 1 -48 c1 -40 4 -48 18 -45 9 2 21 14 25 28 4 14 5 -8 2 -49 -8 -104 -61 -265 -94 -286 -5 -3 -15 6 -22 20 -6 14 -37 42 -67 60 l-56 35 5 72 c5 69 6 73 28 70 20 -3 22 1 23 50 1 29 5 64 9 78 8 25 8 24 9 -5 3 -68 34 -71 45 -4 11 67 21 69 24 6 2 -38 7 -57 14 -55z m118 87 c0 -5 -4 -9 -10 -9 -5 0 -10 7 -10 16 0 8 5 12 10 9 6 -3 10 -10 10 -16z m56 -54 c12 -50 -1 -134 -25 -156 -34 -32 -55 -99 -31 -99 6 0 10 7 10 16 0 8 18 33 40 55 22 22 40 48 40 59 0 10 3 26 6 35 12 31 21 -5 13 -48 -14 -74 -10 -126 13 -166 l22 -38 -40 -47 c-35 -42 -101 -94 -108 -85 -6 9 -48 135 -47 144 1 32 46 163 62 181 23 24 25 38 4 30 -20 -7 -20 20 0 58 8 15 15 41 15 57 0 36 17 38 26 4z m-317 -304 c11 -7 10 -13 -4 -35 -20 -30 -37 -33 -55 -11 -20 24 -24 10 -6 -18 15 -22 15 -25 0 -38 -10 -8 -41 -45 -69 -84 -72 -96 -122 -146 -140 -139 -20 8 -19 2 6 -40 23 -40 44 -48 34 -13 -12 38 -11 42 16 45 20 2 26 8 23 20 -3 9 6 29 18 43 13 15 44 56 70 93 46 64 80 84 91 54 2 -7 8 -9 13 -5 4 4 3 16 -3 25 -10 16 -1 36 34 81 6 9 43 -33 43 -49 0 -9 -16 -34 -36 -56 -20 -21 -60 -69 -90 -106 -29 -37 -58 -69 -63 -72 -5 -4 -21 -37 -36 -75 -22 -58 -36 -77 -88 -122 -34 -29 -69 -60 -77 -69 -8 -8 -32 -28 -53 -43 -45 -34 -99 -107 -151 -202 -21 -38 -46 -79 -56 -90 -9 -11 -20 -33 -24 -49 -4 -16 -16 -36 -28 -45 -17 -15 -18 -18 -5 -29 15 -13 10 -53 -20 -139 -16 -48 -33 -53 -105 -32 -43 11 -46 19 -19 43 10 10 22 33 25 52 4 18 16 53 26 76 11 24 20 55 20 69 0 67 41 182 85 245 25 34 50 66 56 70 6 3 18 18 27 33 17 27 156 158 199 188 21 14 24 14 42 -8 31 -39 35 -14 5 31 -18 27 -30 37 -33 29 -5 -16 -27 -37 -127 -124 -38 -33 -71 -64 -73 -70 -2 -5 -27 -35 -56 -65 -91 -98 -116 -137 -132 -206 -10 -45 -22 -69 -36 -79 -30 -19 -134 -35 -242 -36 -102 -1 -83 -16 22 -18 l62 -1 -30 -52 c-41 -70 -58 -88 -83 -88 -31 0 -166 67 -166 82 0 6 14 27 32 45 21 22 27 33 17 33 -8 0 -30 -16 -49 -35 -21 -22 -40 -33 -50 -30 -37 15 -110 72 -110 87 0 16 57 68 75 68 4 0 29 17 54 37 25 21 57 47 71 58 54 43 120 116 139 154 29 56 68 81 129 81 28 0 53 -4 56 -9 3 -5 -22 -40 -57 -77 -34 -38 -74 -91 -87 -118 -14 -27 -38 -61 -53 -77 -25 -26 -36 -29 -88 -29 -75 0 -77 -16 -2 -26 74 -9 201 1 285 23 69 18 92 40 37 35 -16 -1 -29 2 -29 7 0 5 22 47 49 93 27 45 52 99 56 118 10 49 22 68 46 75 83 27 357 244 451 358 120 145 174 185 217 158z m506 -108 c51 -106 161 -213 282 -276 125 -64 133 -65 133 -28 0 24 4 31 19 31 24 0 32 -22 25 -68 -7 -45 -10 -48 -29 -32 -12 10 -15 10 -15 -3 0 -16 50 -57 70 -57 6 0 9 -4 6 -8 -3 -5 25 -8 62 -7 41 2 70 -2 74 -9 5 -7 8 -6 8 4 0 10 21 21 59 32 76 23 125 74 119 125 -3 20 0 32 6 30 6 -2 10 -16 8 -30 l-3 -27 35 21 c26 15 71 24 168 35 73 7 167 19 208 25 133 19 256 -12 300 -78 22 -32 25 -46 23 -112 -1 -42 -3 -92 -5 -110 -3 -30 2 -38 32 -59 37 -25 54 -55 45 -81 -3 -9 -30 -31 -60 -49 -50 -30 -54 -35 -57 -75 -3 -38 -6 -43 -38 -54 -79 -27 -273 -1 -319 43 -17 16 -9 39 41 116 33 51 50 62 82 52 16 -5 18 -3 10 6 -9 9 -8 19 4 39 8 15 13 35 9 44 -9 25 -42 21 -55 -7 -14 -32 -67 -70 -122 -88 -33 -11 -45 -20 -45 -34 0 -15 6 -18 33 -16 l32 4 -21 -36 c-13 -23 -19 -48 -17 -73 2 -32 8 -40 35 -53 41 -19 46 -61 10 -84 -31 -21 -139 -55 -196 -62 -25 -3 -62 -8 -81 -11 -121 -18 -292 -18 -350 -1 -8 3 -33 8 -55 13 -51 10 -60 15 -44 26 10 6 11 9 2 9 -21 0 -15 20 17 57 17 18 30 41 30 51 0 29 -12 62 -22 62 -5 0 -20 12 -32 27 -18 21 -26 45 -31 96 -8 84 -29 87 -33 4 -2 -31 -4 -57 -5 -57 -1 0 -37 13 -79 29 -83 33 -178 95 -178 117 0 8 -5 13 -12 12 -6 -2 -21 12 -32 29 -14 21 -34 36 -58 43 -27 8 -46 23 -68 55 -30 44 -67 62 -117 56 -26 -3 -63 31 -63 58 0 11 5 32 11 47 13 35 4 72 -19 82 -9 4 -32 17 -50 27 -29 17 -32 24 -27 49 3 16 13 38 22 48 20 22 45 24 37 3 -10 -24 24 -29 68 -9 38 17 121 104 148 155 6 11 15 17 19 14 5 -3 26 -39 46 -82z m-415 -30 c0 -19 -12 -39 -40 -64 -24 -22 -40 -46 -40 -59 0 -29 -60 -143 -121 -227 -26 -38 -66 -93 -87 -123 -73 -101 -156 -193 -227 -251 -103 -83 -193 -127 -138 -66 11 12 33 45 48 72 75 134 111 179 224 277 118 103 142 133 161 201 6 21 26 55 43 75 18 20 46 54 61 76 39 52 98 116 108 116 4 0 8 -12 8 -27z m1189 -258 c3 -19 -26 -85 -39 -85 -9 0 -12 88 -4 101 10 16 38 5 43 -16z m-59 -42 c0 -40 -23 -73 -52 -73 -20 0 -26 34 -7 46 8 4 7 9 -2 16 -10 6 -10 11 -3 14 6 3 20 11 30 19 29 22 34 18 34 -22z m-2361 11 c133 -20 133 -20 129 -41 -4 -23 -60 -31 -218 -33 -152 -1 -197 -10 -226 -46 -13 -16 -23 -38 -23 -49 l0 -20 9 20 c5 11 18 31 29 45 20 25 21 25 233 32 117 4 221 5 232 2 16 -5 14 -10 -16 -43 -19 -20 -45 -52 -57 -72 -24 -41 -177 -176 -237 -209 -21 -12 -51 -33 -66 -47 l-26 -25 -36 27 c-20 15 -36 31 -36 35 0 5 14 13 30 19 17 5 30 14 30 20 0 5 24 20 53 34 51 24 215 172 203 184 -3 3 -18 1 -33 -5 -15 -6 -55 -13 -87 -16 -36 -3 -70 -13 -85 -24 -26 -19 -64 -82 -74 -124 -4 -14 -18 -28 -37 -35 -34 -13 -52 -49 -38 -75 7 -14 5 -18 -10 -18 -17 0 -18 7 -15 58 3 31 11 74 19 95 15 41 19 97 6 82 -16 -18 -31 -89 -38 -173 -4 -45 -11 -85 -16 -88 -17 -11 -49 7 -43 25 3 10 -2 37 -10 61 -20 58 -19 138 4 207 10 32 24 76 30 99 22 80 86 113 225 114 48 0 136 -7 195 -16z m2166 4 c14 -6 25 -16 25 -21 0 -5 6 -4 14 2 8 7 27 11 43 9 26 -3 28 -6 27 -48 0 -42 -2 -45 -30 -48 -27 -3 -31 1 -41 35 l-10 38 -2 -38 c-1 -36 -2 -37 -28 -31 -36 9 -43 20 -43 72 0 45 5 48 45 30z m-1820 -38 c81 0 125 -7 125 -19 0 -4 -14 -15 -30 -25 -25 -14 -43 -16 -98 -11 -105 10 -170 25 -176 40 -8 22 22 33 63 24 20 -5 72 -9 116 -9z m61 -121 c-4 -23 -15 -54 -25 -68 -10 -14 -35 -58 -56 -98 -34 -66 -40 -72 -80 -82 -24 -6 -63 -11 -87 -11 -36 1 -40 3 -27 13 8 7 34 47 58 90 23 42 46 77 51 77 5 0 30 27 56 60 41 53 51 60 82 60 l35 0 -7 -41z m-482 -61 c-8 -17 -83 -82 -89 -76 -2 2 -2 20 2 40 5 32 10 37 37 41 17 2 36 5 43 5 7 1 10 -4 7 -10z m-104 -13 c0 -17 -46 -95 -57 -95 -7 0 -13 2 -13 5 0 8 31 68 42 83 10 12 28 17 28 7z m-115 -275 c10 -17 142 -119 169 -131 14 -7 23 -17 19 -22 -4 -6 0 -8 11 -4 11 4 36 -3 64 -18 87 -45 178 -83 258 -104 43 -12 86 -24 94 -28 8 -3 22 -7 30 -8 8 -1 40 -7 70 -14 55 -11 57 -13 124 -104 96 -131 166 -240 214 -332 43 -85 118 -286 156 -420 13 -44 38 -131 56 -193 39 -133 40 -132 -65 -155 -129 -30 -289 -43 -449 -38 l-49 1 7 168 c11 241 14 301 21 352 8 55 -7 76 -151 219 -54 53 -93 99 -90 107 3 8 0 11 -10 7 -13 -5 -19 8 -15 30 1 5 -3 6 -8 2 -11 -6 -67 52 -63 66 1 5 -1 8 -5 8 -25 -4 -35 2 -29 18 4 10 4 14 0 10 -9 -9 -64 42 -64 60 0 7 -6 13 -13 13 -16 0 -59 44 -52 53 3 4 2 5 -1 2 -4 -2 -15 0 -25 6 -21 11 -28 -5 -8 -17 8 -4 7 -9 -2 -16 -11 -8 -10 -9 2 -5 20 7 59 -32 59 -57 0 -9 5 -14 10 -11 6 3 10 2 10 -3 0 -5 43 -53 95 -108 53 -56 95 -108 95 -119 0 -10 -13 -46 -29 -80 -17 -33 -46 -94 -65 -135 -48 -104 -176 -319 -221 -373 l-37 -44 -81 30 c-45 16 -105 45 -133 63 -29 18 -103 61 -165 95 -63 34 -127 71 -142 82 l-28 19 26 28 c15 15 45 36 68 46 37 16 190 118 272 181 17 13 35 27 40 31 6 4 36 29 67 56 l57 49 -16 31 c-9 17 -19 33 -23 36 -20 15 -90 114 -90 128 0 8 -6 23 -14 31 -8 9 -27 52 -42 96 -22 65 -28 98 -28 179 -1 71 3 100 12 103 6 3 12 9 12 14 0 6 -4 7 -10 4 -27 -17 10 90 42 120 23 22 47 20 63 -5z m695 -27 c0 -23 -39 -151 -58 -190 -18 -39 -24 -39 -113 -13 -73 22 -82 35 -48 66 11 10 32 42 46 71 23 46 31 53 62 58 20 3 50 10 66 14 44 13 45 13 45 -6z m-836 -1 c2 -4 -2 -32 -10 -62 -8 -30 -14 -70 -14 -90 0 -24 -6 -39 -20 -48 -22 -13 -27 -3 -9 15 7 7 9 19 5 28 -5 13 -14 15 -38 10 l-33 -6 33 21 c17 12 35 34 38 49 17 79 33 107 48 83z m3357 -58 c29 -10 69 -14 118 -12 l74 3 12 -41 c18 -62 26 -124 16 -124 -5 0 -14 14 -20 31 -16 45 -33 27 -25 -27 8 -57 -11 -59 -27 -4 -18 60 -35 44 -31 -28 4 -64 -12 -87 -24 -34 -12 55 -21 76 -33 80 -10 3 -12 -9 -6 -57 4 -36 3 -61 -2 -61 -10 0 -38 89 -48 153 -8 53 -29 42 -33 -16 -3 -48 -9 -56 -30 -35 -13 13 -17 169 -5 181 9 10 15 9 64 -9z m-2352 -76 c11 -50 11 -52 -18 -82 -24 -25 -28 -35 -19 -50 9 -16 7 -17 -13 -11 -33 10 -32 7 -15 67 8 29 20 72 26 96 6 23 15 40 20 37 4 -3 13 -28 19 -57z m2279 -127 c60 -51 59 -83 -10 -263 -37 -97 -49 -117 -126 -205 -47 -54 -103 -116 -125 -138 -89 -88 -244 -312 -297 -429 -19 -43 -40 -71 -71 -94 -50 -38 -63 -40 -53 -9 4 12 10 37 15 55 4 18 23 59 42 91 19 33 42 84 51 115 18 61 99 165 176 226 23 18 66 62 95 99 30 36 78 93 109 125 56 61 160 238 170 291 5 25 3 23 -13 -12 -42 -91 -123 -212 -189 -283 -38 -41 -89 -98 -113 -127 -25 -28 -66 -71 -93 -94 -81 -71 -144 -155 -161 -212 -8 -29 -29 -72 -45 -97 -38 -56 -60 -105 -60 -135 0 -12 -9 -34 -21 -49 -19 -24 -26 -26 -100 -26 -94 0 -92 -7 -28 121 22 43 39 82 39 86 0 5 13 24 30 43 16 19 29 43 30 52 0 9 16 38 36 64 44 57 86 146 75 157 -10 10 -121 -3 -121 -14 0 -5 20 -9 45 -9 25 0 45 -2 45 -5 0 -19 -35 -83 -65 -117 -19 -23 -35 -48 -35 -57 0 -8 -11 -26 -24 -40 -13 -15 -36 -53 -49 -86 -81 -192 -73 -180 -108 -183 -18 -2 -47 -1 -65 2 -58 11 -53 53 24 180 22 36 72 130 111 210 39 79 77 149 84 155 7 5 54 13 105 17 61 5 91 11 89 18 -4 11 -84 12 -162 1 -36 -5 -44 -12 -76 -63 -20 -31 -47 -79 -59 -107 -12 -27 -27 -59 -33 -70 -6 -11 -26 -47 -43 -80 -17 -33 -46 -85 -64 -115 -18 -30 -35 -74 -38 -97 -4 -35 -8 -43 -25 -43 -46 0 -4 -10 120 -30 73 -11 147 -20 166 -20 23 0 41 -8 56 -24 l23 -24 -23 -13 c-30 -15 -159 -7 -298 20 -110 22 -133 33 -113 53 21 21 14 54 -14 67 -14 6 -24 15 -22 19 2 4 21 43 44 87 22 44 47 96 54 115 8 19 26 55 40 80 211 360 255 420 450 621 77 79 140 148 140 152 0 16 -50 -21 -126 -92 -43 -40 -80 -68 -82 -63 -5 17 26 76 64 120 42 50 45 66 3 26 -40 -38 -64 -77 -84 -139 -9 -27 -29 -63 -44 -80 -55 -60 -157 -193 -201 -263 -25 -39 -47 -72 -51 -72 -3 0 -13 21 -22 48 -14 39 -15 60 -7 130 11 96 28 137 99 247 53 81 176 229 199 239 7 3 25 1 40 -5 l27 -11 -21 -16 c-12 -9 -30 -22 -40 -29 -18 -11 -18 -12 2 -12 12 -1 37 10 56 22 30 21 50 24 184 31 82 3 168 10 192 15 23 5 42 6 42 2 0 -7 -99 -143 -128 -176 -10 -11 -73 -72 -142 -135 -156 -145 -230 -220 -230 -235 0 -7 -10 -17 -22 -24 -19 -9 -11 -11 47 -6 39 3 85 5 103 5 17 0 32 5 32 11 0 8 -21 10 -64 7 l-65 -4 17 29 c9 16 58 65 107 108 134 116 235 224 301 319 32 46 67 93 76 102 23 23 58 24 58 1 0 -21 75 -111 84 -102 4 4 -7 27 -24 52 -40 60 -39 74 13 96 l42 18 6 -45 c4 -35 13 -51 37 -71z m-90 -536 c38 -83 -34 -265 -105 -265 -28 0 -28 4 -4 44 27 44 61 149 61 189 0 30 14 57 30 57 4 0 12 -11 18 -25z m-68 -74 c0 -11 -10 -21 -22 -25 -47 -12 -52 -6 -23 24 29 31 45 31 45 1z m-20 -49 c0 -28 -28 -60 -62 -70 -41 -13 -68 -15 -68 -6 0 3 12 23 28 45 23 33 32 39 65 39 20 0 37 -4 37 -8z m-50 -97 c0 -19 -37 -76 -53 -81 -21 -7 -97 -8 -103 -2 -2 2 8 21 21 41 22 31 31 36 72 40 27 2 51 4 56 5 4 1 7 0 7 -3z m-3225 -298 c-11 -83 9 -95 128 -73 5 0 20 -16 33 -37 21 -32 22 -38 9 -43 -25 -10 -17 -24 14 -24 16 0 31 -6 35 -15 4 -10 -1 -15 -14 -15 -11 0 -20 -4 -20 -9 0 -12 27 -22 44 -15 7 3 16 -2 19 -10 4 -10 1 -16 -8 -16 -8 0 -15 -4 -15 -10 0 -5 11 -10 24 -10 17 0 36 -14 62 -45 20 -25 34 -48 31 -51 -11 -12 -117 45 -164 88 -26 24 -79 68 -118 98 -38 30 -87 69 -107 88 l-37 34 40 59 c22 33 42 59 45 59 3 0 2 -24 -1 -53z m1466 -309 c31 -9 38 -15 33 -30 -7 -24 13 -23 26 2 16 30 44 26 36 -5 -8 -31 1 -32 30 -4 25 23 53 17 33 -7 -17 -20 9 -19 32 2 15 13 29 14 81 7 l63 -9 -71 -27 c-39 -15 -106 -32 -150 -37 -43 -5 -115 -16 -159 -24 -44 -9 -98 -15 -120 -16 l-40 0 -13 53 c-20 89 -17 94 29 48 23 -22 47 -41 54 -41 14 0 85 77 85 92 0 11 5 10 51 -4z m793 -4 c3 -8 2 -12 -4 -9 -6 3 -10 10 -10 16 0 14 7 11 14 -7z m-47 -26 c-3 -8 -6 -5 -6 6 -1 11 2 17 5 13 3 -3 4 -12 1 -19z" />
                  <path d="M3360 2830 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M3128 2755 c-20 -14 -42 -25 -48 -25 -6 0 -9 -4 -5 -9 11 -19 105 28 105 51 0 14 -14 9 -52 -17z" />
                  <path d="M4500 2746 c-14 -8 -27 -13 -31 -11 -3 2 -6 -2 -6 -9 0 -11 9 -10 39 4 21 9 41 20 45 23 12 12 -21 7 -47 -7z" />
                  <path d="M3175 2717 c-40 -30 -44 -51 -5 -29 16 9 30 22 30 29 0 6 6 14 13 16 6 3 8 6 2 6 -5 0 -23 -10 -40 -22z" />
                  <path d="M4285 2700 c3 -5 8 -10 11 -10 2 0 4 5 4 10 0 6 -5 10 -11 10 -5 0 -7 -4 -4 -10z" />
                  <path d="M4485 2691 c-3 -8 -4 -15 -2 -17 5 -5 67 19 67 27 0 13 -60 4 -65 -10z" />
                  <path d="M3200 2660 c0 -5 6 -10 14 -10 8 0 18 5 21 10 3 6 -3 10 -14 10 -12 0 -21 -4 -21 -10z" />
                  <path d="M3845 2645 c-16 -8 -27 -14 -23 -15 4 0 -7 -28 -25 -62 -18 -35 -33 -69 -33 -75 -3 -46 -5 -53 -14 -53 -5 0 -10 6 -10 13 0 18 -97 125 -120 132 -63 20 -81 -44 -33 -116 32 -49 170 -169 193 -169 15 0 56 54 95 126 40 71 59 196 33 222 -15 15 -25 14 -63 -3z" />
                  <path d="M4495 2630 c-3 -5 3 -10 14 -10 12 0 21 5 21 10 0 6 -6 10 -14 10 -8 0 -18 -4 -21 -10z" />
                  <path d="M1100 2231 c0 -5 7 -14 15 -21 8 -7 15 -18 15 -25 0 -7 9 -15 21 -18 14 -4 18 -10 13 -19 -4 -7 -4 -10 1 -6 13 12 34 -12 28 -30 -6 -15 -4 -15 9 -4 11 9 18 10 23 2 8 -13 45 -13 45 0 0 5 -17 21 -37 35 -21 14 -33 25 -28 26 6 1 -1 4 -15 8 -14 4 -24 13 -22 20 1 7 -2 10 -6 7 -5 -3 -17 3 -27 14 -19 21 -35 26 -35 11z" />
                  <path d="M1398 2021 c18 -15 43 -32 55 -38 111 -51 147 -56 147 -22 0 11 -4 18 -10 14 -5 -3 -26 2 -47 11 -21 9 -59 22 -85 30 -26 8 -50 19 -53 24 -3 6 -14 10 -23 10 -12 -1 -8 -8 16 -29z" />
                  <path d="M1680 1880 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M1150 1810 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M1290 1740 c0 -5 5 -10 11 -10 5 0 7 5 4 10 -3 6 -8 10 -11 10 -2 0 -4 -4 -4 -10z" />
                  <path d="M1271 1591 c-12 -8 104 -74 121 -69 14 5 -59 63 -88 70 -12 3 -27 3 -33 -1z" />
                  <path d="M1260 1515 c0 -7 81 -65 92 -65 22 0 4 27 -32 48 -37 21 -60 28 -60 17z" />
                  <path d="M2057 1463 c-31 -20 -54 -40 -51 -44 2 -5 21 3 41 17 20 13 38 22 41 19 3 -2 -11 -26 -32 -51 -53 -69 -47 -83 17 -40 20 14 47 30 59 37 22 12 22 11 -4 -23 -15 -20 -24 -38 -21 -41 9 -10 82 75 83 96 0 22 -11 22 -54 -4 -36 -21 -50 -13 -21 11 16 13 21 60 6 60 -4 0 -33 -17 -64 -37z" />
                  <path d="M1220 1420 c0 -5 5 -10 11 -10 5 0 7 5 4 10 -3 6 -8 10 -11 10 -2 0 -4 -4 -4 -10z" />
                  <path d="M2110 979 c0 -5 5 -7 10 -4 6 3 10 8 10 11 0 2 -4 4 -10 4 -5 0 -10 -5 -10 -11z" />
                  <path d="M2080 960 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M1700 2220 c-8 -5 -11 -12 -8 -16 11 -10 60 5 53 16 -8 12 -26 12 -45 0z" />
                  <path d="M4150 1971 c0 -4 -35 -44 -77 -88 -79 -81 -213 -233 -268 -303 -16 -21 -46 -53 -67 -70 -20 -17 -41 -44 -46 -60 -9 -25 -2 -20 51 33 34 34 70 74 82 89 24 33 160 183 261 291 84 88 103 117 79 117 -8 0 -15 -4 -15 -9z" />
                  <path d="M3518 1943 c-80 -87 -188 -289 -188 -352 0 -55 16 -53 22 3 7 61 85 215 153 304 55 71 63 98 13 45z" />
                  <path d="M2475 4180 c3 -5 8 -10 11 -10 2 0 4 5 4 10 0 6 -5 10 -11 10 -5 0 -7 -4 -4 -10z" />
                  <path d="M2270 4050 c0 -5 7 -10 16 -10 8 0 12 5 9 10 -3 6 -10 10 -16 10 -5 0 -9 -4 -9 -10z" />
                  <path d="M2210 3920 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M2010 3790 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M3816 3613 c3 -59 8 -110 11 -113 14 -15 23 37 21 120 -3 82 -5 95 -21 98 -17 3 -18 -3 -11 -105z" />
                  <path d="M4194 3712 c-5 -4 -28 -41 -51 -82 -22 -41 -50 -91 -62 -112 -13 -21 -18 -39 -12 -42 5 -4 33 33 63 80 29 47 63 99 76 115 28 35 19 64 -14 41z" />
                  <path d="M1715 3573 c-11 -3 -60 -19 -109 -35 l-90 -30 -15 21 c-28 36 -70 44 -145 27 -120 -28 -249 -107 -315 -192 -52 -68 -116 -293 -91 -318 7 -7 10 -1 10 17 0 38 55 201 85 253 54 93 230 196 345 202 55 3 68 1 83 -15 17 -19 15 -21 -43 -68 -99 -79 -140 -148 -120 -201 32 -82 195 66 216 195 5 32 13 45 34 56 28 14 151 52 203 62 15 3 26 10 24 17 -4 12 -41 17 -72 9z m-244 -211 c-19 -37 -104 -122 -122 -122 -14 0 -10 38 6 69 8 16 40 52 72 80 49 42 58 47 61 32 2 -11 -6 -37 -17 -59z" />
                  <path d="M4424 3437 c-33 -29 -73 -62 -90 -74 -41 -30 -23 -40 23 -13 49 29 163 121 163 132 0 22 -41 3 -96 -45z" />
                  <path d="M4100 3314 c-14 -7 -35 -14 -47 -14 -12 0 -23 -4 -25 -10 -1 -5 -41 -15 -87 -22 -57 -8 -78 -14 -65 -19 45 -18 139 -6 211 27 17 8 47 14 67 14 25 0 36 4 36 15 0 8 -9 15 -19 15 -11 0 -25 2 -33 4 -7 2 -24 -2 -38 -10z" />
                  <path d="M3695 3300 c-3 -5 -1 -10 4 -10 6 0 11 5 11 10 0 6 -2 10 -4 10 -3 0 -8 -4 -11 -10z" />
                  <path d="M4125 3220 c-22 -11 -47 -19 -55 -20 -9 0 -22 -6 -28 -12 -10 -10 -17 -10 -32 0 -17 10 -20 10 -20 -3 0 -8 8 -15 18 -16 9 0 33 -1 54 -2 20 -1 34 1 32 4 -5 8 37 19 88 24 23 2 41 -2 49 -11 9 -11 9 -14 -2 -14 -10 0 -10 -3 -1 -12 16 -16 15 -39 -4 -77 -24 -48 -3 -62 29 -19 38 50 43 96 15 138 -20 29 -30 35 -63 37 -24 2 -56 -5 -80 -17z" />
                  <path d="M4518 3150 c-38 -21 -54 -37 -44 -47 9 -9 96 40 96 54 0 17 -8 16 -52 -7z" />
                  <path d="M3537 3120 c-5 -19 15 -50 32 -50 15 0 31 25 30 50 l0 25 -11 -22 c-14 -28 -28 -30 -28 -3 0 26 -16 26 -23 0z" />
                  <path d="M3646 3124 c-10 -25 -7 -33 15 -44 27 -15 49 3 48 39 0 26 0 26 -11 4 -14 -28 -28 -30 -28 -3 0 24 -15 27 -24 4z" />
                  <path d="M3592 3053 c-16 -29 -15 -33 8 -33 22 0 23 4 11 35 -8 19 -8 19 -19 -2z" />
                  <path d="M1860 3050 c0 -5 5 -10 10 -10 6 0 10 5 10 10 0 6 -4 10 -10 10 -5 0 -10 -4 -10 -10z" />
                  <path d="M3970 3019 c64 -54 210 -92 210 -54 0 8 -9 15 -20 15 -11 0 -20 5 -20 11 0 6 -8 8 -18 5 -9 -3 -56 7 -102 24 l-85 29 35 -30z" />
                  <path d="M3667 3034 c-4 -4 -7 -15 -7 -25 0 -24 -18 -33 -35 -19 -12 10 -15 9 -15 -3 0 -40 64 -32 74 9 7 27 -4 51 -17 38z" />
                  <path d="M1585 2960 c-3 -5 -18 -10 -33 -10 -22 -1 -24 -2 -11 -10 18 -11 79 6 79 21 0 12 -27 11 -35 -1z" />
                  <path d="M1840 2936 c0 -16 24 -38 33 -30 7 7 -14 44 -25 44 -5 0 -8 -6 -8 -14z" />
                  <path d="M1613 2916 c-13 -6 -23 -14 -23 -17 0 -9 49 2 55 12 9 13 -9 16 -32 5z" />
                  <path d="M2932 2268 c-98 -100 -206 -235 -247 -311 -19 -36 -45 -50 -45 -24 0 6 -18 39 -41 72 -22 33 -52 83 -66 110 -29 57 -51 85 -67 85 -12 0 -59 -47 -172 -168 -77 -83 -77 -79 4 -175 106 -125 232 -248 249 -244 17 4 17 5 1 6 -10 0 -24 14 -33 30 -8 16 -39 56 -68 88 -29 32 -71 83 -92 113 -22 30 -45 61 -52 68 -7 7 -13 19 -13 25 0 15 47 67 60 67 6 0 10 6 10 14 0 18 88 116 104 116 6 0 20 -22 31 -50 11 -27 22 -50 26 -50 13 0 79 -119 87 -156 11 -52 34 -55 73 -11 17 19 30 38 29 42 -9 31 293 385 328 385 7 0 12 5 12 10 0 6 4 10 8 10 13 0 129 -107 153 -141 l21 -30 -24 -22 c-12 -12 -36 -41 -51 -65 -29 -45 -169 -193 -371 -394 -77 -76 -126 -118 -140 -118 -11 0 -34 9 -51 20 -36 24 -45 25 -45 6 0 -20 67 -76 91 -76 39 0 76 30 235 192 291 296 404 426 404 465 0 19 -94 123 -163 181 -21 18 -48 32 -60 32 -16 0 -55 -32 -125 -102z" />
                  <path d="M2475 2010 c3 -5 8 -10 11 -10 2 0 4 5 4 10 0 6 -5 10 -11 10 -5 0 -7 -4 -4 -10z" />
                </g>
              </svg>
            </div>

            {/* Title */}
            <DialogHeader>
              <DialogTitle className="text-center text-3xl font-serif font-medium">
                Thank you for <br /> <span className="italic">Submission!</span>
              </DialogTitle>

              {/* Description */}
              <DialogDescription className="text-center text-gray-600 mb-6">
                Your submission has been successfully received. We appreciate
                your effort and will review it shortly.
              </DialogDescription>
            </DialogHeader>

            {/* Submission Id */}
            <div className="text-center mb-6">
              <p className="text-lg font-semibold text-gray-800">
                ID:{" "}
                <span className="font-mono">
                  {submissionId || "Contact the IT admin"}
                </span>
              </p>
              <span className="text-sm text-gray-500">
                Note: Please save this ID for future reference.
              </span>
            </div>

            {/* Peerlist logo */}
            <div className="flex justify-center opacity-80">
              <p className="text-2xl font-serif text-slate-600">
                Creative Design & Construction
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
