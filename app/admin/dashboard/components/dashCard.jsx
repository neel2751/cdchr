"use client";
import { CardInfo } from "./cardInfo";
import { BadgeCheck, BadgeX, Ban, Users } from "lucide-react";

const DashCount = ({ memoizedEmployeeData }) => {
  return (
    <>
      {memoizedEmployeeData &&
        memoizedEmployeeData?.map((item, index) => (
          <main
            key={index}
            className="flex flex-1 flex-col gap-4 px-4 md:gap-x-8 md:px-8 py-4"
          >
            <h1 className="text-lg font-semibold md:text-md text-neutral-700 ms-2">
              {item?.label}
            </h1>
            <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
              {item?.value &&
                item?.value?.map((cardItem, index) => {
                  let icon = "";
                  switch (cardItem?.icon) {
                    case "Users":
                      icon = <Users className="w-5 h-5 text-gray-600" />;
                      break;
                    case "BadgeCheck":
                      icon = <BadgeCheck className="w-5 h-5 text-green-600" />;
                      break;
                    case "BadgeX":
                      icon = <BadgeX className="w-5 h-5 text-rose-600" />;
                      break;
                    case "Ban":
                      icon = <Ban className="w-5 h-5 text-red-600" />;
                      break;
                    default:
                      icon = "";
                  }

                  return (
                    <CardInfo
                      key={index}
                      title={cardItem?.label}
                      value={cardItem?.value}
                      icon={icon}
                    />
                  );
                })}
            </div>
          </main>
        ))}
    </>
  );
};

export default DashCount;
