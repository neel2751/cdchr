import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React from "react";
import Logout from "./logout";

export default function Layout({ children }) {
  const menu = [{ title: "Dashboard", href: "/employee" }];
  return (
    <div className="flex min-h-screen flex-col px-2 sm:py-0 py-2">
      <header className="sticky top-0 z-50 w-full border-b bg-white">
        <div className="container flex h-16 items-center justify-between mx-auto">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="font-bold text-lg flex items-center gap-2 text-neutral-800"
            >
              <Image
                src={
                  "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                }
                alt="CDC HR"
                width={100}
                height={100}
                className="h-10 w-auto"
              />
              CDC HR
            </Link>
            <nav className="hidden md:flex gap-6">
              {menu &&
                menu?.map((item) => (
                  <Link
                    key={item?.title}
                    href={item?.href}
                    className="text-sm font-medium hover:text-indigo-600 transition-colors font-grotesk"
                  >
                    {item?.title}
                  </Link>
                ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" className="hidden md:flex">
              <Bell />
            </Button>
            <Logout />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="container py-10 mx-auto">{children}</div>
      </main>
    </div>
  );
}
