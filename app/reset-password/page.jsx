import ResetPasswordForm from "./resetForm";

export default function ResetPasswordPage({ searchParams }) {
  return (
    <ResetPasswordForm
      uid={searchParams?.uid || ""}
      token={searchParams?.token || ""}
      // Wording only. A new employee setting their first password is not
      // "resetting" anything; the token is what grants access, and this flag
      // grants nothing.
      welcome={searchParams?.welcome === "1"}
    />
  );
}
