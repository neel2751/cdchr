import React from "react";
import { TableHead, TableHeader, TableRow } from "../ui/table";

const TableHeaderCom = ({ tableHead }) => {
  return (
    <TableHeader>
      <TableRow>
        {tableHead.map((item, index) => (
          <TableHead className="uppercase text-xs" key={index}>
            {item}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
};

export default TableHeaderCom;
