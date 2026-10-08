/**
 * Password strength and generation, shared by every screen that sets one.
 *
 * The scorer lived inside app/signup/signupForm.jsx, so the sign-up form told
 * people how strong their password was and the admin reset dialog — the screen
 * that hands someone else a password — said nothing at all. One definition
 * means the two cannot disagree about what "Strong" means.
 *
 * Deliberately dependency-free so a dialog, a form and a server action can all
 * use it.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** Rough password strength, 0-4. Guidance for the person, never a gate. */
export function passwordScore(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

export const STRENGTH = [
  { label: "", bar: "" },
  { label: "Weak", bar: "bg-rose-500" },
  { label: "Fair", bar: "bg-amber-500" },
  { label: "Good", bar: "bg-lime-500" },
  { label: "Strong", bar: "bg-emerald-500" },
];

/** The descriptor for a password, ready to render. */
export function describeStrength(password) {
  const score = passwordScore(password);
  return { score, ...STRENGTH[score] };
}

// Ambiguous characters are left out on purpose: an admin generating a password
// usually has to read it to somebody, and 1/l/I and 0/O are where that goes
// wrong. The set is still large enough that 16 characters is far beyond
// anything that gets guessed.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/**
 * A random password that always scores "Strong".
 *
 * One character is taken from each set first so the result cannot come out
 * missing a class and scoring lower than the generator promises, then the rest
 * are drawn from the full alphabet and the whole thing is shuffled — otherwise
 * the first four positions would always be upper/lower/digit/symbol in order.
 *
 * Uses `crypto.getRandomValues` where it exists (every browser, and node 19+)
 * and falls back to Math.random only if it does not, which no supported target
 * does.
 */
export function generatePassword(length = 16) {
  const size = Math.max(12, length);

  const randomBytes = (n) => {
    const out = new Uint32Array(n);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(out);
      return out;
    }
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 2 ** 32);
    return out;
  };

  const bytes = randomBytes(size);
  const pick = (set, i) => set[bytes[i] % set.length];

  const chars = [
    pick(UPPER, 0),
    pick(LOWER, 1),
    pick(DIGITS, 2),
    pick(SYMBOLS, 3),
  ];
  for (let i = 4; i < size; i++) chars.push(pick(ALL, i));

  // Fisher-Yates, so the guaranteed characters are not always at the front.
  const shuffle = randomBytes(chars.length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
