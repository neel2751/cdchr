import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { addDays, format, startOfWeek } from "date-fns";
import Shimmer from "../tableStatus/tableLoader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getSelectAttendanceCategory,
  getSelectProjects,
} from "@/server/selectServer/selectServer";
import { handleWeeklyRotaWithStatus } from "@/server/weeklyRotaServer/weeklyRotaServer";
import { Badge } from "../ui/badge";
import { toast } from "sonner";
import { Input } from "../ui/input";

const WeekRotaTable = ({
  currentWeek,
  schedules,
  setSchedules,
  memoizedSchedules,
  isLoading,
  queryKey,
  handleOnClose = () => {},
}) => {
  const { data: categories = [] } = useFetchSelectQuery({
    fetchFn: getSelectAttendanceCategory,
    queryKey: ["selectCategories"],
  });

  const { data: siteProjects = [] } = useFetchSelectQuery({
    fetchFn: getSelectProjects,
    queryKey: ["selectProjects"],
  });

  const findMostCommonCategory = (schedule = []) => {
    const frequency = schedule.reduce((acc, dayEntry) => {
      const category = dayEntry?.category;
      if (category) {
        acc[category] = (acc[category] || 0) + 1;
      }
      return acc;
    }, {});

    return Object.keys(frequency).reduce(
      (a, b) => (frequency[a] > frequency[b] ? a : b),
      "OFFICE" // default fallback if no category found
    );
  };

  const handleScheduleChange = (employeeId, day, field, value, date) => {
    if (day === "Sunday") return; // Skip Sunday edits

    console.log(
      `Updating ${field} for Employee ID: ${employeeId}, Day: ${day}, Value: ${value} on Date: ${date}`
    );

    setSchedules((prevSchedules) =>
      prevSchedules.map((schedule) => {
        if (schedule.employeeId === employeeId) {
          const existingDayIndex = schedule.schedule.findIndex(
            (daySchedule) => daySchedule.date === date
          );

          let updatedScheduleArray = [...schedule.schedule];

          if (existingDayIndex !== -1) {
            // If day exists, update the field
            updatedScheduleArray[existingDayIndex] = {
              ...updatedScheduleArray[existingDayIndex],
              date,
              day,
              [field]: value,
            };
          } else {
            // If day is missing, add it
            updatedScheduleArray.push({
              [field]: value,
              date,
              category: field === "category" ? value : "OFFICE",
              startTime: field === "startTime" ? value : "09:00",
              endTime: field === "endTime" ? value : "17:00",
            });
          }

          return {
            ...schedule,
            schedule: updatedScheduleArray,
          };
        }

        return schedule;
      })
    );
  };

  const autoFillSchedule = (employeeId) => {
    console.log(employeeId);

    setSchedules((prevSchedules) =>
      prevSchedules.map((schedule) => {
        if (schedule.employeeId !== employeeId) return schedule;

        // Convert the schedule array to a map for easier access by day
        const scheduleMap = new Map(
          schedule.schedule.map((entry) => [entry.day, entry])
        );

        const mostCommonCategory = findMostCommonCategory(schedule.schedule);
        const days = [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ];

        const updatedSchedule = days.map((day) => {
          const existingDay = scheduleMap.get(day);

          // If it's Sunday, always return OFF
          if (day === "Sunday") {
            return {
              day,
              category: "OFF",
              startTime: "00:00",
              endTime: "00:00",
            };
          }

          // If the day already exists and is OFF or HOLIDAY, return as is
          if (
            existingDay?.category === "OFF" ||
            existingDay?.category === "Holiday"
          ) {
            return existingDay;
          }

          // Otherwise, create a new entry with default values
          return {
            ...existingDay,
            day,
            category: "OFFICE",
            startTime: "09:00",
            endTime: "17:00",
          };
        });

        console.log(updatedSchedule);

        return {
          ...schedule,
          schedule: updatedSchedule,
        };
      })
    );
  };

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await handleWeeklyRotaWithStatus(
        data,
        format(currentWeek, "yyyy-MM-dd"),
        memoizedSchedules?.weekId
      ),
    invalidateKey: queryKey,
    onSuccessMessage: () =>
      memoizedSchedules?.weekId
        ? "Weekly Rota Updated"
        : "Weekly Rota Submited",
    onClose: () => handleOnClose(),
  });

  const submitSchedules = () => {
    if (!schedules.length) {
      toast.warning("No schedules to submit");
      return;
    }

    let hasErrors = false;

    const updatedSchedules = schedules.map((schedule) => {
      const missingDays = [];

      schedule.schedule.forEach((daySchedule) => {
        const { day, category, startTime, endTime, site } = daySchedule;

        // Skip validation for Sunday and HOLIDAY
        if (day === "Sunday" || category === "Holiday") return;

        if (!category) {
          missingDays.push(`${day} (missing category)`);
          return;
        }

        if (category === "OFFICE/SITE" && !site) {
          missingDays.push(`${day} (missing site for OFFICE/SITE)`);
          return;
        }

        if (category !== "OFF") {
          if (!startTime || !endTime) {
            missingDays.push(`${day} (missing time)`);
            return;
          }

          if (startTime >= endTime) {
            missingDays.push(`${day} (invalid time range)`);
          }
        }
      });

      if (missingDays.length > 0) hasErrors = true;

      return {
        ...schedule,
        hasError: missingDays.length > 0,
        missingDays,
      };
    });

    setSchedules(updatedSchedules);

    if (hasErrors) {
      const errorMessage = updatedSchedules
        .filter((s) => s.hasError)
        .map(
          (s) =>
            `Employee: ${s.employeeName}\nMissing/Invalid: ${s.missingDays.join(
              ", "
            )}`
        )
        .join("\n\n");

      toast.error("Some schedules have issues. Please fix and try again.");
      console.warn("Validation Errors:\n", errorMessage);
      return;
    }

    // Success: Update status and submit
    setSchedules((prev) =>
      prev.map((schedule) => ({ ...schedule, status: "Submitted" }))
    );
    handleSubmit(updatedSchedules);
  };

  // Generate current week's dates with day labels
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 1 }); // Week starts Monday
    const date = addDays(start, i);
    return {
      date: format(date, "yyyy-MM-dd"),
      dayLabel: format(date, "EEE"), // e.g., "Mon", "Tue"
    };
  });

  return (
    <>
      <div className="space-x-2 my-2 ms-2">
        <span className="text-neutral-500 text-xs font-medium">
          Categories:
        </span>
        {categories?.map((item, index) => (
          <Badge
            variant={"outline"}
            className={"border-none p-0 text-neutral-600 font-medium"}
            key={index}
          >
            {item?.label}-({item?.value})
          </Badge>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            {[...Array(7)].map((_, i) => (
              <TableHead key={i}>
                {format(addDays(currentWeek, i), "EEE dd/MM")}
              </TableHead>
            ))}
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        {isLoading ? (
          <Shimmer length={9} />
        ) : (
          <TableBody>
            {schedules &&
              schedules?.map((schedule) => (
                <TableRow
                  key={schedule?.employeeId}
                  style={{
                    border: schedule?.hasError ? "1px solid red" : "none",
                  }}
                >
                  <TableCell>{schedule?.employeeName}</TableCell>

                  {weekDates.map(({ dayLabel, date }) => {
                    // Find the schedule for the current day
                    const daySchedule =
                      schedule.schedule.find((entry) => entry.date === date) ||
                      {};
                    const isHoliday = daySchedule.category === "Holiday";
                    const isOff =
                      dayLabel === "Sunday" || daySchedule.category === "OFF";
                    const isOfficeSite = daySchedule.category === "OFFICE/SITE";
                    if (isHoliday) {
                      return (
                        <TableCell key={date}>
                          <Badge className={"w-full justify-center bg-red-600"}>
                            Holiday
                          </Badge>
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell key={date}>
                        <div className="space-y-2">
                          <Select
                            disabled={dayLabel === "Sunday" || isHoliday}
                            value={daySchedule.category || ""}
                            onValueChange={(value) =>
                              handleScheduleChange(
                                schedule.employeeId,
                                dayLabel,
                                "category",
                                value,
                                daySchedule.date
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((category) => (
                                <SelectItem
                                  key={category?.value}
                                  value={category?.value}
                                >
                                  {category?.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Input
                            type="time"
                            disabled={isOff || isHoliday}
                            value={
                              isOff ? "00:00" : daySchedule.startTime || ""
                            }
                            onChange={(e) =>
                              handleScheduleChange(
                                schedule?.employeeId,
                                dayLabel,
                                "startTime",
                                e.target.value,
                                daySchedule.date
                              )
                            }
                            className="max-w-max w-full"
                          />

                          <Input
                            type="time"
                            disabled={isOff || isHoliday}
                            value={isOff ? "00:00" : daySchedule.endTime || ""}
                            onChange={(e) =>
                              handleScheduleChange(
                                schedule?.employeeId,
                                dayLabel,
                                "endTime",
                                e.target.value,
                                daySchedule.date
                              )
                            }
                            className="max-w-max w-full"
                          />

                          {isOfficeSite && (
                            <Select
                              value={daySchedule.site || ""}
                              onValueChange={(value) =>
                                handleScheduleChange(
                                  schedule.employeeId,
                                  dayLabel,
                                  "site",
                                  value,
                                  daySchedule.date
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select Site" />
                              </SelectTrigger>
                              <SelectContent>
                                {siteProjects?.map((site) => (
                                  <SelectItem
                                    key={site?.value}
                                    value={site?.label}
                                  >
                                    {site?.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <Button
                      disabled={isPending || categories.length === 0}
                      type="button"
                      onClick={() => autoFillSchedule(schedule?.employeeId)}
                    >
                      {categories.length > 0 ? "Auto Fill" : "No Categories"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        )}
      </Table>
      <div className="mt-4 flex gap-4">
        <Button
          disabled={isLoading || isPending || categories.length === 0}
          onClick={submitSchedules}
        >
          {memoizedSchedules?.weekId ? "Update Schedules" : "Submit Schedules"}
        </Button>
        {/* {memoizedSchedules.role ||
          (memoizedSchedules?.approvedStatus === "Pending" && (
            <Button onClick={handleEmailReminder} size="icon">
              <Bell />
            </Button>
          ))} */}
      </div>
    </>
  );
};

export default WeekRotaTable;
