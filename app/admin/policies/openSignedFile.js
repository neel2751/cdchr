import { toast } from "sonner";

/**
 * Open a file whose link has to be asked for first.
 *
 * The tab is opened before the request, not after it: a window opened once
 * an await has returned is no longer tied to the click, and most browsers
 * block it as a popup. It is pointed at the file when the link arrives, or
 * closed if the server says no.
 *
 * @param {() => Promise<{success: boolean, data?: string, message?: string}>} fetchLink
 */
export async function openSignedFile(fetchLink) {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;

  try {
    const res = await fetchLink();
    if (!res?.success) throw new Error(res?.message || "Could not open the file");
    const { url } = JSON.parse(res.data);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    tab?.close();
    toast.error(error?.message || "Could not open the file");
  }
}
