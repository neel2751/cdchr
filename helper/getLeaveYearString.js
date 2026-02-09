export function getLeaveYearString(date = new Date(), startMonth = 4) {
  // startMonth is 1–12 (Jan = 1, April = 4)
  const jsStartMonth = startMonth - 1; // convert to JS 0–11

  const year = date.getFullYear();
  const month = date.getMonth(); // 0–11

  let startYear;
  let endYear;

  if (month >= jsStartMonth) {
    startYear = year;
    endYear = year + 1;
  } else {
    startYear = year - 1;
    endYear = year;
  }

  return `${startYear}-${String(endYear).slice(-2)}`;
}

export function getPreviousLeaveYearString(targetLeaveYear, startMonth = 4) {
  // targetLeaveYear is in format "2025-26"
  const [startYearStr, endYearStr] = targetLeaveYear.split("-");
  const startYear = parseInt(startYearStr, 10);
  const endYear = parseInt(`20${endYearStr}`, 10);

  let prevStartYear;
  let prevEndYear;

  if (startMonth > 1) {
    prevStartYear = startYear - 1;
    prevEndYear = endYear - 1;
  } else {
    prevStartYear = startYear;
    prevEndYear = endYear;
  }

  return `${prevStartYear}-${String(prevEndYear).slice(-2)}`;
}

export function getNextLeaveYearString(targetLeaveYear, startMonth = 4) {
  // targetLeaveYear is in format "2025-26"
  const [startYearStr, endYearStr] = targetLeaveYear.split("-");
  const startYear = parseInt(startYearStr, 10);
  const endYear = parseInt(`20${endYearStr}`, 10);

  let nextStartYear;
  let nextEndYear;

  if (startMonth > 1) {
    nextStartYear = startYear + 1;
    nextEndYear = endYear + 1;
  } else {
    nextStartYear = startYear;
    nextEndYear = endYear;
  }

  return `${nextStartYear}-${String(nextEndYear).slice(-2)}`;
}

// const previousLeaveYearString = (({ leaveYearString }) => {
//   const [startYearStr, endYearStr] = leaveYearString.split("-");
//   const startYear = parseInt(startYearStr, 10);
//   const endYear = parseInt(`20${endYearStr}`, 10);

//   const prevStartYear = startYear - 1;
//   const prevEndYear = endYear - 1;

//   return `${prevStartYear}-${String(prevEndYear).slice(-2)}`;
// })();
