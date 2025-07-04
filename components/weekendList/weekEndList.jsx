"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "../ui/dialog";
import { GlobalForm } from "../form/form";
import {
  createMeetingWithInvite,
  createTeamsMeeting,
  fetchAllUsers,
  fetchMe,
} from "@/server/integrationServer/integrationServer";
import { toast } from "sonner";
import { useFetchQuery } from "@/hooks/use-query";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export const WeekCalendarWithListEvent = () => {
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const fields = [
    {
      name: "title",
      labelText: "Title",
      type: "text",
      placeholder: "Enter Title",
      size: true,
      validationOptions: {
        required: "title is required",
      },
    },
    {
      name: "attendees",
      labelText: "Add Participants",
      type: "multipleSelect",
      placeholder: "Select participants",
    },
    {
      name: "date",
      labelText: "Date",
      type: "date",
    },
  ];

  const [activeDate, setActiveDate] = useState(new Date()); // Current selected date
  const [dates, setDates] = useState([]); // Dates of the current week
  const [isOpen, setIsOpen] = useState(false);

  const { data } = useFetchQuery({
    fetchFn: fetchAllUsers,
    queryKey: ["integrationsFatchAllUser"],
  });

  const { newData } = data || {};

  const getCurrentWeekDates = (date) => {
    let week = [];
    const curr = new Date(date); // Clone date to avoid mutation issues
    const firstDayOfWeek =
      curr.getDate() - (curr.getDay() === 0 ? 6 : curr.getDay() - 1);

    // Loop through the days of the week starting from Monday
    for (let i = 0; i < 7; i++) {
      const weekDate = new Date(curr);
      weekDate.setDate(firstDayOfWeek + i); // Set the date for each day of the week
      week.push(new Date(weekDate)); // Push a cloned date instance to avoid mutation
    }
    return week;
  };

  // Handler to get the next week
  const handleNextWeek = () => {
    const nextWeek = new Date(activeDate.setDate(activeDate.getDate() + 7));
    setActiveDate(nextWeek); // Update the activeDate to the next week's Monday
  };

  // Handler to get the previous week
  const handlePrevWeek = () => {
    const prevWeek = new Date(activeDate.setDate(activeDate.getDate() - 7));
    setActiveDate(prevWeek); // Update the activeDate to the previous week's Monday
  };

  useEffect(() => {
    const weekDates = getCurrentWeekDates(activeDate);
    setDates(weekDates); // Set the state to the current week's dates
  }, [activeDate]);

  const handleDateClick = (date) => {
    setActiveDate(date);
  };

  const handleSubmit = async (data) => {
    const res = await createMeetingWithInvite(data);
    if (res.requireConsent) {
      window.location.href = "/api/auth/microsoft?prompt=consent";
    } else if (!res.success) {
      toast.error(res.message);
    } else {
      toast.success("Meeting created!");
    }
  };

  return (
    <div className="">
      <Card className={"gap-0"}>
        <CardHeader
          className={
            "border-b border-gray-200 flex items-center justify-between"
          }
        >
          <div className="space-y-1">
            <CardTitle
              className={
                "flex items-center gap-1 text-neutral-800 tracking-tight text-sm"
              }
            >
              <CalendarCheck className="size-4" />
              {format(new Date(activeDate), "PPP")}
            </CardTitle>
            <CardDescription>Can see the all upcoming mettings</CardDescription>
          </div>
          {/* <!-- Button --> */}
          <Button
            type="button"
            size={"sm"}
            variant={"ghost"}
            className={"text-indigo-600 font-semibold"}
          >
            <Plus className="stroke-3" />
            Add Task
          </Button>
        </CardHeader>
        <CardContent className={"border-b border-gray-200 py-2"}>
          <div className="sm:gap-x-1 gap-x-0.5 justify-between items-center flex mt-2">
            <Button
              type="button"
              size={"icon"}
              className={"bg-gray-100 rounded-full"}
              onClick={handlePrevWeek}
            >
              <ChevronLeft className="size-5 text-gray-700" />
            </Button>
            {/* calc width of this div */}
            <div className=" overflow-scroll w-full">
              <div className="sm:gap-x-1 p-1 bg-white gap-x-0.5 items-center flex sm:w-full w-96 flex-none overflow-scroll">
                {dates?.map((date) => (
                  <button
                    key={date}
                    onClick={() => handleDateClick(date)}
                    type="button"
                    className={`rounded-lg w-full h-16 ${
                      date.getDate() === activeDate.getDate()
                        ? "bg-indigo-50 text-indigo-500 font-semibold"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }  dark:focus:bg-blue-500/20`}
                  >
                    <span className="block text-sm">
                      {weekday[date.getDay()] || new Date().getDay()}
                    </span>
                    <span className="block text-lg">{date.getDate()}</span>
                  </button>
                ))}
              </div>
            </div>
            <Button
              type="button"
              size={"icon"}
              className={"bg-gray-100 rounded-full"}
              onClick={handleNextWeek}
            >
              <ChevronRight className="size-5 text-gray-700" />
            </Button>
          </div>
        </CardContent>
        <CardContent>
          <div className="mt-5">
            {/* <!-- Events List Group --> */}
            <ul className="-space-y-px bg-white border border-neutral-200 rounded-xl flex-col flex">
              {/* <!-- List Item --> */}
              <li className=" first:border-t-0 border-neutral-200 border-t">
                <div className="sm:gap-y-0 sm:gap-x-3 sm:items-center sm:flex-row ps-0 p-3 gap-y-2 flex-col flex">
                  <div className="sm:ps-0 sm:ms-auto sm:order-2 ps-3">
                    <button
                      type="button"
                      className="shadow text-neutral-800 font-medium text-xs py-1.5 px-2 bg-white border rounded-lg border-neutral-200 gap-x-2 items-center inline-flex"
                    >
                      <span className="bg-rose-600 rounded-full size-2 absolute animate-ping"></span>
                      <span className="bg-rose-600 rounded-full size-2"></span>
                      Running
                    </button>
                  </div>
                  <div className="sm:order-1">
                    <button
                      type="button"
                      className="-ms-px group block text-start ps-[13px] border-rose-600 border-s-2 "
                    >
                      <span className="block text-neutral-800 font-medium text-sm text-start group-hover:text-blue-500">
                        12:30 PM - 14:00 PM
                      </span>
                      <span className="block text-neutral-500 text-sm">
                        Project onboarding with new teammates
                      </span>
                    </button>
                  </div>
                </div>
              </li>
              {/* <!-- End List Item --> */}

              {/* <!-- List Item --> */}
              <li className="border-t border-neutral-200">
                <div className="flex items-center p-3 gap-x-3">
                  <div className="flex items-center gap-x-2">
                    <p className="text-neutral-700 text-sm">3 files attached</p>
                  </div>
                </div>
              </li>
              {/* <!-- End List Item --> */}
            </ul>
            {/* <!-- End Events List Group --> */}
          </div>
        </CardContent>
        <CardContent>
          <Table>
            <TableCaption>{newData && newData?.length}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newData &&
                newData.map((items, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{items?.displayName}</TableCell>
                    <TableCell>{items?.mail}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {/* Add Task Model */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Share</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Metting</DialogTitle>
            <DialogDescription>
              Anyone who has this link will be able to view this.
            </DialogDescription>
          </DialogHeader>
          <GlobalForm fields={fields} onSubmit={handleSubmit} />
        </DialogContent>
      </Dialog>
    </div>
  );
};
