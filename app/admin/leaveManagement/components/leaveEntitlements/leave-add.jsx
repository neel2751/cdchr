import { addOneCommonLeaveToOneEmployee } from "@/server/leaveServer/countLeaveServer";

import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useSelectAllLeaveCategories } from "@/hooks/useSelect/useSelect";
import { Plus } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CardDescription, CardTitle } from "@/components/ui/card";

// Add the leave entitlement for one employee
export default function AddLeaveForEmployee({ leaveData, queryKey }) {
  // const [isOpen, setIsOpen] = useState(false);
  const leaveCategories = useSelectAllLeaveCategories();
  // we have show only the leave type that is not already added
  const leaveType = leaveData?.leaveData?.map((item) => item.leaveType);
  const leaveCategoriesNew = leaveCategories?.filter(
    (item) => item?.value && !leaveType?.includes(item?.value)
  );

  const { mutate: addLeave, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await addOneCommonLeaveToOneEmployee({
        leaveType: data?.leaveType,
        leaveYear: leaveData?.leaveYear,
        employeeId: leaveData?._id,
      }),
    invalidateKey: queryKey,
    onSuccessMessage: () => "Leave added successfully",
    onClose: () => {},
  });
  const field = [
    {
      name: "leaveType",
      labelText: "Leave Type",
      type: "select",
      options: leaveCategoriesNew,
      size: true,
      validationOptions: {
        required: "Please select a leave type",
      },
    },
  ];
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon" variant="outline">
            <Plus />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={"w-80"}>
          <CardTitle>Add Leave Entitlement</CardTitle>
          <CardDescription>Select the leave type to add</CardDescription>
          <div className="mt-3">
            <GlobalForm
              fields={field}
              btnName={"Add New"}
              onSubmit={addLeave}
              isLoading={isPending}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
