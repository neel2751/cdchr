import React from "react";

export default function VisitorCTA() {
  return (
    <div className="flex flex-col gap-4">
      {/* Website Button */}
      <a
        href={"https://cdcproperty.management"}
        target="_blank"
        className="w-full bg-white border-2 border-indigo-600 text-indigo-600 py-3 rounded-2xl font-bold text-center
            hover:bg-indigo-600 hover:text-white transition-colors 
        "
      >
        Visit Website
      </a>

      {/* Save Contact Button */}

      {/* Phone Link */}
      <a
        href={`tel:+442084347887`}
        className="text-sm text-gray-800 text-center underline
        hover:text-indigo-600 transition-colors
        "
      >
        Call Us: +44 20 8434 7887
      </a>

      {/* Email Link */}
      <a
        href="mailto:contact@cdcproperty.management"
        className="text-sm text-gray-800 text-center underline hover:text-indigo-600 transition-colors"
      >
        Email Us: contact@cdcproperty.management
      </a>
    </div>
  );
}
