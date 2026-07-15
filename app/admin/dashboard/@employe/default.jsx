// Fallback for the parallel-route slot. Next.js requires a default export for
// each slot; it renders the same content as the slot's page so behavior is
// identical whether Next serves `page` or `default`.
export { default } from "./page";
