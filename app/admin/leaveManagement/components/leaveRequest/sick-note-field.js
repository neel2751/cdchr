"use client";

import { useUploader } from "@/hooks/useUploader";
import {
  needsSickNote,
  SICK_LEAVE_TYPE,
  SICK_NOTE_MIN_CONSECUTIVE_DAYS,
  SICK_NOTE_REQUIRED_MESSAGE,
} from "@/lib/sickNote";

/**
 * The sick note upload, shared by every leave form so an employee and an admin
 * are held to the same rule.
 *
 * The field only appears for sick leave, and only becomes mandatory once the
 * selected dates contain a run of SICK_NOTE_MIN_CONSECUTIVE_DAYS days — which
 * is why the requirement is expressed as a `validate` rule reading the whole
 * form rather than as a plain `required`.
 */
export const sickNoteField = {
  name: "sickNote",
  labelText: "Sick note",
  description: `Required for ${SICK_NOTE_MIN_CONSECUTIVE_DAYS} or more days of sick leave in a row.`,
  type: "image",
  showLabel: true,
  size: true,
  maxFiles: 1,
  maxFileSize: 1024 * 1024 * 10,
  acceptedFileTypes: {
    "image/*": [".png", ".jpg", ".jpeg"],
    "application/pdf": [".pdf"],
    "application/msword": [".doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      ".docx",
    ],
  },
  showIf: {
    field: "leaveType",
    value: SICK_LEAVE_TYPE,
  },
  validationOptions: {
    validate: (value, formValues) => {
      if (!needsSickNote(formValues?.leaveType, formValues?.leaveDates)) {
        return true;
      }
      const file = Array.isArray(value) ? value[0] : value;
      return file ? true : SICK_NOTE_REQUIRED_MESSAGE;
    },
  },
};

/**
 * Uploads the sick note picked in a form and returns the reference to store on
 * the leave request. Returns `{ success: false }` when the note is required but
 * missing, or when the upload itself fails, so the caller can stop the submit.
 */
export function useSickNoteUpload() {
  const { uploadFile } = useUploader();

  const prepareSickNote = async ({ leaveType, leaveDates, sickNote }) => {
    const file = Array.isArray(sickNote) ? sickNote[0] : sickNote;
    const isRequired = needsSickNote(leaveType, leaveDates);

    if (!file) {
      return isRequired
        ? { success: false, message: SICK_NOTE_REQUIRED_MESSAGE }
        : { success: true, sickNote: undefined };
    }

    // Re-submitting an edited request hands back the already stored reference.
    if (file.key) {
      return { success: true, sickNote: file };
    }

    const uploaded = await uploadFile(file, "sick-notes", "private");

    if (!uploaded?.success) {
      return {
        success: false,
        message: uploaded?.error || "Could not upload the sick note",
      };
    }

    return {
      success: true,
      sickNote: {
        key: uploaded.key,
        fileName: uploaded.fileName || file.name,
        fileSize: uploaded.fileSize ?? file.size,
        fileType: uploaded.fileType || file.type,
        access: "private",
      },
    };
  };

  return { prepareSickNote };
}
