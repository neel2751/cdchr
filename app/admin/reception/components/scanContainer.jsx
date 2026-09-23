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
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { getClockLocations } from "@/server/clockServer/locations";
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

  // Offices only, active only. A desk registered to a site would issue codes
  // naming a job rather than a place.
  const { data: locations = [] } = useFetchSelectQuery({
    queryKey: ["clockLocations"],
    fetchFn: getClockLocations,
  });
  const offices = locations.filter((l) => !l.projectSiteId);

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
    setInitialValues({
      ...item,
      // The list populates the office so the card can show its name; the form
      // needs the id back, or the select opens with nothing chosen and a save
      // would quietly clear it.
      clockLocationId:
        item?.clockLocationId?._id || item?.clockLocationId || "",
    });
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
    // Where this desk is. Not required: a company with one office has nothing
    // to choose, and a screen registered under Screens & devices overrides it
    // anyway. Left empty, the desk asks whoever is standing at it.
    {
      name: "clockLocationId",
      labelText: "Office this desk is in",
      type: "select",
      size: true,
      placeholder: "Ask at the desk",
      options: offices.map((o) => ({ value: o._id, label: o.name })),
    },
  ];

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Reception Desks</CardTitle>
              <CardDescription>
                The accounts a front desk signs in as. Each one can be given an
                office, and each screen it runs on can be registered
                individually — attendance scanned there is recorded against
                that office instead of whichever one the person picked.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleAdd} variant="outline">
                Add reception desk
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
