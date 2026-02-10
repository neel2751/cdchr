"use server";

import { connect } from "@/db/db";
import QRCodeModel from "@/models/QrCodeModel";
import { getServerSideProps } from "../session/session";
import VisitorModel from "@/models/visitorModel";
import { generatePreSignedUrl, getPublicUrl } from "../aws/upload";
import axios from "axios";
import { addMedia, archiveMedia } from "../aws/media";
import { createSlug } from "@/helper/createSlug";

export async function createQrCode(data) {
  if (!data) {
    return { success: false, message: "Invalid data provided" };
  }

  const { props } = await getServerSideProps();
  const { _id } = props.session.user;

  if (!_id) {
    return { success: false, message: "Unauthorized" };
  }

  if (data._id) return await editQrCode(data, data._id);

  try {
    await connect();

    const createSlugFromTitle = createSlug(data.title);
    data.slug = createSlugFromTitle;

    const slugRegex = /^[a-zA-Z0-9-_]+$/;
    if (!slugRegex.test(data.slug)) {
      return {
        success: false,
        message:
          "Slug can only contain alphanumeric characters, hyphens, and underscores",
      };
    }

    // we know we have array here but we allow only one image for qr code so we take the first one
    const images = Array.isArray(data.image) ? data.image[0] : data.image;

    const { url, key } = await generatePreSignedUrl({
      fileName: images.name,
      contentType: images.type,
      path: "qr-codes",
      access: "public",
    });

    const reponse = await axios.put(url, images, {
      headers: {
        "Content-Type": images.type,
      },
    });

    if (reponse.status !== 200) {
      return {
        success: false,
        message: "Failed to upload QR code image",
      };
    }

    const fileUrl = await getPublicUrl({ key, access: "public" });

    const mediaData = {
      fileName: images.name,
      fileType: images.type,
      fileSize: images.size,
      url: fileUrl.url,
      key,
      access: "public",
      status: "uploaded",
      category: "qr-code",
      tags: [data.slug],
    };

    const mediaRes = await addMedia(mediaData);

    const existingQr = await QRCodeModel.findOne({ slug: data.slug });

    if (existingQr) {
      return {
        success: false,
        message: "QR code with this slug already exists",
      };
    }

    const newQrCode = new QRCodeModel({
      title: data.title,
      agentId: _id,
      slug: data.slug,
      formTitle: data.formTitle,
      successMessage: data.successMessage,
      templateId: data.templateId,
      mediaId: mediaRes.mediaId,
    });

    await newQrCode.save();

    return {
      success: true,
      message: "QR code created successfully",
    };
  } catch (error) {
    console.error("Error creating QR code:", error);
    return { success: false, message: "Server error while creating QR code" };
  }
}

export async function getAllQrCodes() {
  try {
    const { props } = await getServerSideProps();
    const { _id } = props.session.user;
    if (!_id) {
      return { success: false, message: "Unauthorized" };
    }

    await connect();
    const qrCodes = await QRCodeModel.find({ agentId: _id })
      .sort({
        createdAt: -1,
      })
      .populate("mediaId", "url")
      .lean();
    return { success: true, data: JSON.stringify(qrCodes) };
  } catch (error) {
    console.error("Error fetching QR codes:", error);
    return { success: false, message: "Server error while fetching QR codes" };
  }
}

export async function getQrCodeBySlug(slug) {
  try {
    await connect();

    const pipeline = [
      { $match: { slug } },
      {
        $lookup: {
          from: "formtemplates",
          localField: "templateId",
          foreignField: "_id",
          as: "templateDetails",
        },
      },
      {
        $lookup: {
          from: "media",
          localField: "mediaId",
          foreignField: "_id",
          as: "mediaDetails",
        },
      },
      { $unwind: "$templateDetails" },
      { $unwind: "$mediaDetails" },
      {
        $project: {
          title: 1,
          slug: 1,
          formTitle: 1,
          successMessage: 1,
          "templateDetails.fields": 1,
          "mediaDetails.url": 1,
        },
      },
    ];

    const qrCode = await QRCodeModel.aggregate(pipeline).then(
      (results) => results[0] || null
    );
    if (!qrCode) {
      return { success: false, message: "QR code not found" };
    }
    return { success: true, data: qrCode };
  } catch (error) {
    console.error("Error fetching QR code by slug:", error);
    return { success: false, message: "Server error while fetching QR code" };
  }
}

export async function myLeads() {
  const { props } = await getServerSideProps();
  const { _id, role } = props.session.user;

  try {
    await connect();

    // 1. If SuperAdmin, get everything. If Admin, get only theirs.
    const query = role === "superAdmin" ? {} : { assignedTo: _id };

    const leads = await VisitorModel.find(query)
      .sort({ createdAt: -1 })
      .populate("assignedTo", "name email");

    return res.status(200).json({ success: true, data: leads });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

// Edit Qr Code
export async function editQrCode(data, id) {
  try {
    if (!id) {
      return { success: false, message: "QR code ID is required" };
    }

    await connect();

    // 1️⃣ Fetch existing QR once
    const existingQr = await QRCodeModel.findById(id);
    if (!existingQr) {
      return { success: false, message: "QR code not found" };
    }

    /* ------------------------------------------------------------
       2️⃣ SLUG HANDLING
    ------------------------------------------------------------- */

    const newSlug = createSlug(data.title);

    const slugRegex = /^[a-zA-Z0-9-_]+$/;
    if (!slugRegex.test(newSlug)) {
      return {
        success: false,
        message:
          "Slug can only contain alphanumeric characters, hyphens, and underscores",
      };
    }

    // If slug changed → check uniqueness
    if (newSlug !== existingQr.slug) {
      const slugExists = await QRCodeModel.findOne({
        slug: newSlug,
        _id: { $ne: id },
      });

      if (slugExists) {
        return {
          success: false,
          message: "QR code with this slug already exists",
        };
      }
    }

    data.slug = newSlug;

    /* ------------------------------------------------------------
       3️⃣ IMAGE HANDLING
    ------------------------------------------------------------- */

    const isNewImage = data.image && typeof data.image !== "string";

    if (isNewImage) {
      const image = Array.isArray(data.image) ? data.image[0] : data.image;

      // 3.1 Generate presigned URL
      const { url, key } = await generatePreSignedUrl({
        fileName: image.name,
        contentType: image.type,
        path: "qr-codes",
        access: "public",
      });

      // 3.2 Upload to storage
      const uploadResponse = await axios.put(url, image, {
        headers: {
          "Content-Type": image.type,
        },
      });

      if (uploadResponse.status !== 200) {
        return {
          success: false,
          message: "Failed to upload new QR image",
        };
      }

      // 3.3 Get public URL
      const fileUrl = await getPublicUrl({
        key,
        access: "public",
      });

      // 3.4 Create new media record
      const mediaRes = await addMedia({
        fileName: image.name,
        fileType: image.type,
        fileSize: image.size,
        url: fileUrl.url,
        key,
        access: "public",
        status: "uploaded",
        category: "qr-code",
        tags: [newSlug],
      });

      data.mediaId = mediaRes.mediaId;

      // 3.5 Delete old media (safe cleanup)
      if (existingQr.mediaId) {
        await archiveMedia(existingQr.mediaId);
      }
    } else {
      // Image unchanged
      data.mediaId = existingQr.mediaId;
    }

    // Remove image field (we don't store raw file in QR)
    delete data.image;

    /* ------------------------------------------------------------
       4️⃣ UPDATE QR
    ------------------------------------------------------------- */

    const updatedQr = await QRCodeModel.findByIdAndUpdate(
      id,
      {
        title: data.title,
        slug: data.slug,
        formTitle: data.formTitle,
        successMessage: data.successMessage,
        templateId: data.templateId,
        mediaId: data.mediaId,
      },
      { new: true }
    );

    if (!updatedQr) {
      return { success: false, message: "QR code update failed" };
    }

    return {
      success: true,
      message: "QR code updated successfully",
    };
  } catch (error) {
    console.error("Error editing QR code:", error);
    return {
      success: false,
      message: "Server error while editing QR code",
    };
  }
}

export async function deleteQrCode(id) {
  try {
    await connect();
    // we have todo isDeleted: true
    const deleted = await QRCodeModel.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    )
      .then((res) => res)
      .catch((err) => {
        console.error("Error marking QR code as deleted:", err);
        return null;
      });

    if (!deleted) {
      return { success: false, message: "QR code not found" };
    }
    return { success: true, message: "QR code deleted successfully" };
  } catch (error) {
    console.error("Error deleting QR code:", error);
    return { success: false, message: "Server error while deleting QR code" };
  }
}
