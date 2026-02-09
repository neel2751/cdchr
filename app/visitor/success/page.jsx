import React from "react";

export default function SuccessPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-4xl font-bold text-green-500 mb-4">
        Form Submitted Successfully!
      </h1>
      <p className="text-lg text-gray-700">
        Thank you for submitting the form. We have received your information.
      </p>
    </div>
  );
}
