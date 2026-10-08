import ClockProviders from "./providers";

/**
 * Client-side providers for the tap page.
 *
 * `/clock` sits outside /admin, /employee and /hr, so it inherits none of
 * their shells — and the root layout provides nothing. Without this,
 * `useSession()` returns undefined and the page crashes before it renders:
 * an NFC tap opens a blank screen, on every phone, with the failure visible
 * only in a browser console nobody standing at a gate is going to open.
 */
export default function ClockLayout({ children }) {
  return <ClockProviders>{children}</ClockProviders>;
}
