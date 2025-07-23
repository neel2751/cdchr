"use client";
import ChangePassword from "@/components/changePassword/password";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { changeSiteEmployeePassword } from "@/server/employeServer/employeServer";

export default function ChnageSiteEmployeePassword() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chnage Password</CardTitle>
        <CardDescription>
          Update your password to keep your account secure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePassword
          mutationFn={changeSiteEmployeePassword}
          queryKey={["changeSiteEmployeePassword"]}
        />
      </CardContent>
    </Card>
  );
}
