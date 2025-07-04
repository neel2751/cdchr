import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { isPast } from "date-fns";

export function EmployeeSidebar({ employee, selectedDate, onDateSelect }) {
  return (
    <div className="w-[290px] border-r bg-background">
      <div className="flex items-center gap-3 p-4 border-b">
        <Avatar className="h-10 w-10">
          <AvatarImage src="/placeholder.svg" alt={employee.name} />
          <AvatarFallback>{employee.name[0]}</AvatarFallback>
        </Avatar>
        <div>
          <h2 className="font-semibold">{employee.name}</h2>
          <p className="text-sm text-muted-foreground">{employee.title}</p>
        </div>
      </div>

      <div className="p-4 border-b">
        <h3 className="font-medium mb-2">Office Hours</h3>
        <p className="text-sm text-muted-foreground">
          {employee.schedule.startTime} - {employee.schedule.endTime}
        </p>
        <p className="text-sm text-muted-foreground">Monday - Saturday</p>
      </div>

      <Card className="m-4 border">
        <CardContent className="p-0">
          <Calendar
            mode="single"
            // everytime date is change , it will change here
            selectedDate={selectedDate}
            selected={selectedDate}
            onSelect={(date) => {
              if (date && date.getDay() !== 0) {
                // Prevent selecting Sundays
                onDateSelect(date);
              }
            }}
            disabled={(date) => {
              // Disable dates before today and Disable Sundays
              return isPast(date) || date.getDay() === 0;
            }}
            className={`w-full`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
