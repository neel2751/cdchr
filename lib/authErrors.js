/**
 * Login failure codes shared by the server and the sign-in form.
 *
 * Auth.js v5 deliberately does not pass an arbitrary error message from
 * `authorize()` to the browser — only the short `code` of a thrown
 * `CredentialsSignin`. So the server throws a code, and the browser turns it
 * back into the wording users have always seen.
 *
 * A code may carry one piece of data after a dot ("RATE_LIMITED.5"). The
 * payload is URI-encoded because the code travels in a query parameter.
 *
 * Nothing here may hint at anything sensitive: these values end up in a URL.
 * "Email not found" vs "invalid password" is a deliberate existing choice of
 * this app, preserved rather than introduced.
 */

export const LOGIN_ERROR = {
  MISSING_CREDENTIALS: "MISSING_CREDENTIALS",
  RATE_LIMITED: "RATE_LIMITED",
  DEVICE_UNAUTHORIZED: "DEVICE_UNAUTHORIZED",
  EMAIL_NOT_FOUND: "EMAIL_NOT_FOUND",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  END_DATE_EXPIRED: "END_DATE_EXPIRED",
  VISA_EXPIRED: "VISA_EXPIRED",
  SERVER_ERROR: "SERVER_ERROR",
};

/** Build a wire code, optionally carrying one payload value. */
export function encodeLoginError(code, payload) {
  return payload === undefined || payload === null || payload === ""
    ? code
    : `${code}.${encodeURIComponent(payload)}`;
}

/** Split a wire code back into its parts. */
export function decodeLoginError(raw) {
  if (!raw || typeof raw !== "string") {
    return { code: LOGIN_ERROR.SERVER_ERROR, payload: "" };
  }
  const dot = raw.indexOf(".");
  if (dot === -1) return { code: raw, payload: "" };
  return {
    code: raw.slice(0, dot),
    payload: safeDecode(raw.slice(dot + 1)),
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/**
 * Turn a wire code into what the user sees.
 *
 * @returns {{ message: string, deviceId: string }} `deviceId` is set only for
 * DEVICE_UNAUTHORIZED, where the form needs it to offer device approval.
 */
export function describeLoginError(raw) {
  const { code, payload } = decodeLoginError(raw);

  switch (code) {
    case LOGIN_ERROR.MISSING_CREDENTIALS:
      return { message: "Please provide both email and password.", deviceId: "" };

    case LOGIN_ERROR.RATE_LIMITED: {
      const minutes = Math.max(1, parseInt(payload, 10) || 1);
      return {
        message: `Too many failed login attempts. Please try again in ${minutes} minute(s).`,
        deviceId: "",
      };
    }

    case LOGIN_ERROR.DEVICE_UNAUTHORIZED:
      return {
        message: "This device is not authorized. Please contact admin.",
        deviceId: payload,
      };

    case LOGIN_ERROR.EMAIL_NOT_FOUND:
      return { message: "Email not found", deviceId: "" };

    case LOGIN_ERROR.INVALID_PASSWORD:
      return { message: "Invalid password. Try again.", deviceId: "" };

    case LOGIN_ERROR.ACCOUNT_INACTIVE:
      return {
        message: "Your account is inactive. Please contact admin.",
        deviceId: "",
      };

    case LOGIN_ERROR.END_DATE_EXPIRED:
      return {
        message: "Your EndDate has expired. Please contact Admin.",
        deviceId: "",
      };

    case LOGIN_ERROR.VISA_EXPIRED:
      return {
        message: "Your visa has expired. Please contact Admin.",
        deviceId: "",
      };

    default:
      return {
        message: "An unexpected error occurred. Please try again.",
        deviceId: "",
      };
  }
}

/**
 * Map a message returned by LoginData to its code, so the server action keeps
 * returning plain messages and only the auth layer deals in codes.
 */
export function codeForLoginMessage(message) {
  if (!message) return LOGIN_ERROR.SERVER_ERROR;
  if (message === "DEVICE_UNAUTHORIZED") return LOGIN_ERROR.DEVICE_UNAUTHORIZED;
  if (/email not found/i.test(message)) return LOGIN_ERROR.EMAIL_NOT_FOUND;
  if (/invalid password/i.test(message)) return LOGIN_ERROR.INVALID_PASSWORD;
  if (/inactive/i.test(message)) return LOGIN_ERROR.ACCOUNT_INACTIVE;
  if (/enddate/i.test(message)) return LOGIN_ERROR.END_DATE_EXPIRED;
  if (/visa/i.test(message)) return LOGIN_ERROR.VISA_EXPIRED;
  if (/provide all details|provide both/i.test(message)) {
    return LOGIN_ERROR.MISSING_CREDENTIALS;
  }
  return LOGIN_ERROR.SERVER_ERROR;
}
