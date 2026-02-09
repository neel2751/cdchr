export function applyCarryForwardToLeaves(
  oldLeaveData,
  newLeaveData,
  settings
) {
  if (!settings.carryForwardEnabled) return newLeaveData;

  for (const rule of settings.carryForwardRules) {
    if (!rule.allowed) continue;

    const oldLeave = oldLeaveData.find((l) => l.leaveType === rule.leaveType);

    const newLeave = newLeaveData.find((l) => l.leaveType === rule.leaveType);

    if (!oldLeave || !newLeave) continue;

    const carryAmount = Math.min(oldLeave.remaining, rule.maxDays || 0);

    if (carryAmount > 0) {
      newLeave.total += carryAmount;
      newLeave.remaining += carryAmount;

      // 🔹 Mark as carried forward (for UI + expiry later)
      newLeave.carriedForward = carryAmount;
      newLeave.carryExpiryMonths = rule.expiryMonths;
    }
  }

  return newLeaveData;
}
