"use server";

import PolicyModel from "@/models/policyModel";
import { getServerSideProps } from "../session/session";

// new feature of policy after we have to work on it
export async function storePolicy(data) {
  try {
    const { props } = await getServerSideProps();
    const { user } = props?.session;
    const { name, _id } = user;
    const track = [
      {
        name,
        employeeId: _id,
        date: new Date(),
      },
    ];
    const newData = { ...data, track };
    const policy = new PolicyModel(newData);
    await policy.save();
    return { success: true, message: "Policy created successfully" };
  } catch (error) {
    console.log(" Error creating policy:", error);
    return { success: false, message: error.message };
  }
}
