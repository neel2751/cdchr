import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LeaveCategoryForm } from "./add-leave-category";
import { useFetchQuery } from "@/hooks/use-query";
import {
  fetchLeaveCategory,
  handleLeaveCategory,
  leaveCategoryDelete,
  leaveCategoryStatus,
} from "@/server/category/category";
import LeaveCategoryTable from "../components/leave-category-table";
import { CommonContext } from "@/context/commonContext";
import { useState } from "react";
import { useSubmitMutation } from "@/hooks/use-mutate";
import Alert from "@/components/alert/alert";
import { LEAVECATEGORYFIELD } from "@/data/fields/fields";

export function LeaveCategory() {
  const [isEdit, setIsEdit] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [initialValues, setInitialValues] = useState(null);
  const [alert, setAlert] = useState(null);
  const queryKey = ["leave-categories"];
  const { data: queryData } = useFetchQuery({
    queryKey,
    fetchFn: fetchLeaveCategory,
  });

  const handleonClose = () => {
    setInitialValues(null);
    setShowDialog(false);
    setIsEdit(false);
    setAlert(null);
  };

  const { mutate: onSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) => handleLeaveCategory(data, initialValues?._id),
    invalidateKey: queryKey,
    onSuccessMessage: () =>
      `Leave Category ${
        initialValues?._id ? "updated" : "submitted"
      } successfully`,
    onClose: handleonClose,
  });

  const { mutate: handleStatus, isPending: isStatusPending } =
    useSubmitMutation({
      mutationFn: async () =>
        alert?.type === "Delete"
          ? await leaveCategoryDelete(alert)
          : await leaveCategoryStatus(alert),
      invalidateKey: queryKey,
      onSuccessMessage: () =>
        `Category ${
          alert.type === "Delete" ? "Delete" : "Status Update"
        } successfully`,
      onClose: handleonClose,
    });

  const handleEdit = (item) => {
    setIsEdit(true);
    setInitialValues(item);
  };
  const handleAlert = (id, type, status) => {
    setAlert({
      id,
      type,
      status,
    });
  };

  const { newData } = queryData || {};

  return (
    <CommonContext.Provider
      value={{
        data: newData,
        field: LEAVECATEGORYFIELD,
        isEdit,
        showDialog,
        isPending,
        initialValues,
        setShowDialog,
        setIsEdit,
        handleEdit,
        handleAlert,
        onSubmit,
      }}
    >
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <CardTitle>Leave Category</CardTitle>
              <CardDescription>
                This is a list of leave categories that can be used to create
                leave policies.
              </CardDescription>
            </div>
            <LeaveCategoryForm fields={LEAVECATEGORYFIELD} />
          </div>
        </CardHeader>
        <CardContent>
          <LeaveCategoryTable />
        </CardContent>
      </Card>
      <Alert
        label={alert}
        open={alert?.id ? true : false}
        onClose={() => setAlert(null)}
        onConfirm={handleStatus}
        isPending={isStatusPending}
      />
    </CommonContext.Provider>
  );
}
