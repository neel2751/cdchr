// Flat ESLint config for Next.js 16 (the `next lint` command was removed in
// Next 16, so linting now runs through the ESLint CLI: `npm run lint`).
// `eslint-config-next/core-web-vitals` already exports a flat-config array that
// bundles the Next.js, React, and core-web-vitals rules plus sensible ignores.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "out/**", "build/**", "node_modules/**"],
  },
];

export default eslintConfig;
