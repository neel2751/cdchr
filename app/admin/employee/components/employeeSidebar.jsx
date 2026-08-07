"use client";
import { useSiteEmployee } from "@/components/Avatar/AvatarContext";
import { CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import {
  PhoneIcon,
  MailIcon,
  Building2Icon,
  MapPinnedIcon,
  RadarIcon,
  EarthIcon,
  BriefcaseBusinessIcon,
  IdCardIcon,
  CalendarPlus2Icon,
  SignpostIcon,
  CakeIcon,
} from "lucide-react";
import { formatDisplayDate } from "@/lib/formatDate";

export default function EmployeeSidebar() {
  // const { searchParams } = useCommonContext();// commented out
  const { newData } = useSiteEmployee();

  return (
    <div className="space-y-3 divide-y divide-dashed divide-gray-300 border border-gray-300 p-4 rounded-xl border-dashed">
      <div className="space-y-4 pb-3">
        <div className="flex items-center gap-4">
          {/* {JSON.stringify(newData)} */}
          <div className="space-y-1">
            <CardTitle className="font-semibold text-indigo-600">
              {newData?.firstName || "CDC"}
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {newData?.employeId ||
                newData?._id?.slice(-4).padStart(newData?._id?.length, "*")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 pb-3 ">
        <h3 className="text-base font-medium text-pretty">About</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <PhoneIcon className="size-3.5 -mr-1 rotate-[10deg]" />
            <span className="text-sm">Phone:</span>
            <span className="text-primary">{newData?.phone}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MailIcon className="size-3.5 -mr-1 " />
            <span className="text-sm">Email:</span>
            <span className="text-primary">{newData?.email}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CakeIcon className="size-3.5 -mr-1" />
            <span className="text-sm">Date of birth:</span>
            <span className="text-primary">
              {formatDisplayDate(newData?.dateOfBirth)}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3 pb-3">
        <h3 className="text-base font-medium text-pretty">Address</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2Icon className="size-3.5 -mr-1" />
            <span className="text-sm">Address:</span>
            <span className="text-primary">
              {newData?.eAddress?.address || "-"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <SignpostIcon className="size-3.5 -mr-1" />
            <span className="text-sm">Street:</span>
            <span className="text-primary">
              {newData?.eAddress?.streetAddress || "-"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPinnedIcon className="size-3.5 -mr-1" />
            <span className="text-sm">City state:</span>
            <span className="text-primary">
              {newData?.eAddress?.city || "-"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <RadarIcon className="size-3.5 -mr-1" />
            <span className="text-sm">Postcode:</span>
            <span className="text-primary">
              {/* Records written before the rename still carry `zipCode`. */}
              {newData?.eAddress?.postCode || newData?.eAddress?.zipCode || "-"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <EarthIcon className="size-3.5 -mr-1" />
            <span className="text-sm">Country:</span>
            <span className="text-primary">
              {newData?.eAddress?.country || "-"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3 pb-3">
        <h3 className="text-base font-medium text-pretty">Employee Details</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <IdCardIcon className="size-3.5 -mr-1" />
            <span className="text-sm">Role Type:</span>
            <span className="text-primary">{newData?.employeRole || "-"}</span>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <IdCardIcon className="size-3.5 -mr-1" />
            <span className="text-sm">:</span>
            <span className="text-primary">{newData?.employeRole || "-"}</span>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarPlus2Icon className="size-3.5 -mr-1" />
            <span className="text-sm">Join date:</span>
            <span className="text-primary text-pretty">
              {format(new Date(newData?.startDate || new Date()), "PPP")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
