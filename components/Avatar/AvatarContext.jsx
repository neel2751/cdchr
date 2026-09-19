"use client";
import { useFetchQuery } from "@/hooks/use-query";
import { getEmployeeWiseData } from "@/server/employeServer/employeServer";
import { employeeDeatils } from "@/server/officeServer/officeEmployeeDetails";
import { createContext, useContext, useMemo } from "react";

/**
 * The employee record the screens under it are about.
 *
 * `selectedAvatar` used to live here: a picture chosen from a strip of stock
 * faces and kept in localStorage under one shared key. It was never anybody's
 * photo — it was whatever the last person to use this browser picked, shown as
 * every employee's portrait on every record. Employees have real photos now
 * (`newData.profileImage`), so the stock list and its localStorage key are gone.
 */

// create a context
const AvatarContext = createContext();

// create a provider
const AvatarProvider = ({ slug, children, searchParams }) => {
  const queryKey = ["employeeDeatils", slug];
  const { data } = useFetchQuery({
    params: slug,
    fetchFn: employeeDeatils,
    queryKey,
    enabled: !!slug,
  });

  const { newData } = data || {};

  const memoData = useMemo(() => newData, [newData]);

  return (
    <AvatarContext.Provider
      value={{
        newData: memoData,
        slug,
        searchParams,
      }}
    >
      {children}
    </AvatarContext.Provider>
  );
};

// create a hook
const useAvatar = () => {
  const context = useContext(AvatarContext);
  if (!context) {
    throw new Error("useAvatar must be used within an AvatarProvider");
  }
  return context;
};

const SiteEmployeeContext = createContext();
// create a provider for site employee context
const SiteEmployeeProvider = ({ children, slug, searchParams }) => {
  const queryKey = ["employeeDeatils", slug];
  const { data } = useFetchQuery({
    params: slug,
    fetchFn: getEmployeeWiseData,
    queryKey,
    enabled: !!slug,
  });

  const { newData } = data || {};

  const memoData = useMemo(() => newData, [newData]);

  return (
    <SiteEmployeeContext.Provider
      value={{
        newData: memoData,
        slug,
        searchParams,
      }}
    >
      {children}
    </SiteEmployeeContext.Provider>
  );
};

// create a hook for site employee context
const useSiteEmployee = () => {
  const context = useContext(SiteEmployeeContext);
  if (!context) {
    throw new Error(
      "useSiteEmployee must be used within a SiteEmployeeProvider"
    );
  }
  return context;
};

export { AvatarProvider, useAvatar, SiteEmployeeProvider, useSiteEmployee };
