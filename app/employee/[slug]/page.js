import React from "react";
import ChangePasswordForEmployee from "../feature/changePassword";
import { redirect } from "next/navigation";

export default async function page({ params }) {
  const { slug } = await params;

  const menu = [
    {
      title: "Password",
      href: "/employee/changePassword",
      content: ChangePasswordForEmployee,
    },
  ];

  if (slug === "changePassword") {
    const Component = menu.find(
      (item) => item.href === `/employee/${slug}`
    )?.content;
    return <Component />;
  } else {
    // redirect to home page
    return redirect("/employee");
  }
}
