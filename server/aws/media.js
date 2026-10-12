/**
 * NOT a "use server" module, deliberately.
 *
 * Media rows are HR documents — contracts, right-to-work evidence, profile
 * images. Only server code imports this (profileImageServer, qrServer), yet
 * every function was an export of a "use server" module and therefore a public
 * endpoint: deleteMediaById and getMediaById took an id from the caller and
 * had no check at all, and getMediaById/deleteMediaById/getAllMedia have no
 * caller anywhere — three doors onto other people's documents that nothing
 * walks through.
 *
 * Tenant enforcement stops a signed-out caller and stops reaching another
 * company's rows; it says nothing about which employee of a company may
 * delete whose document. Not being an endpoint does.
 */
import { connect } from "@/db/db";
import MediaModel from "@/models/document/mediaModel";

export async function addMedia(data) {
  try {
    await connect();
    const newMedia = new MediaModel(data);
    await newMedia.save();
    const mediaId = newMedia._id.toString();
    return { success: true, mediaId };
  } catch (error) {
    console.error("Error adding media:", error);
    return { success: false, error: error.message };
  }
}

export async function getMediaById(mediaId) {
  try {
    await connect();
    const media = await MediaModel.findById(mediaId);
    if (!media) {
      return { success: false, message: "Media not found" };
    }
    return { success: true, data: JSON.stringify(media) };
  } catch (error) {
    console.error("Error fetching media by ID:", error);
    return { success: false, message: "Failed to fetch media" };
  }
}

export async function deleteMediaById(mediaId) {
  try {
    await connect();
    const deletedMedia = await MediaModel.findByIdAndDelete(mediaId);
    if (!deletedMedia) {
      return { success: false, message: "Media not found" };
    }
    return { success: true, message: "Media deleted successfully" };
  } catch (error) {
    console.error("Error deleting media by ID:", error);
    return { success: false, message: "Failed to delete media" };
  }
}

export async function getAllMedia() {
  try {
    await connect();
    const mediaList = await MediaModel.find().lean();
    return { success: true, data: JSON.stringify(mediaList) };
  } catch (error) {
    console.error("Error fetching all media:", error);
    return { success: false, message: "Failed to fetch media list" };
  }
}

export async function archiveMedia(mediaId) {
  if (!mediaId) return;

  await MediaModel.findByIdAndUpdate(mediaId, {
    status: "archived",
    archivedAt: new Date(),
  });
}
