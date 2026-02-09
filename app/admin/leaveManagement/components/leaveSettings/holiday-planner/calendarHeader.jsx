export default function CalendarHeader({
  month,
  year,
  onChangeMonth,
  onChangeYear,
}) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return (
    <div className="flex items-center justify-between">
      <button
        onClick={() =>
          month === 0
            ? (onChangeMonth(11), onChangeYear(year - 1))
            : onChangeMonth(month - 1)
        }
      >
        ◀
      </button>

      <h2 className="text-xl font-semibold">
        {monthNames[month]} {year}
      </h2>

      <button
        onClick={() =>
          month === 11
            ? (onChangeMonth(0), onChangeYear(year + 1))
            : onChangeMonth(month + 1)
        }
      >
        ▶
      </button>
    </div>
  );
}
