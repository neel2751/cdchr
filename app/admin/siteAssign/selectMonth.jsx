import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCommonContext } from "@/context/commonContext";
import React from "react";

const SelectMonth = () => {
  const { filter, setFilter } = useCommonContext();
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return (
    <Card className="bg-white rounded-lg shadow-md p-2 overflow-scroll">
      <div className="flex space-x-6 items-center justify-center">
        {months.map((month, index) => (
          // we get current month active
          <Button
            key={month}
            onClick={() => setFilter({ ...filter, month: index + 1 })}
            variant={index + 1 === filter.month ? "" : "secondary"}
            className="text-xs"
          >
            {month}
          </Button>
        ))}
      </div>
    </Card>
  );
};

export default SelectMonth;
