"use server";
import { connect } from "@/db/db";
import { syncLocationForSite } from "@/server/clockServer/clockLocationStore";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockLocationModel from "@/models/clockLocationModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import { featureRefusal } from "@/lib/requireFeature";

// Every export here is a POST endpoint. proxy.js keeps a company without the
// module off /admin/siteProject, but that is navigation only — these were
// callable directly regardless of plan, so the check is repeated in each one.

// # THIS IS THE WORKING ON THE NEW VERSION
export const searchSiteProjectByKeywordNew = async (filterData) => {
  const refusal = await featureRefusal("siteProjects");
  if (refusal) return refusal;
  try {
    const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
    // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
    const validPage = parseInt(filterData?.page || 1);
    const validLimit = parseInt(filterData?.pageSize || 10);
    const skip = (validPage - 1) * validLimit;
    const siteType = filterData?.filter?.type;
    // `$ne: true`, not `false`. `siteDelete` was added to the schema after
    // these documents were written, and a schema default only applies to
    // documents saved after it exists — so the oldest sites carry no such
    // field, and `{ siteDelete: false }` does not match a missing one. That
    // hid six of one company's ten sites from this screen entirely.
    //
    // Written this way rather than relying on a backfill so that the next
    // field added with a default does not repeat it.
    const query = { siteDelete: { $ne: true } };
    if (siteType) {
      query.siteType = siteType;
    }
    if (sanitizedSearch) {
      query.$or = [
        { siteName: { $regex: sanitizedSearch, $options: "i" } },
        { siteType: { $regex: sanitizedSearch, $options: "i" } },
        { siteAddress: { $regex: sanitizedSearch, $options: "i" } }, // added this line
        // { phoneNumber: { $regex: sanitizedSearch, $options: "i" } },
      ];
    }
    await connect();
    const totalCountDocuments = await ProjectSiteModel.countDocuments(query);

    // $sort before $skip/$limit. The other way round sorts the page that has
    // already been cut, so "page 2" is not the second page of a sorted list —
    // it is an arbitrary ten rows, sorted among themselves.
    const pipleline = [
      {
        $match: query,
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: validLimit,
      },
    ];
    const result = await ProjectSiteModel.aggregate(pipleline);
    return {
      success: true,
      data: JSON.stringify(result),
      totalCount: totalCountDocuments,
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Something  went wrong" }; // return error message
  }
};

/**
 * Is another site or office already called this?
 *
 * Uniqueness is enforced here, at the point a person types a name, rather than
 * on the ClockLocation that mirrors it. A location's name is a copy of the
 * site's: refusing the copy while allowing the original leaves the two
 * permanently disagreeing, which is exactly what halted the first migration —
 * two sites both called "Park Road New", one of them invisible because of the
 * `siteDelete` filter above, so nobody could rename either.
 *
 * Offices are included in the check. They live in `clocklocations` and are the
 * one thing not mirrored from a site, so a site named onto an office is a real
 * clash and would be indistinguishable in a picker.
 *
 * @param exceptId the site being renamed, which may keep its own name.
 */
async function siteNameTaken(name, exceptId = null) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;

  // Case-insensitive and anchored: "park road new" and "Park Road New" are the
  // same name to a person reading a rota.
  const exact = new RegExp(
    `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );

  const site = await ProjectSiteModel.findOne({
    siteName: exact,
    siteDelete: { $ne: true },
    ...(exceptId && isValidObjectId(exceptId)
      ? { _id: { $ne: createObjectId(exceptId) } }
      : {}),
  })
    .select("_id")
    .lean();
  if (site) return "site";

  const office = await ClockLocationModel.findOne({
    name: exact,
    projectSiteId: null,
    isActive: true,
  })
    .select("_id")
    .lean();
  return office ? "office" : null;
}

// # UPDATE A SPECIFIC SITE PROJECT INFORMATION BY ID
export const updateSiteProjectById = async (data, id) => {
  const refusal = await featureRefusal("siteProjects");
  if (refusal) return refusal;
  try {
    await connect();

    // Checked before either branch writes. A duplicate name is refused rather
    // than silently disambiguated, because the person is right here and can
    // fix it — unlike the sync path, where the site must save regardless.
    if (data?.siteName) {
      const clash = await siteNameTaken(data.siteName, id);
      if (clash) {
        return {
          success: false,
          message:
            clash === "office"
              ? `An office is already called "${data.siteName.trim()}". Give this site a different name.`
              : `Another site is already called "${data.siteName.trim()}". Give this one a different name.`,
        };
      }
    }

    if (id) {
      const updated = await ProjectSiteModel.findByIdAndUpdate(id, data, {
        new: true,
      });
      // Keep the site's clock-in location in step, so nobody maintains the
      // same name in two places. Never throws — see syncLocationForSite.
      if (updated) {
        await syncLocationForSite(updated._id, {
          name: updated.siteName,
          isActive: updated.isActive,
        });
      }
      return {
        success: true,
        message: "Site Project updated successfully",
      };
    } else {
      const created = await ProjectSiteModel.create(data).catch((error) => {
        console.error("Error creating ProjectSite:", error);
        return null;
      });
      // A failed create used to fall through to "Site Project created
      // successfully" — the error was logged to a server console nobody reads
      // and the form closed as though it had worked, so a site missing a
      // required date simply never appeared and nothing said why.
      if (!created) {
        return {
          success: false,
          message: "Could not create the site. Check the required fields.",
        };
      }
      // A new site becomes a place people can clock in at straight away,
      // rather than on the first scan — so it is visible and configurable
      // before anybody stands at the gate.
      await syncLocationForSite(created._id, {
        name: created.siteName,
        isActive: created.isActive,
      });
      return {
        success: true,
        message: "Site Project created successfully",
      };
    }
  } catch (e) {
    return { success: false, message: "Server Error" }; // return error message
  }
};

export const getSiteById = async (siteId) => {
  console.log("Site Id", siteId);
  if (!siteId) return { success: false, message: "Site Id is required." };
  const refusal = await featureRefusal("siteProjects");
  if (refusal) return refusal;
  try {
    // const response = await ProjectSiteModel.findOne({where:{id: siteId}}).populate('users');
    const response = await ProjectSiteModel.findOne({ _id: siteId });
    if (response.isActive) return { success: true, message: "success" };
    else
      return { success: false, message: "This site is not active right Now" };
  } catch (error) {
    console.log(`Error in getting site by id ${error}`);
    return { success: false, message: "Error in getting site by id" };
  }
};

export const siteProjectStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  const refusal = await featureRefusal("siteProjects");
  if (refusal) return refusal;
  try {
    const id = data?.id;
    const isActive = !data?.status;
    const statusDate = data.status ? new Date() : null;
    await ProjectSiteModel.updateOne(
      { _id: id },
      { $set: { isActive, statusDate } }
    );
    return {
      success: true,
      message: "The Status of the Site Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

export const siteProjectDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  const refusal = await featureRefusal("siteProjects");
  if (refusal) return refusal;
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    const statusDate = new Date();
    await ProjectSiteModel.updateOne(
      { _id: id },
      { $set: { isActive, delete: isDelete, statusDate } }
    );
    return {
      success: true,
      message: "The  Status of the Site Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};
