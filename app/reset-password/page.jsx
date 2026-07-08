import ResetPasswordForm from "./resetForm";

export default function ResetPasswordPage({ searchParams }) {
  return (
    <ResetPasswordForm
      uid={searchParams?.uid || ""}
      token={searchParams?.token || ""}
    />
  );
}
