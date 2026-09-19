import ProfileShell from "../_components/profileShell";
import MyProfile from "./myProfile";

export const metadata = { title: "My profile" };

export default function MyProfilePage() {
  return <ProfileShell tab="profile" render={() => <MyProfile />} />;
}
