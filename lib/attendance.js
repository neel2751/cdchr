export function calculateTotalHoursGemini(hours, breakHours, extraHours) {
  // Extract hours and minutes from user input
  const extractHoursAndMinutes = (time) => {
    let hoursPart = Math.floor(time);
    let minutesPart = Math.round((time - hoursPart) * 100); // Treat everything after decimal as minutes

    if (minutesPart >= 60) {
      // Convert minutes exceeding 59 to additional hours
      hoursPart += Math.floor(minutesPart / 60);
      minutesPart = minutesPart % 60;
    }

    return { hours: hoursPart, minutes: minutesPart };
  };

  const { hours: totalHours, minutes: totalMinutesFromInput } =
    extractHoursAndMinutes(hours);
  const { hours: breakHoursInt, minutes: breakMinutes } =
    extractHoursAndMinutes(breakHours);
  const { hours: extraHoursInt, minutes: extraMinutes } =
    extractHoursAndMinutes(extraHours);

  // Convert all to minutes
  const totalMinutes = totalHours * 60 + totalMinutesFromInput;
  const breakMinutesTotal = breakHoursInt * 60 + breakMinutes;
  const extraMinutesTotal = extraHoursInt * 60 + extraMinutes;

  // Calculate net minutes
  const netMinutes = totalMinutes - breakMinutesTotal + extraMinutesTotal;

  // Calculate total hours and remaining minutes
  const totalHoursResult = Math.floor(netMinutes / 60);
  const remainingMinutes = netMinutes % 60;
  const finalHour = parseFloat(
    `${totalHoursResult}.${remainingMinutes}`
  ).toFixed(2);
  return finalHour;

  // return { totalHours: totalHoursResult, totalMinutes: remainingMinutes };
}

export const calculateTotalPayForRows = (editableRows) => {
  let totalPayForAllRows = 0;

  // Iterate over each row in editableRows
  Object.keys(editableRows).forEach((id) => {
    const row = editableRows[id];
    // Extract total hours and pay rate for the current row
    const totalHours = parseFloat(row.totalHours || 0);
    const payRate = parseFloat(row.payRate || 0);

    // Calculate total pay for the current row
    const totalPayForRow = totalHours * payRate;

    // Add total pay for the current row to the total pay for all rows
    totalPayForAllRows += totalPayForRow;
  });

  const totalPay = totalPayForAllRows.toFixed(2);
  if (totalPay < 0) {
    // setHours("");
    // setBreakHours("");
    // setExtraHours("");
    toast.error(
      "Total pay cannot be less than 0. Please review your hours and pay rate.",
      // `Invalid input! Total Pay should be greater than or equal to zero.`
      {
        closeButton: false, // Hide the close button
      }
    );
  }
  // Round total pay for all rows to two decimal places
  return totalPay;
};

export function changeDateToString(date) {
  const options = { year: "numeric", month: "short", day: "numeric" };
  return new Date(date).toLocaleDateString("en-GB", options);
}
