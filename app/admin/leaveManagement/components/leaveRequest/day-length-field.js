import { DAY_LENGTH_OPTIONS } from "@/lib/leaveDayLength";

/**
 * Full days or a half day, shared by every leave form.
 *
 * Offered for every leave type, because a half day is half a day of whatever
 * was booked rather than a type of its own — see lib/leaveDayLength.js. Every
 * date picked is booked as the half chosen here.
 */
export const dayLengthField = {
  name: "dayLength",
  labelText: "Length",
  type: "radio",
  options: DAY_LENGTH_OPTIONS,
  size: true,
  description: "For a half day, each date you pick counts as half a day.",
  validationOptions: {
    required: "Choose full day, morning or afternoon",
  },
};
