import { Button } from "@/components/ui/button";
import LeaveContainer from "./LeaveContainer";

export function LeaveRequestForm() {
  return <LeaveContainer />;
}

export const AddLeaveRequest = ({ onAdd, title }) => (
  <Button onClick={onAdd}>{title || "Add Leave Request"}</Button>
);
