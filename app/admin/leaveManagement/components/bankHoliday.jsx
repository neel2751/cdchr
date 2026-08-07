import {
  CardTitle,
  Card,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { useBankHoliday } from "@/lib/holiday";
import { cn } from "@/lib/utils";
import { format, getYear, isPast } from "date-fns";
import { StarIcon } from "lucide-react";
import Image from "next/image";
import React from "react";

export const BankHoliday = ({ className }) => {
  const { isLoading, isError, error, data } = useBankHoliday();

  // find the next bank holiday
  const nextBankHoliday = data?.find((holiday) => {
    return isPast(new Date(holiday?.date)) === false;
  });

  // we have to with year wise
  const yearWiseDate = data?.reduce((acc, holiday) => {
    const year = format(new Date(holiday?.date), "yyyy");
    if (!acc[year]) {
      acc[year] = [];
    }
    acc[year].push(holiday);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Loading bank holidays...
      </p>
    );
  }

  if (isError) {
    return (
      <p className="mt-4 text-sm text-red-600">
        {error?.message || "Could not load bank holidays."} Please try again
        later.
      </p>
    );
  }

  if (!data?.length) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No bank holidays found.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {/* <p>Bank Holidays: {data?.length}</p> */}
      {/* Show list of bank holidays */}
      {yearWiseDate &&
        Object?.entries(yearWiseDate).map(([year, dateList]) => (
          <div key={year} className="space-y-2">
            <CardTitle
              className={`${
                getYear(new Date()) === Number(year)
                  ? "text-white bg-linear-to-tr from-indigo-700 via-indigo-800 to-indigo-900 max-w-max py-0.5 px-2 rounded-sm text-center text-xs"
                  : "text-neutral-600 my-2 text-sm"
              }`}
            >
              Bank Holidays in {year}
            </CardTitle>
            <ul
              className={cn(
                "grid xl:grid-cols-4 md:grid-cols-2 gap-4",
                className
              )}
            >
              {dateList &&
                dateList?.map((holiday, index) => (
                  // make header as year
                  <li key={index}>
                    <Card className="group cursor-pointer">
                      <CardHeader
                        className={`sm:ps-24 rounded-md relative ${
                          isPast(new Date(holiday?.date))
                            ? "opacity-40"
                            : nextBankHoliday?.date === holiday?.date
                            ? ""
                            : "opacity-50"
                        }`}
                      >
                        <div className="flex items-center gap-x-3">
                          <div className="hidden sm:block -start-0 -bottom-3 absolute">
                            {/* <div className="text-7xl">🏕️</div> */}
                            <Image
                              // in src after index is equal 8  image repeat again 1 to 8 index image
                              src={`/images/bankHoliday/${(index % 8) + 1}.svg`}
                              // src={`/images/bankHoliday/${index + 1}.svg`}
                              alt={holiday?.title}
                              width={80}
                              height={80}
                              className="group-hover:scale-110 transition duration-300"
                            />
                          </div>
                          <div className="grow space-y-1">
                            <CardTitle
                              className={`${
                                isPast(new Date(holiday?.date))
                                  ? "text-gray-400"
                                  : ""
                              }`}
                            >
                              {holiday?.title}
                            </CardTitle>
                            <CardDescription>
                              {format(holiday?.date, "E, MMMM d, yyyy")}
                            </CardDescription>
                          </div>
                          {/* Optional chaining: late in the year every
                              remaining holiday is past, leaving no "next" one. */}
                          {nextBankHoliday?.date === holiday?.date && (
                            <StarIcon className="size-3 top-4 absolute right-2 fill-indigo-600 text-indigo-600" />
                            // <div className="text-xl">🌟 </div>
                          )}
                        </div>
                      </CardHeader>
                    </Card>
                  </li>
                ))}
            </ul>
          </div>
        ))}
    </div>
  );
};
