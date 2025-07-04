"use client";
import { useFetchQuery } from "@/hooks/use-query";
import { employeeDeatils } from "@/server/officeServer/officeEmployeeDetails";
import { createContext, useState, useContext, useEffect, useMemo } from "react";

// create a context
const AvatarContext = createContext();

// create a provider
const AvatarProvider = ({ slug, children }) => {
  const [selectedAvatar, setSelectedAvatar] = useState(null); // Don't use localStorage here
  const [isClient, setIsClient] = useState(false); // to ensure client-only logic

  useEffect(() => {
    setIsClient(true);
    const savedAvatar =
      localStorage.getItem("selectedAvatar") ||
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/9439775.jpg-4JVJWOjPksd3DtnBYJXoWHA5lc1DU9.jpeg";
    setSelectedAvatar(savedAvatar);
  }, []);

  useEffect(() => {
    if (isClient && selectedAvatar) {
      localStorage.setItem("selectedAvatar", selectedAvatar);
    }
  }, [selectedAvatar, isClient]);

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
      value={{ selectedAvatar, setSelectedAvatar, newData: memoData, slug }}
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

export { AvatarProvider, useAvatar };
