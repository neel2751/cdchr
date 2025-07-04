import LeaveCount from "../leaveDashboard/leaveCount";

export default function Overview() {
  return (
    <div className="mt-6">
      <LeaveCount />
      {/* <div className="max-w-4xl w-full mb-20">
        <div className="mt-8">
          <div className="sm:ps-16 p-4 bg-linear-to-r from-[#ffedd5] via-[#e9d5ff] via-70% to-[#c7d2fe] rounded-md overflow-hidden mb-5 relative">
            <div className="flex items-center gap-x-3">
              <div className="hidden sm:block -start-4 -bottom-2 absolute">
                <div className="text-7xl">🏕️</div>
              </div>
              <div className="grow">
                <h4 className="text-orange-700 font-semibold text-base">
                  Welcome to your dashboard
                </h4>
                <p className="text-neutral-800 text-sm mt-1 font-medium">
                  Our Interior Studio panel and employee platform is in beta. If
                  you find any issues or need help, just click here.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div> */}
      {/* <div className="max-w-xl w-full">
        <div className="mt-8">
          <div className="p-4 bg-linear-to-r from-[#08332d] via-[#46733f] via-70% to-[#7fad50] rounded-md  mb-5 relative flex">
            <div className="max-w-xs space-">
              <h4 className="text-white font-semibold text-xl tracking-tight">
                Here's happening in your Interior Studio 👋
              </h4>
              <p className="text-neutral-200 text-sm mt-1.5 font-medium">
                Our Interior Studio panel and employee platform is in beta. If
                you find any issues or need help, just click here.
              </p>
              <Button
                size="sm"
                className="mt-5 bg-white text-green-800 hover:bg-amber-600 hover:text-white group"
              >
                View Report
                <LucideArrowRight className="group-hover:size-5 transition-all duration-300 ease-in-out" />
              </Button>
            </div>
            <div className="absolute right-0 -bottom-4">
              <Image
                src={"/images/leave.svg"}
                alt="test"
                height={280}
                width={280}
              />
            </div>
          </div>
        </div>
      </div> */}
    </div>
  );
}

// DASHBOARD Design with total number of leave request with All , Pending , Approved , Rejected, and Cancelled
//
