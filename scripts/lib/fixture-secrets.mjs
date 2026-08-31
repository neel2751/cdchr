/**
 * Constants shared between the fixture seeder and the tests that consume it.
 *
 * A module of its own because `seed-dev-fixtures.mjs` calls `main()` at import
 * time: importing a constant from there would silently run the seeder, which is
 * how an end-to-end run first tried to reseed the production cluster. (It was
 * refused — the script checks the host — but nothing should depend on that.)
 */

/**
 * TOTP secret for the privileged fixture accounts.
 *
 * auth.js forces every admin and super admin through two-factor, so without a
 * known secret no fixture account could sign in and the gate would have to be
 * weakened for tests. Instead the fixtures enable 2FA properly and the tests
 * generate real codes.
 *
 * Fixture-only. The seeder that writes it refuses any non-local database.
 */
export const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

/** Every fixture account uses this password. */
export const FIXTURE_PASSWORD = "Password123!dev";
