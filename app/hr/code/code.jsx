"use client";

import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, QrCode } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getDeviceId } from "@/lib/clockEvidence";
import { getClockLocations } from "@/server/clockServer/locations";
import { getDeviceLocation } from "@/server/deviceServer/deviceManagementServer";
import { issueClockToken } from "@/server/clockServer/clockToken";

// A reception screen does not move. Remembering which office it stands in
// means the question is asked once per device, not once per code.
const REMEMBERED = "cdchr.receptionLocationId";

/**
 * The clock-in code on a reception screen.
 *
 * The code used to be minted by the socket server and held in a Map in its
 * memory. Nothing outside that process could see it, so the server action that
 * actually wrote the attendance record had no way to mark one as spent — it
 * verified the signature and let the code go on working for its whole life.
 * Minting through a server action instead puts the code in the database, where
 * redeeming it can be a single conditional write.
 *
 * The socket is still here, but only to listen: it is what tells this screen
 * that someone has just used the code so it can come off the display.
 */
export default function OfficeQRCode({ siteId, className }) {
  const [qrData, setQrData] = useState("");
  const [tokenExpired, setTokenExpired] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  // Read once, lazily, rather than in an effect: an effect that seeds state
  // from storage is the cascading-render pattern, and the value is available
  // synchronously anyway.
  const [locationId, setLocationId] = useState(() => {
    try {
      return window.localStorage.getItem(REMEMBERED) || "";
    } catch {
      // Private window, or storage blocked. The picker just asks each time.
      return "";
    }
  });
  const [shownLocation, setShownLocation] = useState("");
  // What the screen itself says it is, once the device has been looked up.
  // `null` while unknown, `{}` once we know it is not enrolled.
  const [enrolled, setEnrolled] = useState(null);
  // This screen's own fingerprint, shown so it can be read off and given to an
  // administrator. Without it the Hardware ID field on the Reception screen is
  // unfillable: the fingerprint is computed in this browser and appeared
  // nowhere, so there was no way to discover what to type.
  const [myDeviceId, setMyDeviceId] = useState("");
  const [copied, setCopied] = useState(false);
  const currentTokenRef = useRef("");
  const socketRef = useRef(null);
  const expiryTimerRef = useRef(null);

  const clearCode = () => {
    setQrData("");
    setTokenExpired(true);
    setIsDialogOpen(false);
    currentTokenRef.current = "";
  };

  // Only asked for on an office screen: a site screen already knows where it
  // is from its siteId.
  const { data: locations = [] } = useFetchSelectQuery({
    queryKey: ["clockLocations"],
    fetchFn: getClockLocations,
  });
  const offices = locations.filter((l) => !l.projectSiteId);

  // Ask the device where it is. A reception screen is a fixed object in a
  // fixed room, so it can answer this itself — which is better than asking the
  // person standing at it, who may work at either office and whose answer used
  // to live in this browser's localStorage: lost on a cache clear, different
  // in a private window, and silently wrong if mis-picked.
  useEffect(() => {
    if (siteId) return; // a site screen already knows from its siteId
    let cancelled = false;

    (async () => {
      try {
        const deviceId = await getDeviceId();
        if (cancelled) return;
        setMyDeviceId(deviceId || "");
        const res = deviceId
          ? await getDeviceLocation({ deviceId })
          : { data: "{}" };
        if (cancelled) return;
        setEnrolled(res?.success ? JSON.parse(res.data || "{}") : {});
      } catch {
        // Fingerprinting blocked, or the lookup failed. Fall back to asking,
        // which is what this screen did before enrolment existed.
        if (!cancelled) setEnrolled({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // The enrolled location wins over anything remembered in this browser.
  const boundLocationId = enrolled?.locationId || "";
  const effectiveLocationId = boundLocationId || locationId;

  // Only ask when the screen cannot answer for itself and there is a genuine
  // choice: one office is no question, and an enrolled screen has settled it.
  const needsChoice =
    !siteId && !boundLocationId && enrolled !== null && offices.length > 1;

  useEffect(() => {
    socketRef.current = io({ withCredentials: true });

    socketRef.current.on("connect", () => {
      console.log("Office device connected");
    });

    socketRef.current.on("office-qr-used", (token) => {
      if (token && currentTokenRef.current && token !== currentTokenRef.current)
        return;
      clearCode();
    });

    return () => {
      socketRef.current?.disconnect();
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, []);

  const generateQRCode = async () => {
    setQrData("");
    setTokenExpired(false);
    currentTokenRef.current = "";
    setIsDialogOpen(true);
    setIsRequesting(true);
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);

    try {
      const res = await issueClockToken({
        siteId: siteId || null,
        locationId: !siteId && effectiveLocationId ? effectiveLocationId : null,
      });
      if (!res?.success) {
        setTokenExpired(true);
        return;
      }

      const { token, qrDataUrl, expiresAt, locationName } = JSON.parse(res.data);
      setShownLocation(locationName || "");
      currentTokenRef.current = token;
      setQrData(qrDataUrl);

      // The code's own lifetime, read from the server's answer rather than
      // assumed here — the two drifting apart is how a screen ends up showing
      // a code the server has already stopped accepting.
      const msLeft = new Date(expiresAt).getTime() - Date.now();
      expiryTimerRef.current = setTimeout(clearCode, Math.max(0, msLeft));
    } catch (err) {
      console.log("Could not request a code:", err);
      setTokenExpired(true);
    } finally {
      setIsRequesting(false);
    }
  };

  const chooseLocation = (id) => {
    setLocationId(id);
    try {
      window.localStorage.setItem(REMEMBERED, id);
    } catch {
      // Not remembering is a minor annoyance, not a failure.
    }
  };

  return (
    <div className="space-y-2">
      {needsChoice ? (
        <div className="space-y-1">
          <Select value={locationId} onValueChange={chooseLocation}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Which office is this screen in?" />
            </SelectTrigger>
            <SelectContent>
              {offices.map((o) => (
                <SelectItem key={o._id} value={o._id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-gray-500">
            Remembered in this browser only. To fix the answer to this screen
            so nobody has to pick again, an administrator can register it
            against an office under Reception &rarr; Devices.
          </p>
        </div>
      ) : null}

      {!siteId && myDeviceId ? (
        <div className="rounded-md border bg-gray-50 p-2 text-[11px] text-gray-600">
          {boundLocationId && enrolled?.locationName ? (
            <p>
              This screen is registered to{" "}
              <strong>{enrolled.locationName}</strong>. Attendance scanned here
              is recorded against that office.
            </p>
          ) : (
            <p>
              This screen is not registered to an office. An administrator can
              register it under Reception, using the ID below, so nobody has to
              choose each time.
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className="shrink-0">Screen ID:</span>
            <code className="truncate rounded bg-white px-1 py-0.5 font-mono">
              {myDeviceId}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                // Clipboard needs a secure context and can be refused; the ID
                // is on screen either way, so a failure just means typing it.
                navigator.clipboard
                  ?.writeText(myDeviceId)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        onClick={generateQRCode}
        disabled={(needsChoice && !locationId) || (!siteId && enrolled === null)}
        className={cn(
          "h-12 text-base bg-indigo-600 hover:bg-indigo-700",
          className,
        )}
      >
        <QrCode />
        Request Code
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-full sm:max-w-sm max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6">
          <DialogHeader>
            <DialogTitle>
              {tokenExpired ? "QR Code Expired" : "Scan to Continue"}
            </DialogTitle>
            <DialogDescription>
              {tokenExpired
                ? "The QR code has expired. Please generate a new one."
                : `Employees can scan this QR code to proceed and choose their action. Each code works once.${
                    shownLocation ? ` Recording against ${shownLocation}.` : ""
                  }`}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex justify-center">
            {qrData && !tokenExpired ? (
              <Image
                src={qrData}
                alt="QR Code"
                width={250}
                height={250}
                className="w-60 h-60 object-contain"
              />
            ) : (
              <div className="w-48 h-48 bg-gray-200 flex items-center justify-center rounded-md text-sm text-gray-600">
                {isRequesting ? (
                  <Loader2 className="size-6 animate-spin text-gray-500" />
                ) : tokenExpired ? (
                  "QR Expired"
                ) : (
                  "Click Request Code"
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full bg-red-500 hover:bg-red-600"
              onClick={() => {
                setIsDialogOpen(false);
                setQrData("");
                setTokenExpired(false);
              }}
            >
              {tokenExpired ? "Close" : "Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
