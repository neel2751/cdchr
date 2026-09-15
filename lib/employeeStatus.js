/**
 * Who counts as "currently on the books".
 *
 * This lived as four hand-written copies across the attendance and rota
 * servers, three of which had the comparison inverted and one of which OR'd
 * the two date checks together. Keeping the definition in one place is what
 * stops them drifting apart again.
 *
 * Three things have to hold:
 *   - the account is switched on (`isActive`) and not soft-deleted;
 *   - their right to work has not lapsed — no visa expiry on file, or one
 *     still in the future;
 *   - their employment has not ended — no end date on file, or one not yet
 *     reached.
 *
 * The two date checks are separate `$or` groups inside an `$and` on purpose.
 * A single flat `$or` across both fields is self-defeating: a British employee
 * has no `visaEndDate`, so "visaEndDate is absent" alone would satisfy the
 * whole clause and their past `endDate` would never be looked at.
 *
 * A missing date means "not applicable", never "expired" — most staff have no
 * visa expiry, and plenty have no agreed end date.
 *
 * @param {Date} [asOf] point in time to judge against; defaults to now.
 * @returns {object} a match fragment to spread into a query or `$match`.
 */
export function currentlyEmployedMatch(asOf = new Date()) {
  return {
    isActive: true,
    delete: { $ne: true },
    $and: [
      {
        $or: [
          { visaEndDate: null },
          { visaEndDate: { $exists: false } },
          { visaEndDate: { $gt: asOf } },
        ],
      },
      {
        $or: [
          { endDate: null },
          { endDate: { $exists: false } },
          { endDate: { $gte: asOf } },
        ],
      },
    ],
  };
}
