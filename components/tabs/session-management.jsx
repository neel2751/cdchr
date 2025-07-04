"use client";
import { Button } from "@/components/ui/button";
import { LaptopIcon, Trash2Icon, LogOutIcon, InfoIcon } from "lucide-react";
import { CardTitle } from "../ui/card";

export default function SessionManagement() {
  return (
    <div>
      <CardTitle>Onboarding Status</CardTitle>
      <div className="py-8">
        {/* <!-- Grid --> */}
        <div className="sm:gap-y-0 sm:gap-x-5 sm:grid-cols-12 grid mb-4">
          {/* <!-- End Col --> */}
          <div className="sm:col-span-12 col-span-12">
            {/* <!-- Grid --> */}
            <div className="xl:grid-cols-2 grid gap-5 2xl:grid-cols-3 grid-cols-1">
              {/* <!-- Card --> */}
              {[1, 2, 3, 4].map((_, idx) => (
                <div
                  key={idx}
                  className="flex p-5 border-gray-200 border rounded-xl flex-col"
                >
                  {/* <!-- Header --> */}
                  <div className="flex justify-between">
                    <div className="flex items-center border border-gray-200 rounded-lg justify-center flex-col size-10">
                      <LaptopIcon className="w-5 h-5 text-gray-500" />
                    </div>

                    <button
                      type="button"
                      className=" inline-flex items-center shadow-sm text-gray-800 font-semibold text-sm px-3 py-2 bg-white border gap-x-2 rounded-lg focus:outline-none hover:bg-gray-200"
                    >
                      <LogOutIcon className=" shrink-0 w-3 h-3" />
                      Sign out
                    </button>
                  </div>
                  {/* <!-- End Header --> */}

                  {/* <!-- Heading --> */}
                  <div className="flex space-y-4 justify-between items-center">
                    <span className="font-semibold text-gray-800 mt-1">
                      Mac
                    </span>
                    {idx === 0 && (
                      <span className="inline-flex items-center font-semibold text-xs px-2 py-1 bg-indigo-100 rounded-full gap-2 text-indigo-800">
                        Current session
                      </span>
                    )}
                  </div>
                  {/* <!-- End Heading --> */}

                  {/* <!-- List Group --> */}
                  <ul className="mt-4">
                    <li className="flex justify-between items-center">
                      <span className="text-gray-500 uppercase text-xs">
                        Location:
                      </span>
                      <span className="text-gray-800 text-sm">
                        United Kingdom
                      </span>
                    </li>

                    <li className="mt-2 flex justify-between items-center">
                      <span className="text-gray-500 uppercase text-xs">
                        Device:
                      </span>
                      <span className="text-gray-800 text-sm">
                        Safari - iOS
                      </span>
                    </li>

                    <li className="mt-2 flex justify-between items-center">
                      <span className="text-gray-500 uppercase text-xs">
                        IP address:
                      </span>
                      <span className="text-gray-800 text-sm">
                        129.562.028.172
                      </span>
                    </li>

                    <li className="mt-2 flex justify-between items-center">
                      <span className="text-gray-500 uppercase text-xs">
                        Recent activity:
                      </span>
                      <span className="text-gray-800 text-sm">
                        5 minutes ago
                      </span>
                    </li>
                  </ul>
                  {/* <!-- End List Group --> */}
                  <div className="flex items-center mt-4 space-x-3">
                    <Button type="button" variant="outline" className="w-full">
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
    </div>
  );
}
