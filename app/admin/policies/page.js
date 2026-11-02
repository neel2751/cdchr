import { Suspense } from "react";
import PolicyLibrary from "./policyLibrary";

// The library's filters live in the address bar (see policyLibrary.jsx), read
// on the client — hence the boundary.
export default function Page() {
  return (
    <Suspense>
      <PolicyLibrary />
    </Suspense>
  );
}
