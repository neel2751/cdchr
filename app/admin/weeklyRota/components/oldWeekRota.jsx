import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, format } from "date-fns";
import Shimmer from "@/components/tableStatus/tableLoader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectAttendanceCategory } from "@/server/selectServer/selectServer";
import { handleWeeklyRotaWithStatus } from "@/server/weeklyRotaServer/weeklyRotaServer";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const OldWeekRotaTable = ({
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
  const findMostCommonCategory = (schedule) => {
    const values = Object.values(schedule || {});
    const frequency = values.reduce((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

    return Object.keys(frequency).reduce(
      (a, b) => (frequency[a] > frequency[b] ? a : b),
      "OFFICE"
    );
  };

  const handleScheduleChange = (employeeId, day, value) => {
    setSchedules((prevSchedules) =>
      prevSchedules.map((schedule) =>
        schedule.employeeId === employeeId
          ? { ...schedule, schedule: { ...schedule.schedule, [day]: value } }
          : schedule
      )
    );
  };

  const autoFillSchedule = (employeeId) => {
    setSchedules((prevSchedules) =>
      prevSchedules.map((schedule) => {
        if (schedule.employeeId === employeeId) {
          const currentSchedule = { ...schedule.schedule };
          const days = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ];
          const mostCommonCategory = findMostCommonCategory(schedule.schedule);

          days.forEach((day) => {
            if (!currentSchedule[day]) {
              day === "Sunday" ? "OFF" : mostCommonCategory;
            }
          });

          return { ...schedule, schedule: currentSchedule };
        }
        return schedule;
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
    // console.log("Before Submiting...", schedules);
    // Validation: Ensure all schedules are complete
    let hasErrors = false;

    const updatedSchedules = schedules.map((schedule) => {
      const missingDays = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ].filter((day) => day !== "Sunday" && !schedule.schedule[day]); // Skip Sunday validation

      if (missingDays.length > 0) {
        hasErrors = true;
      }

      return { ...schedule, hasError: missingDays.length > 0, missingDays };
    });

    setSchedules(updatedSchedules);

    if (hasErrors) {
      //   // Create a detailed error message
      const errorMessage = updatedSchedules
        .filter((schedule) => schedule.hasError)
        .map(
          (schedule) =>
            `Employee: ${
              schedule.employeeName
            }, Missing Days: ${schedule.missingDays.join(", ")}`
        )
        .join("\n");
      toast.error("Some employees have missing schedule days.");
      return; // Stop submission if validation fails
    }
    // we can also check if the schedule is valid (e.g., no two consecutive days are
    // assigned to the same category)

    // In a real application, this would send the data to a server
    setSchedules((prevSchedules) =>
      prevSchedules.map((schedule) => ({ ...schedule, status: "Submitted" }))
    );
    handleSubmit(schedules);
  };
  return (
    <>
      <div className="space-x-2 my-2 ms-2">
        <span className="text-neutral-500 text-xs font-medium">
          Categories:
        </span>
        {categories.map((item, index) => (
          <Badge
            variant={"outline"}
            className={"border-none p-0 text-neutral-600 font-medium"}
            key={index}
          >
            {item.label}-({item.value})
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
            {schedules?.map((schedule) => {
              // const employee = mockEmployees.find(
              //   (emp) => emp.id === schedule.employeeId
              // );
              return (
                <TableRow
                  key={schedule?.employeeId}
                  style={{
                    border: schedule.hasError ? "1px solid red" : "none",
                  }}
                >
                  <TableCell>{schedule?.employeeName}</TableCell>
                  {[
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ].map((day) => (
                    <TableCell key={day}>
                      <Select
                        value={
                          // every sunday  is a day off
                          day === "Sunday"
                            ? "OFF"
                            : schedule.schedule[day] || ""
                        }
                        onValueChange={(value) =>
                          handleScheduleChange(schedule.employeeId, day, value)
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
                    </TableCell>
                  ))}
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
              );
            })}
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

export default OldWeekRotaTable;
