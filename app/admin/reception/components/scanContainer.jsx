"use client";
import React, { useState } from "react";
import AddScanUserForm from "./addScanForm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  createReceptionUser,
  getReceptionUsers,
} from "@/server/receptionServer/receptionServer";
import { useFetchQuery } from "@/hooks/use-query";
import ScanUserTable from "./scanUserTable";

export default function SacnContainer() {
  const [showDialog, setShowDialog] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [initialValues, setInitialValues] = useState(null);

  const handleClose = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(false);
    setIsEdit(false);
  };

  const { data } = useFetchQuery({
    fetchFn: getReceptionUsers,
    queryKey: ["reception-users"],
  });

  const { newData: receptionUsers = [] } = data || {};

  const { mutate: submitUser } = useSubmitMutation({
    mutationFn: async (data) => createReceptionUser(data, initialValues?._id),
    invalidateKey: ["reception-users"],
    onSuccessMessage: () => "Reception User submitted successfully",
    onClose: () => handleClose(),
  });

  const handleAdd = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(true);
  };
  const handleEdit = (item) => {
    setInitialValues(item);
    setIsEdit(true);
    setShowDialog(true);
  };

  const fields = [
    {
      name: "name",
      labelText: "Name",
      type: "text",
      size: true,
      placeholder: "Enter Name",
      validationOptions: {
        required: "Please Enter Name",
      },
    },
    {
      name: "email",
      labelText: "Email",
      type: "email",
      size: true,
      placeholder: "Enter Email",
      validationOptions: {
        required: "Please Enter Email",
        pattern: {
          value: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
          message: "Please enter a valid email address",
        },
      },
    },
  ];

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Leave Requests</CardTitle>
              <CardDescription>List of leave requests</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleAdd} variant="outline">
                Add Scan User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScanUserTable data={receptionUsers} onEdit={handleEdit} />
        </CardContent>
      </Card>
      <AddScanUserForm
        showDialog={showDialog}
        setShowDialog={handleClose}
        fields={fields}
        initialValues={initialValues}
        handleSubmit={submitUser}
        isEdit={isEdit}
      />
    </div>
  );
}
