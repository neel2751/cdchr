import { formatCurrency } from "@/utils/time";
import { Download, Printer, X } from "lucide-react";
import Image from "next/image";
import React, { memo } from "react";

const Invoice = memo(({ open, setOpen, invoiceData }) => {
  return (
    <div
      className={` size-full fixed top-0 start-0 overflow-x-hidden overflow-y-auto pointer-events-none z-[80] ${
        open ? "flex bg-gray-900/60" : "hidden"
      } `}
    >
      <div
        className={`${
          open ? "mt-12 opacity-100 duration-500" : "mt-0 opacity-0"
        } ease-out transition-all sm:max-w-lg sm:w-full m-3 sm:mx-auto`}
      >
        <div className="relative flex flex-col bg-white shadow-lg rounded-xl pointer-events-auto dark:bg-neutral-800">
          <div className="relative overflow-hidden min-h-32 bg-gray-900 text-center rounded-t-xl">
            <div className="absolute top-2 end-2">
              <button
                onClick={setOpen}
                type="button"
                className="flex justify-center items-center size-7 text-sm font-semibold rounded-full border border-transparent text-black hover:bg-white/90 focus:outline-none focus:bg-white/10 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span className="sr-only">Close</span>
                <X className="size-4 shrink-0" />
              </button>
            </div>
            <figure className="absolute inset-x-0 bottom-0">
              <svg
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg"
                x="0px"
                y="0px"
                viewBox="0 0 1920 100.1"
              >
                <path
                  fill="currentColor"
                  className="fill-white dark:fill-neutral-800"
                  d="M0,0c0,0,934.4,93.4,1920,0v100.1H0L0,0z"
                ></path>
              </svg>
            </figure>
            <figure>
              <svg
                preserveAspectRatio="none"
                width="576"
                height="120"
                viewBox="0 0 576 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clip-path="url(#clip0_666_273469)">
                  <rect width="576" height="120" fill="#B2E7FE"></rect>
                  <rect
                    x="289.678"
                    y="-90.3"
                    width="102.634"
                    height="391.586"
                    transform="rotate(59.5798 289.678 -90.3)"
                    fill="#FF8F5D"
                  ></rect>
                  <rect
                    x="41.3926"
                    y="-0.996094"
                    width="102.634"
                    height="209.864"
                    transform="rotate(-31.6412 41.3926 -0.996094)"
                    fill="#3ECEED"
                  ></rect>
                  <rect
                    x="66.9512"
                    y="40.4817"
                    width="102.634"
                    height="104.844"
                    transform="rotate(-31.6412 66.9512 40.4817)"
                    fill="#4C48FF"
                  ></rect>
                </g>
                <defs>
                  <clipPath id="clip0_666_273469">
                    <rect width="576" height="120" fill="white"></rect>
                  </clipPath>
                </defs>
              </svg>
            </figure>
          </div>

          <div className="relative z-10 -mt-12">
            <span className="mx-auto flex justify-center items-center size-[62px] rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400">
              <Image
                src="https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                alt="CDC"
                width={40}
                height={40}
              />
            </span>
          </div>

          <div className="p-4 sm:p-7 overflow-y-auto">
            <div className="text-center">
              <h3
                id="hs-ai-invoice-modal-label"
                className="text-lg font-semibold text-gray-800 dark:text-neutral-200"
              >
                {invoiceData?.company?.name ||
                  "Creative Design & Construction Ltd."}
              </h3>
              <p className="text-sm text-gray-500 dark:text-neutral-500">
                Invoice #{invoiceData?._id}
              </p>
            </div>

            <div className="mt-5 sm:mt-10 grid grid-cols-2 sm:grid-cols-3 gap-5">
              <div>
                <span className="block text-xs uppercase text-gray-500 dark:text-neutral-500">
                  Amount paid:
                </span>
                <span className="block text-sm font-medium text-gray-800 dark:text-neutral-200">
                  {formatCurrency(invoiceData?.amount)}
                </span>
              </div>

              <div>
                <span className="block text-xs uppercase text-gray-500 dark:text-neutral-500">
                  Date paid:
                </span>
                <span className="block text-sm font-medium text-gray-800 dark:text-neutral-200">
                  {new Date(invoiceData?.date).toDateString()}
                </span>
              </div>

              <div>
                <span className="block text-xs uppercase text-gray-500 dark:text-neutral-500">
                  Category:
                </span>
                <div className="flex items-center gap-x-2">
                  {/* <ReceiptText className="size-5" /> */}
                  <span className="block text-sm font-medium text-gray-800 dark:text-neutral-200">
                    {invoiceData?.categoryLabel || "General"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 sm:mt-10">
              <h4 className="text-xs font-semibold uppercase text-gray-800 dark:text-neutral-200">
                Summary
              </h4>

              <ul className="mt-3 flex flex-col">
                <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm border text-gray-800 -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg dark:border-neutral-700 dark:text-neutral-200">
                  <div className="flex items-center justify-between w-full">
                    <span>Title</span>
                    <span>{invoiceData?.title}</span>
                  </div>
                </li>
                {invoiceData?.project?.siteName ? (
                  <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm border text-gray-800 -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg dark:border-neutral-700 dark:text-neutral-200">
                    <div className="flex items-center justify-between w-full">
                      <span>Site Name</span>
                      <span>{invoiceData?.project?.siteName}</span>
                    </div>
                  </li>
                ) : (
                  <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm border text-gray-800 -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg dark:border-neutral-700 dark:text-neutral-200">
                    <div className="flex items-center justify-between w-full">
                      <span>Type</span>
                      <span>{invoiceData?.type || "General"}</span>
                    </div>
                  </li>
                )}
                <li className="inline-flex items-center gap-x-2 py-3 px-4 text-sm font-semibold bg-gray-50 border text-gray-800 -mt-px first:rounded-t-lg first:mt-0 last:rounded-b-lg dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200">
                  <div className="flex items-center justify-between w-full">
                    <span>Amount paid</span>
                    <span>£{invoiceData?.amount.toFixed(2)}</span>
                  </div>
                </li>
              </ul>
            </div>

            <div className="mt-5 flex justify-end gap-x-2">
              <button className="py-2 px-3 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:bg-gray-50 dark:bg-transparent dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800">
                <Download className="shrink-0 size-4" />
                Invoice PDF
              </button>
              <button className="py-2 px-3 inline-flex items-center gap-x-2 text-sm font-medium rounded-lg border border-transparent bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none">
                <Printer className="shrink-0 size-4" />
                Print
              </button>
            </div>

            <div className="mt-5 sm:mt-10">
              <p className="text-sm text-gray-500 dark:text-neutral-500">
                If you have any questions, please contact us at{" "}
                <a
                  className="inline-flex items-center gap-x-1.5 text-blue-600 decoration-2 hover:underline focus:outline-none focus:underline font-medium dark:text-blue-500"
                  href="#"
                >
                  info@cdc.construction
                </a>{" "}
                or call at{" "}
                <a
                  className="inline-flex items-center gap-x-1.5 text-blue-600 decoration-2 hover:underline focus:outline-none focus:underline font-medium dark:text-blue-500"
                  href="tel:02080043327"
                >
                  020-8004-3327
                </a>
              </p>
            </div>
          </div>
        </div>
        {/* Invoice HTML */}
      </div>
    </div>
  );
});

export default Invoice;
