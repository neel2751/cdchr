import { timeZoneLabel } from "@/lib/timeZone";

// Names the place a clock time was taken in, beside the time. UK times carry
// no tag — an unlabelled time in the app has always meant UK time.
export default function TimeZoneTag({ timeZone }) {
  const label = timeZoneLabel(timeZone);
  if (!label) return null;
  return (
    <span className="text-xs font-normal text-muted-foreground">
      ({label})
    </span>
  );
}
