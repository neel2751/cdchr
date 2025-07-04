import React from "react";

const Shimmer = ({ length }) => {
  return (
    <tbody>
      {Array.from({ length: length }, (_, i) => i + 1).map((id) => (
        <tr key={id} className=" animate-pulse">
          {Array.from({ length: length }, (_, j) => j + 1).map((id) => (
            <td key={id} className=" border-b border-gray-200 p-4">
              <div className="bg-gray-200 rounded-lg h-10"></div>
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
};

export default Shimmer;
