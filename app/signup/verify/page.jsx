import VerifySignup from "./verifyClient";
import { PLATFORM_APP_NAME } from "@/lib/tenant";

export const metadata = {
  title: `Confirming your workspace | ${PLATFORM_APP_NAME}`,
};

export default async function VerifySignupPage({ searchParams }) {
  const params = (await searchParams) || {};
  return <VerifySignup token={params.token || ""} />;
}
