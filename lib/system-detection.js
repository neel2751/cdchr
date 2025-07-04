// System Detection Utilities for Browser and OS Information
// OS Support End Dates (for compliance tracking)
const OS_SUPPORT_DATES = {
  "Windows 7": { endDate: "2020-01-14", extendedEndDate: "2023-01-10" },
  "Windows 8": { endDate: "2016-01-12", extendedEndDate: "2023-01-10" },
  "Windows 8.1": { endDate: "2018-01-09", extendedEndDate: "2023-01-10" },
  "Windows 10": { endDate: "2025-10-14", extendedEndDate: "2025-10-14" },
  "Windows 11": { endDate: "2031-10-14", extendedEndDate: "2031-10-14" },
  "macOS 10.15": { endDate: "2022-09-12", extendedEndDate: "2022-09-12" },
  "macOS 11": { endDate: "2024-09-16", extendedEndDate: "2024-09-16" },
  "macOS 12": { endDate: "2025-09-15", extendedEndDate: "2025-09-15" },
  "macOS 13": { endDate: "2026-09-14", extendedEndDate: "2026-09-14" },
  "macOS 14": { endDate: "2027-09-13", extendedEndDate: "2027-09-13" },
};

class SystemDetection {
  static detectBrowser() {
    const userAgent = navigator.userAgent;
    let browserName = "Unknown";
    let browserVersion = "Unknown";

    // Chrome
    if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
      browserName = "Chrome";
      const match = userAgent.match(/Chrome\/([0-9.]+)/);
      browserVersion = match ? match[1] : "Unknown";
    }
    // Edge
    else if (userAgent.includes("Edg")) {
      browserName = "Microsoft Edge";
      const match = userAgent.match(/Edg\/([0-9.]+)/);
      browserVersion = match ? match[1] : "Unknown";
    }
    // Firefox
    else if (userAgent.includes("Firefox")) {
      browserName = "Firefox";
      const match = userAgent.match(/Firefox\/([0-9.]+)/);
      browserVersion = match ? match[1] : "Unknown";
    }
    // Safari
    else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      browserName = "Safari";
      const match = userAgent.match(/Version\/([0-9.]+)/);
      browserVersion = match ? match[1] : "Unknown";
    }
    // Internet Explorer
    else if (userAgent.includes("MSIE") || userAgent.includes("Trident")) {
      browserName = "Internet Explorer";
      const match = userAgent.match(/(?:MSIE |rv:)([0-9.]+)/);
      browserVersion = match ? match[1] : "Unknown";
    }

    return {
      name: browserName,
      version: browserVersion,
      userAgent,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
      onlineStatus: navigator.onLine,
      platform: navigator.platform,
    };
  }

  static detectOS() {
    const userAgent = navigator.userAgent;
    const platform = navigator.platform;
    let osName = "Unknown";
    let osVersion = "Unknown";
    let architecture = "Unknown";
    let buildNumber;

    // Windows
    if (userAgent.includes("Windows NT")) {
      osName = "Windows";
      const ntVersionMatch = userAgent.match(/Windows NT ([0-9.]+)/);
      if (ntVersionMatch) {
        const ntVersion = ntVersionMatch[1];
        switch (ntVersion) {
          case "6.1":
            osName = "Windows 7";
            break;
          case "6.2":
            osName = "Windows 8";
            break;
          case "6.3":
            osName = "Windows 8.1";
            break;
          case "10.0":
            // Distinguish between Windows 10 and 11
            if (userAgent.includes("Windows NT 10.0")) {
              // Windows 11 typically has build numbers 22000+
              const buildMatch = userAgent.match(
                /Windows NT 10\.0; Win64; x64.*?(\d{5,})/
              );
              if (buildMatch) {
                buildNumber = buildMatch[1];
                osName =
                  Number.parseInt(buildMatch[1]) >= 22000
                    ? "Windows 11"
                    : "Windows 10";
              } else {
                osName = "Windows 10";
              }
            }
            break;
          default:
            osName = `Windows NT ${ntVersion}`;
        }
        osVersion = ntVersion;
      }

      // Architecture detection
      if (userAgent.includes("WOW64") || userAgent.includes("Win64")) {
        architecture = "x64";
      } else {
        architecture = "x86";
      }
    }
    // macOS
    else if (userAgent.includes("Mac OS X") || userAgent.includes("macOS")) {
      osName = "macOS";
      const versionMatch = userAgent.match(/Mac OS X ([0-9_]+)/);
      if (versionMatch) {
        osVersion = versionMatch[1].replace(/_/g, ".");
        const majorMinor = osVersion.split(".").slice(0, 2).join(".");
        osName = `macOS ${majorMinor}`;
      }
      architecture = userAgent.includes("Intel") ? "Intel" : "Apple Silicon";
    }
    // Linux
    else if (userAgent.includes("Linux")) {
      osName = "Linux";
      if (userAgent.includes("Ubuntu")) osName = "Ubuntu";
      else if (userAgent.includes("CentOS")) osName = "CentOS";
      else if (userAgent.includes("Red Hat")) osName = "Red Hat";

      architecture = userAgent.includes("x86_64") ? "x64" : "x86";
    }
    // Mobile OS
    else if (userAgent.includes("iPhone OS") || userAgent.includes("iOS")) {
      osName = "iOS";
      const versionMatch = userAgent.match(/OS ([0-9_]+)/);
      if (versionMatch) {
        osVersion = versionMatch[1].replace(/_/g, ".");
      }
    } else if (userAgent.includes("Android")) {
      osName = "Android";
      const versionMatch = userAgent.match(/Android ([0-9.]+)/);
      if (versionMatch) {
        osVersion = versionMatch[1];
      }
    }

    const supportInfo = this.getOSSupportStatus(osName, osVersion);

    return {
      name: osName,
      version: osVersion,
      architecture,
      platform,
      isSupported: supportInfo.isSupported,
      supportEndDate: supportInfo.supportEndDate,
      securityUpdateStatus: supportInfo.securityUpdateStatus,
      buildNumber,
    };
  }

  static getDeviceType() {
    const userAgent = navigator.userAgent;
    const width = window.innerWidth;
    if (/Mobi|Android/i.test(userAgent) || width <= 768) {
      return "Mobile";
    } else if (
      /Tablet|iPad/i.test(userAgent) ||
      (width > 768 && width <= 1024)
    ) {
      return "Tablet";
    } else {
      return "Desktop";
    }
  }

  static getOSSupportStatus(osName, osVersion) {
    const osKey = `${osName}`;
    const supportData = OS_SUPPORT_DATES[osKey];

    if (!supportData) {
      return {
        isSupported: true, // Assume supported if not in our database
        securityUpdateStatus: "current",
      };
    }

    const now = new Date();
    const endDate = new Date(supportData.endDate);
    const extendedEndDate = new Date(supportData.extendedEndDate);

    if (now <= endDate) {
      return {
        isSupported: true,
        supportEndDate: supportData.endDate,
        securityUpdateStatus: "current",
      };
    } else if (now <= extendedEndDate) {
      return {
        isSupported: true,
        supportEndDate: supportData.extendedEndDate,
        securityUpdateStatus: "extended",
      };
    } else {
      return {
        isSupported: false,
        supportEndDate: supportData.extendedEndDate,
        securityUpdateStatus: "expired",
      };
    }
  }

  static getSystemInfo() {
    return {
      browser: this.detectBrowser(),
      os: this.detectOS(),
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
        pixelRatio: window.devicePixelRatio || 1,
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      detectionTimestamp: new Date().toISOString(),
    };
  }

  static validateWindowsKey(key) {
    // Remove spaces and hyphens for validation
    const cleanKey = key.replace(/[\s-]/g, "").toUpperCase();

    // Windows product key formats
    const formats = {
      "Windows 10/11 Digital": /^[A-Z0-9]{25}$/, // 25 characters
      "Windows Legacy":
        /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/, // XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
      Office: /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/, // Same format as legacy Windows
    };

    // Check for digital license (no key needed)
    if (
      key.toLowerCase().includes("digital") ||
      key.toLowerCase().includes("linked")
    ) {
      return { isValid: true, format: "Digital License" };
    }

    // Validate against known formats
    for (const [format, regex] of Object.entries(formats)) {
      if (regex.test(key) || regex.test(cleanKey)) {
        return { isValid: true, format };
      }
    }

    return {
      isValid: false,
      format: "Unknown",
      error:
        "Invalid product key format. Expected format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX or 25-character digital key",
    };
  }
}

export { SystemDetection };
