import { Loader, X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

export default function Alert({ label, open, onClose, onConfirm, isPending }) {
  return (
    <div
      className={`${
        open ? "flex" : "hidden"
      } size-full fixed top-0 start-0 justify-center items-center  z-80 bg-gray-800/80 overflow-x-hidden overflow-y-auto`}
    >
      <div
        className={`duration-500 ease-out transition-all ${
          open ? "mt-7 opacity-100" : "mt-0 opacity-0"
        } md:max-w-md md:w-full m-3 md:mx-auto`}
      >
        <div className="relative flex flex-col bg-white border shadow-sm rounded-xl overflow-hidden">
          {/* <div onClick={onClose} className="absolute top-2 end-2"> */}
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            disabled={isPending}
            className="rounded-full size-4 p-3 absolute top-2 end-2"
          >
            <X />
          </Button>
          {/* </div> */}

          <div className="p-4 sm:p-10 overflow-y-auto">
            <div className="flex gap-x-4 md:gap-x-7">
              {/* <!-- Icon --> */}
              <span
                className={`shrink-0 inline-flex justify-center items-center size-[46px] sm:w-[62px] sm:h-[62px] rounded-full border-4 ${
                  label?.type === "Delete"
                    ? " border-rose-50 bg-rose-100 text-rose-500"
                    : "border-amber-50 bg-amber-100 text-amber-600"
                }`}
              >
                <svg
                  className="shrink-0 size-5"
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
                </svg>
              </span>
              {/* <!-- End Icon --> */}

              <div className="grow">
                <h3 className="mb-2 text-xl font-bold text-gray-800">
                  {label?.type}
                </h3>
                <p className="text-gray-600 text-sm">
                  {label?.type === "Delete"
                    ? "Are you sure to delete this? This action cannot be undo!"
                    : `Are you sure to Update the status?`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end items-center gap-x-2 py-3 px-4  border-t">
            <Button
              disabled={isPending}
              onClick={onClose}
              variant="outline"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={onConfirm}
              className={cn(
                label?.type === "Delete"
                  ? "bg-red-500 hover:bg-red-600 text-red-50"
                  : "bg-amber-600 hover:bg-amber-700 text-amber-50"
              )}
              variant="solid"
              size="sm"
            >
              {isPending ? (
                <>
                  <Loader className="animate-spin" />
                  Wait
                </>
              ) : (
                label?.type
              )}
              {/* {label?.type === "Delete" ? label?.type : "Update"} */}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
