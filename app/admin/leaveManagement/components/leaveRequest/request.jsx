import { Button } from "@/components/ui/button";
import LeaveContainer from "./LeaveContainer";

export function LeaveRequestForm() {
  return <LeaveContainer />;
}

export const AddLeaveRequest = ({ onAdd }) => (
  <Button onClick={onAdd}>Leave Request</Button>
);
