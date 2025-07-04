"use client";

import PasswordConfirmModal from "@/components/passwordConfirmModel";
import TwoFAConfirmModal from "@/components/TwoFAConfirmModel";
import { checkUserHas2FA } from "@/server/2FAServer/TwoAuthserver";
import { createContext, useCallback, useContext, useState } from "react";

const PasswordConfirmContext = createContext(null);

export const PasswordConfirmProvider = ({ children }) => {
  const [modelType, setModelType] = useState(null);
  const [resolver, setResolver] = useState(() => () => {});

  const requestConfirmation = useCallback(async () => {
    const has2FA = await checkUserHas2FA();
    setModelType(has2FA ? "2FA" : "password");
    return new Promise((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const handleSuccess = () => {
    setModelType(null);
    resolver(true);
  };

  const handleClose = () => {
    setModelType(null);
    resolver(false);
  };

  return (
    <PasswordConfirmContext.Provider value={requestConfirmation}>
      {children}
      <PasswordConfirmModal
        open={modelType === "password"}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
      <TwoFAConfirmModal
        open={modelType === "2FA"}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    </PasswordConfirmContext.Provider>
  );
};

export const usePasswordConfirm = () => {
  const context = useContext(PasswordConfirmContext);
  if (!context)
    throw new Error(
      "usePasswordConfirm must be used within a PasswordConfirmProvider"
    );
  return context;
};
