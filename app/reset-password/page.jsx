import ResetPasswordForm from "./resetForm";

/**
 * AWAITED, because `searchParams` is a Promise.
 *
 * It has been one since Next 15 and this app is on 16. Read synchronously,
 * `searchParams?.uid` is a property lookup on a Promise — so it is `undefined`,
 * with no error and no warning anywhere. Both values arrived empty, the form's
 * own `!uid || !token` guard fired, and every invited employee was told "This
 * link is invalid. Please request a new one."
 *
 * Which made it look like two faults instead of one. Requesting a new link
 * worked perfectly — minted a token, sent the mail — and delivered the person
 * back to this page, where the same thing happened again. Nothing was wrong
 * with the token, the email or the account; the id and the token never reached
 * the component that needed them.
 *
 * app/clock/page.jsx does this correctly and is worth copying from. An audit
 * guards against the next one: npm run audit:async-params.
 */
export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams;
  return (
    <ResetPasswordForm
      uid={params?.uid || ""}
      token={params?.token || ""}
      // Wording only. A new employee setting their first password is not
      // "resetting" anything; the token is what grants access, and this flag
      // grants nothing.
      welcome={params?.welcome === "1"}
    />
  );
}
