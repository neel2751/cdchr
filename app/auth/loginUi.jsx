"use client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import React, { useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import { GlobalForm } from "@/components/form/form";

export const LOGINFIELD = [
  {
    name: "email",
    labelText: "Email Address",
    type: "email",
    helperText: "*Please enter a valid email address.",
    placeholder: "Enter your email",
    inputMode: "email",
    size: true,
    validationOptions: {
      required: "Email is required",
      pattern: {
        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
        message: "Invalid email format. Please check and try again.",
      },
    },
  },
  {
    name: "password",
    labelText: "Password",
    type: "password",
    placeholder: "******",
    size: true,
    validationOptions: {
      required: "password is required",
      minLength: {
        value: 6,
        message: "Minimum length should be 6 characters",
      },
    },
  },
];

export const LoginUi = () => {
  const searchParams = useSearchParams();
  const callback = searchParams.get("callbackUrl");
  const { status, data: session } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  const callBackcheck = callback || process.env.NEXTAUTH_URL || "/";

  useEffect(() => {
    if (session) {
      router.push(callBackcheck); // Push to the callback URL or default to "/"
    }
  }, [session]);

  // useEffect(() => {
  //   if (status === "authenticated") {
  //     if (window.location.href !== callBackcheck) {
  //       window.location.href = callBackcheck;
  //     }
  //   }
  // }, [status, callBackcheck]);

  const handleSubmit = async (data) => {
    setIsLoading(true);
    // add the artifical  delay to simulate the server response
    // await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await signIn("credentials", {
        redirect: false, // Prevent automatic page reload
        email: data.email,
        password: data.password,
      });

      if (res?.error) {
        toast.error(res.error); // Optionally show a toast notification
      } else {
        toast.success("Logged in successfully. Please wait..."); // Optionally show a toast notification
        window.location.href = res.url || callBackcheck || "/";
      }
    } catch (err) {
      console.error("Error during login:", err);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // <section className="sm:bg-[url('/images/login.png')] w-full h-screen bg-center bg-cover bg-white">
    <div className="max-w-md mx-auto px-4 top-1/2 translate-y-1/2">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Image
              height={20}
              width={20}
              className="h-10 w-10"
              // src="/images/cdc.svg"
              src="https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
              alt="CDC"
            />
            <span className="text-gray-800 font-semibold text-lg whitespace-nowrap">
              {/* Creative Design & Construction */}
              Hr Management
            </span>
          </div>
          <div className=" flex items-center text-xs text-gray-400 uppercase before:flex-[1_1_0%] before:border-t before:border-gray-200 before:me-6 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-6">
            Login
          </div>
        </CardHeader>
        <CardContent>
          <GlobalForm
            fields={LOGINFIELD}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            btnName={"Login"}
          />
        </CardContent>
      </Card>
    </div>
    // </section>
  );
};
