"use client";

import { StoreDevice } from "@/server/deviceServer/deviceServer";
import { toast } from "sonner";

// Device Data Storage with Privacy and Security

// Encryption utilities for sensitive data
export class DataEncryption {
  static generateKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  static encrypt(data, key) {
    // Simple XOR encryption for demo (use proper encryption in production)
    let encrypted = "";
    for (let i = 0; i < data.length; i++) {
      encrypted += String.fromCharCode(
        data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      );
    }
    return btoa(encrypted);
  }

  static decrypt(encryptedData, key) {
    try {
      const data = atob(encryptedData);
      let decrypted = "";
      for (let i = 0; i < data.length; i++) {
        decrypted += String.fromCharCode(
          data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
        );
      }
      return decrypted;
    } catch {
      return "";
    }
  }

  static generateSubmissionKey() {
    return this.generateKey();
  }
}

// Device data storage with privacy compliance
class DeviceDataStorage {
  submissions = new Map();
  privacyPolicies = [];
  STORAGE_KEY = "device_submissions_encrypted";
  PRIVACY_KEY = "privacy_policies";

  constructor() {
    this.initializePrivacyPolicies();
  }

  initializePrivacyPolicies() {
    const currentPolicy = {
      version: "CDC-V1",
      effectiveDate: "01-04-2025",
      title: "Device Information Privacy Policy",
      content: `This privacy policy outlines how we collect, use, and protect information related to devices used for company purposes, whether personally owned or company-issued.
          
          **Information We Collect:**
          - Device names and types
          - Operating system and version
          - Whether the device is a personal or company asset
          - Technical specifications (when provided)
          
          **How We Use Your Information:**
          - Managing company assets and tracking inventory
          - Ensuring security compliance and risk mitigation
          - Providing IT support and resolving technical issues
          - Enforcing company policies and usage guidelines
          
          **Data Protection:**
          - Data is encrypted during both storage and transmission
          - Access is limited to authorised personnel only
          - Security is monitored continuously with regular audits
          - Fully compliant with UK GDPR and applicable UK privacy regulations
          
          **Your Rights Under UK GDPR:**
          - Access the information we hold about your device(s)
          - Correct any inaccuracies in your data
          - Request deletion of your data, subject to legal and regulatory obligations
          - Receive your data in a portable format
          - Withdraw consent for non-essential data processing
        `,
      dataUsage: [
        "Asset inventory management",
        "Security compliance monitoring",
        "IT support and troubleshooting",
        "Verifying compliance with internal policies",
        "Internal audits and reporting",
      ],
      retentionPeriod:
        "7 years from submission date or until employment termination + 2 years",
      userRights: [
        "Access your submitted device information",
        "Request corrections to inaccurate data",
        "Request deletion of your data (subject to legal requirements)",
        "Receive a copy of your data in a portable format",
        "Withdraw consent for non-essential processing",
      ],
    };

    this.privacyPolicies = [currentPolicy];
  }

  getCurrentPrivacyPolicy() {
    return this.privacyPolicies[this.privacyPolicies.length - 1];
  }

  async submitDeviceInformation(
    devices,
    broswers,
    userInfo = {
      submittedBy,
      employeeId,
      employeeName,
      department,
    },
    privacyConsent = {
      privacyPolicyAccepted,
      dataRetentionConsent,
    },
    showSystemInfo
  ) {
    try {
      if (!privacyConsent.privacyPolicyAccepted) {
        return {
          success: false,
          error: "Privacy policy acceptance is required",
        };
      }

      if (devices.length === 0 || devices.length > 5) {
        return {
          success: false,
          error: "Please submit between 1 and 5 devices",
        };
      }

      const submissionId = `CDC-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const encryptionKey = DataEncryption.generateSubmissionKey();

      const deviceEntries = devices.map((device, index) => ({
        ...device,
        id: `DEV-${submissionId}-${index + 1}`,
        // Encrypt sensitive data
        deviceName: device.deviceName,
        serialNumber: device.serialNumber
          ? DataEncryption.encrypt(device.serialNumber, encryptionKey)
          : undefined,
        windowsKey: device.windowsKey
          ? DataEncryption.encrypt(device.windowsKey, encryptionKey)
          : undefined,
      }));

      const submission = {
        submissionId: submissionId,
        submissionDate: new Date().toISOString(),
        submittedBy: userInfo.submittedBy,
        employeeId: userInfo.employeeId,
        employeeName: userInfo?.employeeName,
        department: userInfo.department,
        devices: deviceEntries,
        broswers: broswers,
        privacyPolicyAccepted: privacyConsent.privacyPolicyAccepted,
        privacyPolicyVersion: this.getCurrentPrivacyPolicy().version,
        dataRetentionConsent: privacyConsent.dataRetentionConsent,
        ipAddress: this.getClientIP(),
        userAgent: navigator.userAgent,
        encryptionKey,
        submitSystemInfo: showSystemInfo,
      };

      const result = await StoreDevice(submission);
      if (result?.success) {
        // this.submissions.set(submissionId, submission);
        // this.saveToStorage();
        return { success: true, submissionId };
      } else {
        toast.error(result?.message || "Something went wrong");
      }
    } catch (error) {
      console.error("Error submitting device information:", error);
      return { success: false, error: "Failed to submit device information" };
    }
  }

  deleteSubmission(submissionId, reason) {
    try {
      if (this.submissions.has(submissionId)) {
        // Log deletion for audit purposes
        console.log(`Submission ${submissionId} deleted. Reason: ${reason}`);
        this.submissions.delete(submissionId);
        this.saveToStorage();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting submission:", error);
      return false;
    }
  }

  getClientIP() {
    // In production, this would be handled server-side
    return "Client IP (handled server-side)";
  }

  anonymizeUserData(userEmail) {
    try {
      let updated = false;
      this.submissions.forEach((submission, id) => {
        if (submission.submittedBy.toLowerCase() === userEmail.toLowerCase()) {
          submission.submittedBy = "ANONYMIZED_USER";
          submission.employeeId = undefined;
          updated = true;
        }
      });

      if (updated) {
        this.saveToStorage();
      }
      return updated;
    } catch (error) {
      console.error("Error anonymizing user data:", error);
      return false;
    }
  }
}

// Singleton instance
export const deviceDataStorage = new DeviceDataStorage();
export const dataEncryption = new DataEncryption();

// Device type definitions and helpers
export const DEVICE_TYPES = [
  { value: "laptop", label: "Laptop/Notebook", icon: "💻" },
  { value: "desktop", label: "Desktop Computer", icon: "🖥️" },
  { value: "smartphone", label: "Smartphone", icon: "📱" },
  { value: "tablet", label: "Tablet", icon: "📱" },
  { value: "monitor", label: "Monitor/Display", icon: "🖥️" },
  { value: "printer", label: "Printer", icon: "🖨️" },
  { value: "router", label: "Router/Network Device", icon: "📡" },
  { value: "server", label: "Server", icon: "🖥️" },
  { value: "other", label: "Other Device", icon: "⚙️" },
];

export const BROWSER_TYPE = [
  { value: "Chrome", label: "Google Chrome" },
  { value: "Firefox", label: "Firefox" },
  { value: "Opera", label: "Opera" },
  { value: "Edge", label: "Microsoft Edge" },
  { value: "Brave", label: "Brave" },
  { value: "Safari", label: "Safari" },
  { value: "Opera Mini", label: "Opera Mini" },
  { value: "Chromium", label: "Chromium" },
  { value: "Internet Explorer", label: "Internet Explorer" },
  { value: "UC", label: "UC Browser" },
  { value: "Tor", label: "Tor Browser" },
  { value: "Arc", label: "Arc" },
  { value: "other", label: "Other Browser" },
];

export const DEVICE_IDENTIFICATION_GUIDE = {
  laptop: {
    nameInstructions:
      "Look for the model name on a sticker on the bottom of your laptop or in System Information",
    versionInstructions:
      "Check System Information or About This Mac for exact model and year",
    examples: [
      "MacBook Pro 16-inch 2023",
      "Dell XPS 13 9320",
      "ThinkPad X1 Carbon Gen 10",
    ],
  },
  desktop: {
    nameInstructions:
      "Check the computer case for model stickers or use System Information",
    versionInstructions:
      "Look for model number and manufacturing date in system settings",
    examples: ["iMac 24-inch M1", "Dell OptiPlex 7090", "HP EliteDesk 800 G8"],
  },
  smartphone: {
    nameInstructions: "Go to Settings > About Phone/About to find device model",
    versionInstructions:
      "Check Settings > About for exact model number and OS version",
    examples: ["iPhone 14 Pro", "Samsung Galaxy S23", "Google Pixel 7"],
  },
  tablet: {
    nameInstructions:
      "Check Settings > About Device or look for model on device back",
    versionInstructions: "Find model number and generation in device settings",
    examples: [
      "iPad Pro 12.9-inch (6th gen)",
      "Samsung Galaxy Tab S8",
      "Microsoft Surface Pro 9",
    ],
  },
};
