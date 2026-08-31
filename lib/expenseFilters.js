/**
 * Shared vocabulary for the expense filters.
 *
 * A module of its own because the value is needed on both sides: the filter
 * dropdown writes it into the URL, and getAllExpenses reads it back. It cannot
 * live in server/expenseServer/expenseServer.js — that file is `"use server"`,
 * where every export has to be an async function.
 */

/**
 * The project filter meaning "not filed against any site".
 *
 * A sentinel rather than an empty string, because an absent `projectId` already
 * means "no project filter at all" and the two have to be distinguishable in a
 * query string. These are the rows the expense table labels "Office".
 */
export const OFFICE_PROJECT = "office";
