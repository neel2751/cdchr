"use client";
import { useToast } from "@/hooks/use-toast";
import { getServerSideProps } from "@/server/session/session";
import { createContext, useContext, useEffect, useState } from "react";

const SessionContext = createContext();

// SessionProvider component that fetches and provides session data
export default function SessionProvider({ children }) {
  const [session, setSession] = useState(null);

  const getSession = async () => {
    const { props } = await getServerSideProps();
    setSession(props?.session?.user || null);
  };

  useEffect(() => {
    getSession();
  }, []);

  return (
    <SessionContext.Provider value={{ session }}>
      {children}
    </SessionContext.Provider>
  );
}

// Custom hook to access session context
export const useSessionContext = () => {
  const { toast } = useToast();
  const context = useContext(SessionContext);

  // Display toast if session is not found
  if (!context?.session) {
    toast({
      title: "You are not authorized to access this page",
      description: "Session not found",
    });
  }

  return context;
};
