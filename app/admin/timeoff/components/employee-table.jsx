"use client";
import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import fetchEmployeeWithHoliday from "@/server/timeOffServer/timeOffServer";
import { BellElectric, Clock, Coffee } from "lucide-react";
import { useState } from "react";

export default function EmployeeTableTimeOff() {
  const [data, setData] = useState([]);
  const handleButton = async () => {
    const result = await fetchEmployeeWithHoliday();
    if (result.success) {
      setData(JSON.parse(result?.data));
    }
  };

  return (
    <>
      <Button onClick={handleButton}>Test</Button>
      <Table>
        <TableHeaderCom
          tableHead={[
            "id",
            "Name",
            "ClockIn",
            "Break",
            "Clock Out",
            "Total Hours",
            "Actions",
          ]}
        />
        <TableBody>
          {data &&
            data?.map((item, index) => (
              <TableRow key={index}>
                <TableCell>{item?.name}</TableCell>

                <TableCell>
                  <div className="flex gap-4 items-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={item?.leaveStartDate}
                    >
                      <Clock />
                      Clock In
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={item?.leaveStartDate}
                    >
                      <Coffee />
                      Break
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={item?.leaveStartDate}
                    >
                      <BellElectric />
                      Clock Out
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </>
  );
}
