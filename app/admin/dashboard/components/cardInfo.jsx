import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, CircleSlash, OctagonPause, Siren } from "lucide-react";

export const CardInfo = ({ title, value, color, icon, description }) => {
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className={`text-sm font-medium ${color}`}>
            {title || "No Title"}
          </CardTitle>
          {/* <PoundSterling className="h-4 w-4 text-green-700" /> */}
          {title === "Active" && <Siren className="w-5 h-5 text-green-600" />}
          {title === "On Hold" && (
            <OctagonPause className="w-5 h-5 text-amber-600" />
          )}
          {title === "Completed" && (
            <CalendarCheck className="w-5 h-5 text-blue-600" />
          )}
          {title === "No Status" && (
            <CircleSlash className="w-5 h-5 text-neutral-500" />
          )}
          {icon && icon}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value || 0}</div>
          <p className="text-xs text-muted-foreground">
            {description && description}
          </p>
        </CardContent>
      </Card>
    </>
  );
};
