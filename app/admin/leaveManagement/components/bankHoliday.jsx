"use client";

// This component has always been a client component — it runs useBankHoliday(),
// useBankHolidayRule() and useState. It got away without the directive because
// its only importer was _components/menu.js, which is "use client", so it
// inherited the boundary. Imported directly by a server page it was treated as
// a server module and threw "Attempted to call useQuery() from the server".
// Stating it here makes the component correct wherever it is used, rather than
// correct only when reached through one particular file.
import {
  CardTitle,
  Card,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { useBankHoliday, useBankHolidayRule } from "@/lib/holiday";
import { BANK_HOLIDAY_REGIONS } from "@/data/bankHolidayRegions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { format, getYear, isPast } from "date-fns";
import { StarIcon } from "lucide-react";
import Image from "next/image";
import React from "react";

export const BankHoliday = ({ className }) => {
  // Which list is being *looked at*. Purely a view control: it starts on the
  // company's configured nation so the tab shows the days that actually apply,
  // and switching it browses another nation's without saving anything. The
  // setting that decides whether the office closes — and which list the leave
  // engine charges against — lives in Settings and is untouched by this.
  const { observes, region: configuredRegion } = useBankHolidayRule();
  const [viewRegion, setViewRegion] = React.useState(null);
  const region = viewRegion ?? configuredRegion;
  // Viewing a nation that is not this company's. The cards are tinted for it so
  // a screenshot or a glance cannot be mistaken for the company's own days off —
  // the caption above says so, but a caption is easy to scroll past.
  const isOtherNation = region !== configuredRegion;
  const regionLabel = BANK_HOLIDAY_REGIONS.find((r) => r.value === region)?.label;

  const { isLoading, isError, error, data } = useBankHoliday(region);

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


  // Rendered on every branch below — including the loading, error and empty
  // states. A switcher that disappears when a list fails to load would strand
  // whoever used it to get there.
  const regionSwitcher = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs value={region} onValueChange={setViewRegion}>
        <TabsList>
          {BANK_HOLIDAY_REGIONS.map((r) => (
            <TabsTrigger key={r.value} value={r.value} className="text-xs">
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        {region === configuredRegion
          ? observes
            ? "The days your company is closed."
            : "For reference — your company works bank holidays, so these are ordinary working days."
          : "Viewing another nation's dates. This does not change your settings."}
      </p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="mt-4 space-y-2">
        {regionSwitcher}
        <p className="text-sm text-muted-foreground">
          Loading bank holidays...
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-4 space-y-2">
        {regionSwitcher}
        <p className="text-sm text-red-600">
          {error?.message || "Could not load bank holidays."} Please try again
          later.
        </p>
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="mt-4 space-y-2">
        {regionSwitcher}
        <p className="text-sm text-muted-foreground">
          No bank holidays found.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {regionSwitcher}
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
              {/* Names the nation when it is not the company's own, so a
                  screenshot of this list carries its own context rather than
                  relying on the caption above still being on screen. */}
              Bank Holidays in {year}
              {isOtherNation ? ` — ${regionLabel}` : ""}
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
                    <Card
                      className={cn(
                        "group cursor-pointer",
                        isOtherNation &&
                          "border-dashed border-amber-300 bg-amber-50/60"
                      )}
                    >
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
