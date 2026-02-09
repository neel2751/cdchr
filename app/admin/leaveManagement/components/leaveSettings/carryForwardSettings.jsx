"use client";
import { GlobalForm } from "@/components/form/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { fetchLeaveCategory } from "@/server/category/category";

import {
  getLeaveSettingsClient,
  updateLeaveSettings,
} from "@/server/leaveSettingServer";
import React from "react";
import { toast } from "sonner";
import PreviewCarryForwardPage from "./previewCarryForward";
import HolidayPlannerCalendar from "./leaveHolidayPlanner";
import HolidayPlannerPage from "./holiday-planner/holidayPlanner";

export default function CarryForwardSettings() {
  const months = [
    { label: "January", value: "1" },
    { label: "February", value: "2" },
    { label: "March", value: "3" },
    { label: "April", value: "4" },
    { label: "May", value: "5" },
    { label: "June", value: "6" },
    { label: "July", value: "7" },
    { label: "August", value: "8" },
    { label: "September", value: "9" },
    { label: "October", value: "10" },
    { label: "November", value: "11" },
    { label: "December", value: "12" },
  ];

  const fields = [
    {
      labelText: "Leave Year Start Month",
      name: "leaveYearStartMonth",
      type: "select",
      size: true,
      options: months,
    },
    {
      labelText: "Enable Carry Forward",
      name: "carryForwardEnabled",
      type: "checkbox",
    },
  ];

  const carryForwardEnabledField = [
    {
      labelText: "Allowed Carry Forward",
      name: "allowed",
      type: "checkbox",
    },
    {
      labelText: "Pro-Rated Carry Forward",
      name: "proRated",
      type: "checkbox",
      showIf: {
        field: "allowed",
        value: true,
      },
    },
    {
      labelText: "Maximum Days to Carry Forward",
      name: "maxDays",
      type: "number",
      showIf: {
        field: "allowed",
        value: true,
      },
      validationOptions: {
        required: "This field is required when carry forward is allowed",
        min: {
          value: 1,
          message: "Must be at least 1 day",
        },
        max: {
          value: 365,
          message: "Cannot exceed 365 days",
        },
      },
    },
    {
      labelText: "Expire After (Months)",
      name: "expireAfterMonths",
      type: "number",
      showIf: {
        field: "allowed",
        value: true,
      },
      validationOptions: {
        required: "This field is required when carry forward is allowed",
        min: {
          value: 1,
          message: "Must be at least 1 month",
        },
        max: {
          value: 12,
          message: "Cannot exceed 12 months",
        },
      },
    },
  ];

  const [initialValues, setInitialValues] = React.useState();

  const { data, isLoading } = useFetchQuery({
    queryKey: ["leave-settings"],
    fetchFn: getLeaveSettingsClient,
  });

  const { data: leaveCategories } = useFetchQuery({
    fetchFn: fetchLeaveCategory,
    queryKey: ["leave-categories"],
    enabled: !!initialValues?.carryForwardEnabled,
  });

  const { newData: leaveCategoriesData } = leaveCategories || {};

  const { newData } = data || {};
  React.useEffect(() => {
    if (newData) {
      setInitialValues({
        leaveYearStartMonth: newData.leaveYearStartMonth.toString(),
        carryForwardEnabled: newData.carryForwardEnabled,
        carryForwardRules: newData.carryForwardRules || [],
      });
    }
  }, [newData]);

  const handleSave = async (data) => {
    const res = await updateLeaveSettings(data);
    if (res.success) {
      setInitialValues(res.data);
      toast.success("Leave settings saved");
    } else {
      toast.error("Failed to save settings");
    }
  };

  const handleCarryForwardRuleSave = async (leaveType, ruleData) => {
    const updatedRules = initialValues.carryForwardRules
      ? [...initialValues.carryForwardRules]
      : [];
    const existingRuleIndex = updatedRules.findIndex(
      (r) => r.leaveType === leaveType
    );
    if (existingRuleIndex !== -1) {
      updatedRules[existingRuleIndex] = {
        ...updatedRules[existingRuleIndex],
        ...ruleData,
      };
    } else {
      updatedRules.push({ leaveType, ...ruleData });
    }

    const updatedSettings = {
      ...initialValues,
      carryForwardRules: updatedRules,
    };

    const res = await updateLeaveSettings(updatedSettings);
    if (res.success) {
      setInitialValues(res.data);
      toast.success(`Carry forward settings for ${leaveType} saved`);
    } else {
      toast.error("Failed to save carry forward settings");
    }
  };

  return (
    <div className="space-y-4 mt-12">
      <Card>
        <CardHeader>
          <CardTitle>Carry Forward Settings</CardTitle>
          <CardDescription>
            Configure the settings for carrying forward unused leave days to the
            next leave year.
          </CardDescription>
        </CardHeader>
        {isLoading && <div className="p-4">Loading...</div>}
        <CardContent>
          {initialValues && (
            <GlobalForm
              fields={fields}
              onSubmit={handleSave}
              initialValues={initialValues}
              btnName={initialValues ? "Update Settings" : "Save Settings"}
            />
          )}
          {initialValues?.carryForwardEnabled &&
            leaveCategoriesData &&
            leaveCategoriesData.map((category) => {
              const rule = initialValues?.carryForwardRules?.find(
                (r) => r.leaveType === category.leaveType
              ) || {
                allowed: false,
                maxDays: 0,
                expireAfterMonths: 0,
                proRated: false,
              };
              return (
                <Card key={category.leaveType} className="mt-6">
                  <CardHeader>
                    <CardTitle>
                      Carry Forward Settings for{" "}
                      <span className="text-indigo-600">
                        {category.leaveType}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      Define how unused {category.leaveType} leaves can be
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <GlobalForm
                      key={category.leaveType}
                      fields={carryForwardEnabledField}
                      onSubmit={(data) =>
                        handleCarryForwardRuleSave(category.leaveType, data)
                      }
                      initialValues={rule}
                      btnName={`Save ${category.leaveType}`}
                    />
                  </CardContent>
                </Card>
              );
            })}
        </CardContent>
        {/* <PreviewCarryForwardPage /> */}
        <HolidayPlannerCalendar />
      </Card>
    </div>
  );
}
