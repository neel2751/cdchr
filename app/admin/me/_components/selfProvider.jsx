"use client";

import { AvatarProvider } from "@/components/Avatar/AvatarContext";
import { CommonContext } from "@/context/commonContext";

/**
 * The context the shared employee components expect, filled in for "me".
 *
 * They were written for the HR detail page, where the record being looked at
 * comes out of the URL, so they read it from AvatarContext (`slug`) and
 * CommonContext (`searchParams`). Here there is no id in the URL by design, so
 * the server hands down the signed-in user's own — which is the only record
 * this area will ever show.
 *
 * The encrypted id is a transport detail, not a permission: the server actions
 * behind these components pin anyone without a staff-management permission to
 * their own record regardless of what id they are given (lib/employeeAccess.js).
 */
export default function SelfProvider({ slug, children }) {
  return (
    <AvatarProvider slug={slug} searchParams={{}}>
      <CommonContext.Provider value={{ slug, searchParams: slug }}>
        {children}
      </CommonContext.Provider>
    </AvatarProvider>
  );
}
