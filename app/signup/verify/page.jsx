import VerifySignup from "./verifyClient";

export const metadata = {
  title: "Confirming your workspace | HR Management",
};

export default async function VerifySignupPage({ searchParams }) {
  const params = (await searchParams) || {};
  return <VerifySignup token={params.token || ""} />;
}
