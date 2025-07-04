import React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { TableStatus } from "./status";

const TableSheet = ({ data, tableName, tableDesc, title, description }) => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <div>{tableName}</div>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto h-auto">
        <SheetHeader>
          <div className="mb-6">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </div>
          <div className="overflow-y-auto h-auto">
            {/* <!-- Header --> */}
            <div className="flex items-center justify-center flex-col text-center">
              <Avatar className="border border-neutral-200 p-0.5 shadow">
                {/* Replace With CDC Logo */}
                <AvatarImage src="https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg" />
                <AvatarFallback>Hr Management</AvatarFallback>
              </Avatar>
              <div className="mt-2">
                <h3 className="text-lg text-gray-800 font-semibold">
                  {tableName ?? "HR"}
                </h3>
                <p className="text-xs text-gray-500">{tableDesc}</p>
              </div>
            </div>
            {/* <!-- End Header --> */}
            <ul className="mt-5">
              {data.map((emp) => (
                <li
                  key={emp.label}
                  className="flex items-center gap-x-4  border-t border-gray-200 p-4"
                >
                  <span className="text-sm text-gray-500 whitespace-nowrap">
                    {emp.label}
                  </span>
                  <span className="text-sm text-gray-800 whitespace-nowrap">
                    {emp?.status ? (
                      <TableStatus isActive={emp.value} />
                    ) : (
                      emp.value
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
};

export default TableSheet;
