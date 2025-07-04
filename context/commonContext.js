import { createContext, useContext } from "react";

export const CommonContext = createContext();

export function useCommonContext() {
  const context = useContext(CommonContext);
  if (!context) {
    throw new Error(
      "useCommonContext must be used within a CommonContextProvider"
    );
  }
  return context;
}
