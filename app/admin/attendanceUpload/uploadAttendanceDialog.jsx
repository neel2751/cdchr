"use client";

import { useMemo, useState } from "react";
import { addDays, format, isMonday, startOfWeek } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CalendarIcon,
  FileUpIcon,
  Loader2,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/utils";
import {
  getWeeklyAttendanceUploadByWeek,
  saveWeeklyAttendanceUpload,
} from "@/server/attendanceServer/attendanceUploadServer";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp";

/** Monday of the week the given date falls in. */
const mondayOf = (date) =>
  isMonday(date) ? date : startOfWeek(date, { weekStartsOn: 1 });

/** "Mon 01 Sep — Sun 07 Sep 2026" */
export function weekLabel(start, end) {
  if (!start) return "";
  const from = new Date(start);
  const to = end ? new Date(end) : addDays(from, 6);
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? "EEE dd MMM" : "EEE dd MMM yyyy")} — ${format(
    to,
    "EEE dd MMM yyyy"
  )}`;
}

/**
 * The parent mounts this only while the dialog is open, so every open starts
 * from these initial values — there is no stale week or file to reset.
 */
export default function UploadAttendanceDialog({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => mondayOf(new Date()));
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [replace, setReplace] = useState(false);
  const [fileError, setFileError] = useState("");

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  // Whether this week already has a sheet — checked as soon as a week is
  // picked so the answer is on screen before a file is chosen.
  const { data: existing, isFetching: isChecking } = useQuery({
    queryKey: ["attendanceUploadWeek", weekStart.toISOString()],
    queryFn: async () => {
      const response = await getWeeklyAttendanceUploadByWeek(
        weekStart.toISOString()
      );
      return JSON.parse(response?.data || "null");
    },
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const alreadyUploaded = Boolean(existing);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      saveWeeklyAttendanceUpload({
        weekStart: weekStart.toISOString(),
        note,
        file,
        replace,
      }),
    onSuccess: (response) => {
      if (!response?.success) {
        toast.error(response?.message || "Upload failed");
        return;
      }
      toast.success(response.message);
      queryClient.invalidateQueries({ queryKey: ["attendanceUploads"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceUploadStats"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceUploadYears"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceUploadWeek"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(error?.message || "Upload failed"),
  });

  const handleSelectDay = (day) => {
    if (!day) return;
    const monday = mondayOf(day);
    setWeekStart(monday);
    setCalendarMonth(monday);
  };

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0] || null;
    if (selected && selected.size > MAX_FILE_BYTES) {
      setFileError(`That file is ${formatBytes(selected.size)}. The limit is 10 MB.`);
      setFile(null);
      event.target.value = "";
      return;
    }
    setFileError("");
    setFile(selected);
  };

  // Blocked until there is a file, and — on a week that already has one —
  // until the replacement has been explicitly confirmed.
  const canSubmit =
    !!file && !isPending && !isChecking && (!alreadyUploaded || replace);

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload weekly attendance</DialogTitle>
          <DialogDescription>
            Pick the week the sheet covers, then attach the file. Weeks run
            Monday to Sunday and each week holds one file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Week</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  disabled={isPending}
                  className="w-full justify-start font-normal"
                >
                  <CalendarIcon className="mr-2 size-4" />
                  {weekLabel(weekStart, weekEnd)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={weekStart}
                  onSelect={handleSelectDay}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  captionLayout="dropdown"
                  startMonth={new Date(2020, 0)}
                  endMonth={new Date(new Date().getFullYear() + 1, 11)}
                  disabled={{ after: new Date() }}
                  modifiers={{ pickedWeek: { from: weekStart, to: weekEnd } }}
                  modifiersClassNames={{
                    pickedWeek: "bg-indigo-100 text-indigo-900 rounded-none",
                  }}
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-neutral-500">
              Click any day — the whole Monday-to-Sunday week is selected.
            </p>
          </div>

          {isChecking ? (
            <div className="flex items-center gap-2 rounded-md border bg-neutral-50 p-3 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" />
              Checking this week…
            </div>
          ) : alreadyUploaded ? (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="flex gap-2">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="text-sm">
                  <p className="font-medium text-amber-900">
                    Already uploaded
                  </p>
                  <p className="text-amber-800">
                    {existing?.file?.originalName} was uploaded
                    {existing?.uploadedByName
                      ? ` by ${existing.uploadedByName}`
                      : ""}{" "}
                    on{" "}
                    {existing?.file?.uploadedAt
                      ? format(new Date(existing.file.uploadedAt), "dd MMM yyyy")
                      : "—"}
                    .
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <Checkbox
                  id="replace-week-file"
                  checked={replace}
                  disabled={isPending}
                  onCheckedChange={(checked) => setReplace(checked === true)}
                />
                <Label
                  htmlFor="replace-week-file"
                  className="text-sm font-normal text-amber-900"
                >
                  Replace it with a new file
                </Label>
              </div>
              {replace ? (
                <p className="pl-6 text-xs text-amber-700">
                  The current file is kept in this week&apos;s history and stays
                  downloadable from the record.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              No attendance file uploaded for this week yet.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="attendance-file">Attendance file</Label>
            <Input
              id="attendance-file"
              type="file"
              accept={ACCEPT}
              disabled={isPending}
              onChange={handleFileChange}
            />
            {fileError ? (
              <p className="text-xs text-red-600">{fileError}</p>
            ) : file ? (
              <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                <FileUpIcon className="size-3.5" />
                {file.name} · {formatBytes(file.size)}
              </p>
            ) : (
              <p className="text-xs text-neutral-500">
                Excel, CSV, PDF or image — up to 10 MB.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="attendance-note">Note (optional)</Label>
            <Textarea
              id="attendance-note"
              rows={2}
              value={note}
              disabled={isPending}
              maxLength={500}
              placeholder="Anything worth recording about this week's sheet"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutate()}>
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <UploadIcon className="mr-2 size-4" />
            )}
            {alreadyUploaded ? "Replace file" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
