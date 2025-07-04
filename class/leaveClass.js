/**
 * @typedef {Object} LeaveOptions
 * @property {string} leaveType - The category of leave (e.g., Annual, Sick).
 * @property {number} total - Total number of leave days allocated.
 * @property {number} used - Number of leave days used.
 * @property {number} remaining - Number of leave days remaining.
 * @property {string} type - Type of leave (e.g., Paid, Unpaid).
 * @property {string|null} [extraType=null] - Optional secondary classification.
 * @property {boolean} [isHide=false] - Flag to hide this leave type.
 * @property {boolean} [isLock=false] - Flag to lock this leave type from edits.
 */

export default class Leave {
  /**
   * Creates an immutable Leave instance
   * @param {LeaveOptions} options - Configuration object for leave
   */
  constructor({
    leaveType,
    total,
    used,
    remaining,
    type,
    SSP = null,
    extraType = null,
    isHide = false,
    isLock = false,
    paid = null,
    isPaid = true,
  }) {
    // Input validation
    if (used + remaining > total) {
      throw new Error("Used + Remaining days cannot exceed Total days.");
    }
    if (SSP && extraType === null) {
      throw new Error("Extra Type is required if you pass SSP");
    }
    if (
      (leaveType === "Maternity Leave" || leaveType === "Paternity Leave") &&
      paid === null
    ) {
      throw new Error("Add the paid value");
    }

    this.leaveType = leaveType;
    this.total = total;
    this.used = used;
    this.remaining = remaining;
    this.type = type;
    this.SSP = SSP;
    this.extraType = extraType;
    this.paid = paid;
    this.isPaid = isPaid;
    this.isHide = isHide;
    this.isLock = isLock;

    // Make the instance immutable
    Object.freeze(this);
  }
}
