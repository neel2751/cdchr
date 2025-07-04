import { createContext, useContext } from "react";

export const FilterAttendanceContext = createContext();

export const useFilterAttendanceContext = () => {
  const context = useContext(FilterAttendanceContext);
  if (!context) {
    throw new Error(
      "useFilterAttendanceContext must be used within a FilterAttendanceContext Provider"
    );
  }
  return context;
};
export default useFilterAttendanceContext;
