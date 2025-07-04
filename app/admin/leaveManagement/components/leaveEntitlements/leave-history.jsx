import { Button } from "@/components/ui/button";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { format } from "date-fns";
import { ArrowDownIcon, CheckIcon } from "lucide-react";
import React from "react";

const Leavehistory = ({ leaveHistory }) => {
  const { scrollRef, isAtBottom, scrollToBottom } = useAutoScroll({
    offset: 20,
    smooth: true,
    content: leaveHistory,
  });

  return (
    <div
      ref={scrollRef}
      className="max-w-4xl h-full mx-auto w-full mt-5 overflow-y-auto  pb-20"
    >
      {leaveHistory?.map((his, index) => (
        <div key={index}>
          <div>
            <div className="flex gap-x-3">
              <div className="relative after:bg-gray-200 after:-translate-x-0.5 after:w-px after:top-7 after:start-3.5 after:bottom-0 after:absolute">
                <div className="flex justify-center items-center size-7 z-10 relative">
                  <CheckIcon className="text-green-600 size-3 shrink-0 " />
                </div>
              </div>
              <div className="pt-1 pb-4 grow">
                <p className="text-neutral-500 text-sm mb-1">
                  <span className="font-medium text-neutral-800">
                    {his?.updatedByName} {"-"}{" "}
                  </span>
                  {format(his?.updateAt || new Date(), "PPP")}
                </p>
                <p className=" text-neutral-700 text-sm">
                  Change {his?.leaveType} for{" "}
                  <span className="font-medium text-indigo-700">
                    {his?.oldTotal} to {his?.newTotal} days
                  </span>
                </p>
                <p className=" text-neutral-700 text-sm">
                  Auto change Remaining{" "}
                  <span className="font-medium text-indigo-700">
                    {his?.oldRemaining} to {his?.newRemaining} days
                  </span>
                </p>
                <p className=" text-neutral-700 text-sm">
                  Used{" "}
                  <span className="font-medium text-indigo-700">
                    {his?.used} days
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      ))}
      {!isAtBottom && (
        <Button
          size="icon"
          variant="outline"
          className="absolute bottom-4 left-4 rounded-full"
          onClick={scrollToBottom}
        >
          <ArrowDownIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

export default Leavehistory;
