import ChangePassword from "@/components/changePassword/password";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { changeSiteEmployeePassword } from "@/server/employeServer/employeServer";

export default function ChangePasswordForEmployee() {
  return (
    <Card className="max-w-xl mx-auto mt-10">
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
        <CardDescription>
          Please enter your new password below. Ensure it meets the security
          requirements.
        </CardDescription>
        <CardDescription className={"text-rose-500"}>
          <strong>Note:</strong> If you forgot your current password, you can
          reset it by contacting your site administrator.
          {/* After changing your password, you will need to
          log in again with the new password. */}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePassword mutationFn={changeSiteEmployeePassword} />
      </CardContent>
    </Card>
  );
}
