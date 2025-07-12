"use client";
import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { AvatarList, UserAvatar } from "../Avatar/Avatar";
import { useAvatar } from "../Avatar/AvatarContext";
import { GlobalForm } from "../form/form";
import {
  DEPARTMENTFIELD,
  EMERGENCYFIELD,
  OFFICEFIELD,
  VISAFIELD,
} from "@/data/fields/fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectRoleType } from "@/server/selectServer/selectServer";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useCommonContext } from "@/context/commonContext";
import { handleOfficeEmployee } from "@/server/officeServer/officeServer";
import { useSession } from "next-auth/react";
import { useSelectCompany } from "@/hooks/useSelect/useSelect";

const EmployeeEdit = () => {
  const { newData } = useAvatar();
  const { searchParams } = useCommonContext();
  // we need only name, phoneNumber, email only
  const basic = OFFICEFIELD.filter(
    (field) =>
      field.name === "name" ||
      field.name === "phoneNumber" ||
      field.name === "email"
  );
  const { data: selectRoleType = [] } = useFetchSelectQuery({
    queryKey: ["selectRoleType"],
    fetchFn: getSelectRoleType,
  });

  const company = useSelectCompany();

  const field = DEPARTMENTFIELD.map((item) => {
    if (item.name === "department") {
      return {
        ...item,
        options: selectRoleType,
      };
    }
    if (item.name === "company") {
      return {
        ...item,
        options: company,
      };
    }
    return item;
  });

  const tabList = [
    { id: "basic", title: "Basic", content: basic },
    { id: "office", title: "Office", content: field },
    { id: "visa", title: "Visa", content: VISAFIELD },
    { id: "emergency", title: "Emergency", content: EMERGENCYFIELD },
  ];
  const queryKey = ["employeeDeatils", searchParams];

  const { mutate: handleSubmit } = useSubmitMutation({
    mutationFn: async (data) => await handleOfficeEmployee(data, newData?._id),
    invalidateKey: queryKey,
    onSuccessMessage: () => "Employee updated successfully",
    onClose: () => {},
  });

  return (
    <div className="max-w-max">
      <Card>
        <CardHeader>
          <CardTitle>Account Settings</CardTitle>
          <CardDescription>Manage your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <Label>Current Avatar</Label>
            <div className="flex items-center space-x-4">
              <UserAvatar
                fallbackName={newData?.name || newData?.fullName || "CDC"}
              />
            </div>
            <div className="space-y-2">
              <Label>Choose a new avatar</Label>
              <AvatarList />
            </div>
          </div>
          <Tabs defaultValue="basic">
            <TabsList className="grid w-full grid-cols-4">
              {tabList.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabList.map((tab) => (
              <TabsContent key={tab.id} value={tab.id}>
                <Form
                  fields={tab.content}
                  initialValues={newData}
                  handleSubmit={(data) =>
                    handleSubmit({
                      ...data,
                      tab: tab.id,
                      employeeId: newData?._id,
                    })
                  }
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmployeeEdit;
const Form = ({
  fields,
  initialValues,
  btnName = "Update Setting",
  handleSubmit,
}) => {
  const { data: session } = useSession();
  const role = session?.user?.role;
  return (
    <GlobalForm
      fields={fields}
      initialValues={initialValues}
      btnName={btnName}
      onSubmit={handleSubmit}
      isHide={role === "superAdmin" ? false : true}
    />
  );
};
