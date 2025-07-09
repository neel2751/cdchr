"use client";
import { Button } from "@/components/ui/button";
import { LaptopIcon, Trash2Icon, LogOutIcon, InfoIcon } from "lucide-react";
import { CardTitle } from "../ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { getSessionData } from "@/server/authServer/authServer";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";

export default function SessionManagement() {
  const { data } = useFetchQuery({
    fetchFn: getSessionData,
    queryKey: ["sessionData"],
  });
  const { newData } = data || {};

  return (
    <div>
      <CardTitle>Session Management</CardTitle>
      <ScrollArea className="h-[530px] w-full mt-2 border-t ">
        <div className="py-4">
          {/* <!-- Grid --> */}
          <div className="sm:gap-y-0 sm:gap-x-5 sm:grid-cols-12 grid">
            {/* <!-- End Col --> */}
            <div className="sm:col-span-12 col-span-12">
              {/* <!-- Grid --> */}
              <div className="xl:grid-cols-2 grid gap-5 2xl:grid-cols-3 grid-cols-1">
                {/* <!-- Card --> */}
                {newData &&
                  newData?.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex p-5 border-gray-200 border rounded-xl flex-col"
                    >
                      {/* <!-- Header --> */}
                      <div className="flex justify-between">
                        <Button size={"icon"} variant="outline">
                          <LaptopIcon />
                        </Button>
                        <Button size={"sm"} variant="outline">
                          <LogOutIcon />
                          Log out
                        </Button>
                      </div>
                      {/* <!-- End Header --> */}

                      {/* <!-- Heading --> */}
                      <div className="flex space-y-4 justify-between items-center">
                        <CardTitle className={"mt-4 text-base"}>
                          {item?.device || "Unknown Device"}
                        </CardTitle>
                        {idx === 0 ? (
                          <Badge
                            className={
                              "bg-indigo-100 text-indigo-800 rounded-full font-semibold"
                            }
                          >
                            Current session
                          </Badge>
                        ) : (
                          <Badge
                            className={
                              "bg-gray-100 text-gray-800 rounded-full font-semibold"
                            }
                          >
                            Previous session
                          </Badge>
                        )}
                      </div>
                      {/* <!-- End Heading --> */}

                      {/* <!-- List Group --> */}
                      <ul className="mt-2">
                        <li className="flex justify-between items-center">
                          <span className="text-gray-500 uppercase text-xs">
                            Location:
                          </span>
                          <span className="text-gray-800 text-sm">
                            {item?.city || "Unknown City"},{" "}
                            {item?.country || "Unknown Country"}
                          </span>
                        </li>

                        <li className="mt-2 flex justify-between items-center">
                          <span className="text-gray-500 uppercase text-xs">
                            Device:
                          </span>
                          <span className="text-gray-800 text-sm capitalize">
                            {item?.platform.split(" ") || "Unknown Device"}
                          </span>
                        </li>

                        <li className="mt-2 flex justify-between items-center">
                          <span className="text-gray-500 uppercase text-xs">
                            IP address:
                          </span>
                          <span className="text-gray-800 text-sm">
                            {item?.ipAddress || "Unknown IP Address"}
                          </span>
                        </li>

                        <li className="mt-2 flex justify-between items-center">
                          <span className="text-gray-500 uppercase text-xs">
                            Recent activity:
                          </span>
                          <span className="text-gray-800 text-sm">
                            {item?.createdAt || "No recent activity"}
                          </span>
                        </li>
                      </ul>
                      {/* <!-- End List Group --> */}
                      <div className="flex items-center mt-4 space-x-3 max-w-max">
                        <Button type="button" variant="outline">
                          <InfoIcon className="w-4 h-4 shrink-0" />
                          Don’t recognize something?
                        </Button>
                        {idx !== 0 && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="hover:bg-destructive text-destructive hover:text-white hover:border-none w-10"
                          >
                            <Trash2Icon className="w-4 h-4 shrink-0" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                {/* <!-- End Card --> */}
              </div>
              {/* <!-- End Grid --> */}
            </div>
            {/* <!-- End Col --> */}
          </div>
          {/* <!-- End Grid --> */}
        </div>
      </ScrollArea>
    </div>
  );
}
