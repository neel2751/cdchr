import {
  FilterDataTableBody,
  FilterDataTableHead,
} from "@/components/filterTable/filterTable";
import { Table } from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import React from "react";

const FilterTable = () => {
  const { data } = useCommonContext();

  return (
    <Table>
      <FilterDataTableHead attendanceData={data || []} />
      <FilterDataTableBody attendanceData={data || []} />
    </Table>
  );
};

export default FilterTable;
