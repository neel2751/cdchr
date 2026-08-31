"use server";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import ExpenseCategoryModel from "@/models/expense/expenseCategoryModel";
import { getServerSideProps } from "../session/session";
import ExpenseModel from "@/models/expense/expenseModel";
import RoleBasedModel from "@/models/rolebasedModel";
import { uploadImage, generateDownloadUrl } from "../aws/upload";
import { decrypt } from "@/lib/algo";
import { getTenantFeatures } from "@/lib/tenantFeatures";
import { isFeatureEnabled } from "@/lib/tenantPlan";
import { withAudit, recordAudit } from "@/lib/audit";
import { OFFICE_PROJECT as OFFICE } from "@/lib/expenseFilters";

const MENU_PATH = "/admin/expense";

/** Mirrors the enum on models/expense/expenseModel.js. */
const EXPENSE_STATUSES = ["pending", "approved", "rejected"];

/** A Date, or null if the input is absent or unparseable. */
function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The last instant of the given UTC day, so a range includes its end date. */
function endOfUtcDay(date) {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * A project id from the URL, which may be encrypted.
 *
 * The site tab links carry encrypted ids (lib/algo), so a value that is not an
 * ObjectId gets one decrypt attempt. Returns null when it is neither, rather
 * than letting createObjectId throw out of the action.
 */
function resolveProjectId(value) {
  if (isValidObjectId(value)) return value;
  try {
    const decrypted = decrypt(value);
    return isValidObjectId(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
}

const denied = { success: false, message: "Not authorised" };

/**
 * An authorised read that must return nothing.
 *
 * Reads answer with an empty page rather than an error, matching
 * announcementServer.js. Two reasons: hooks/use-query.js parses `data`
 * unconditionally and throws on a result that has none, and a caller who is not
 * allowed to see the ledger should not be able to tell "you may not" from
 * "there is nothing" either.
 */
const emptyPage = (key) => ({
  success: true,
  data: JSON.stringify({
    [key]: [],
    pagination: {
      currentPage: 1,
      totalPages: 0,
      totalCount: 0,
      limit: 0,
      hasNextPage: false,
      hasPrevPage: false,
      showing: "0 of 0",
    },
    ...(key === "categories"
      ? { summary: {}, budgetDistribution: [], filters: { applied: false, activeFilters: [] } }
      : {}),
  }),
  totalCount: 0,
});

/**
 * May this user work with expenses?
 *
 * Two questions, in order:
 *
 *   1. Does their company's plan include the module? A flag that only removed
 *      the sidebar entry (lib/tenantPlan.js, via the menu) left the whole
 *      feature reachable by typing the URL, and reachable regardless by calling
 *      these actions.
 *   2. Are they allowed to use it? Super admins always are. An admin needs
 *      /admin/expense in their role's permission list — the same grant that
 *      puts the page in their sidebar and gets them past proxy.js. Nobody else
 *      qualifies: expenses are company finances, not self-service.
 *
 * Checking here and not only in proxy.js is the point. proxy.js guards
 * *navigation*; every function in this file is a POST endpoint that can be
 * called directly, and until this existed an ordinary employee could read the
 * whole ledger and delete categories.
 *
 * One rule for reads and writes, because filing an expense and listing them
 * need the same standing today. If expense submission later opens up to
 * ordinary employees — they cannot file their own at all right now, see
 * EXPENSE_PLAN.md — that is when the two should part.
 *
 * @returns {Promise<Object|null>} the session user, or null if not authorised
 */
async function requireExpenseAccess() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return null;

  // Before the feature lookup, not after the role check: getTenantFeatures()
  // swallows its own errors and answers "everything on", so an unconnected
  // first call would skip the plan check rather than fail visibly.
  await connect();

  const features = await getTenantFeatures(user.tenantId);
  if (!isFeatureEnabled(features, "expenses")) return null;

  if (user.role === "superAdmin") return user;
  if (user.role !== "admin") return null;

  const role = await RoleBasedModel.findOne({
    employeeId: user._id,
    isActive: true,
    isDeleted: false,
  })
    .select("permissions")
    .lean();

  return role?.permissions?.includes(MENU_PATH) ? user : null;
}

/**
 * A number the accounts can live with: present, finite, and above zero.
 *
 * `!amount` was the previous test, which rejects 0 and undefined but waves
 * through -500 — and the min:0 rules on the forms are client-side, so a direct
 * call to the action never met them.
 */
function positiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Is this category name already taken?
 *
 * Scoped to the company either way. The project branch used to match on
 * projectIds alone, dropping companyId entirely — so two businesses inside one
 * tenant that shared a site collided, and the admin was told the name existed
 * in a category they could not see.
 *
 * Note the tenant is not mentioned here: lib/tenantPlugin.js adds it. The
 * companyId below is the *business* the category belongs to, which is a
 * reporting dimension inside a tenant, not the tenant boundary.
 */
async function checkDuplicateName(
  name,
  companyId,
  projectIds = [],
  excludeId = null
) {
  const query = {
    name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, "i") },
    isDeleted: false,
    companyId: createObjectId(companyId),
  };

  // Add exclude condition for updates
  if (excludeId) {
    query._id = { $ne: createObjectId(excludeId) };
  }

  if (projectIds && projectIds.length > 0) {
    // Sharing any one project is enough to be a clash.
    query.projectIds = { $in: projectIds.map((id) => createObjectId(id)) };
  } else {
    // Company-wide categories only — those tied to no project.
    query.$or = [
      { projectIds: { $size: 0 } },
      { projectIds: { $exists: false } },
    ];
  }

  const existingCategory = await ExpenseCategoryModel.findOne(query);
  return existingCategory;
}

/**
 * Neutralise regex metacharacters in a user-supplied name.
 *
 * The duplicate check interpolates the name straight into a RegExp. A category
 * called "A+" or "(new)" is not a hostile act, but it is either a syntax error
 * or a pattern that matches the wrong rows.
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Add new expense category
export async function addExpenseCategoryAction(data, id) {
  try {
    const user = await requireExpenseAccess();
    if (!user) return denied;
    const createdBy = user._id;

    await connect();

    // Validate required fields
    const { name, budget } = data;

    if (!name || !createdBy) {
      return {
        success: false,
        message: "Missing required fields: name or createdBy",
      };
    }

    // The company is the signed-in user's own, never a form value. The picker
    // that used to supply it offered exactly one option — getSelectCompanies
    // returns only the caller's tenant — so it was a required field with a
    // single possible answer the server already knew, and a value the client
    // could otherwise set to anything.
    const companyId = user.tenantId;
    if (!isValidObjectId(companyId)) {
      return { success: false, message: "No company in context" };
    }

    const validBudget = positiveAmount(budget);
    if (validBudget === null) {
      return { success: false, message: "Budget must be a number above zero" };
    }

    if (id) {
      return updateExpenseCategoryAction(id, data);
    }

    // Check for duplicate name
    const duplicateCategory = await checkDuplicateName(
      name,
      companyId,
      data?.projectIds
    );

    if (duplicateCategory) {
      const scope =
        data.projectIds && data.projectIds.length > 0
          ? "selected projects"
          : "company";
      return {
        success: false,
        message: `An expense category with the name "${name}" already exists in this ${scope}`,
      };
    }

    // Create new expense category
    const newExpenseCategory = new ExpenseCategoryModel({
      name: name.trim(),
      description: data.description?.trim() || "",
      budget: validBudget,
      companyId: createObjectId(companyId),
      projectIds: data.projectIds?.map((id) => createObjectId(id)) || [],
      createdBy: createObjectId(createdBy),
      updatedBy: createObjectId(createdBy),
      status: data.status || false,
      isActive: data.isActive !== undefined ? data.isActive : true,
      isDeleted: false,
    });

    await newExpenseCategory.save();

    return {
      success: true,
      message: "Expense category created successfully",
    };
  } catch (error) {
    console.log("Error adding expense category:", error);
    return {
      success: false,
      message: error.message || "Failed to create expense category",
    };
  }
}

// Delete expense category (soft delete)
export async function deleteExpenseCategoryAction(id) {
  try {
    if (!(await requireExpenseAccess())) return denied;

    // Connect to database if not connected
    await connect();

    if (!id) {
      return {
        success: false,
        message: "Expense category ID is required",
      };
    }

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return {
        success: false,
        message: "Invalid expense category ID",
      };
    }

    // Soft delete by setting isDeleted to true
    const deletedCategory = await ExpenseCategoryModel.findByIdAndUpdate(
      id,
      {
        isDeleted: true,
        isActive: false,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!deletedCategory) {
      return {
        success: false,
        message: "Expense category not found",
      };
    }

    return {
      success: true,
      message: "Expense category deleted successfully",
    };
  } catch (error) {
    console.log("Error deleting expense category:", error);
    return {
      success: false,
      message: error.message || "Failed to delete expense category",
    };
  }
}

// Update expense category
export async function updateExpenseCategoryAction(id, data) {
  try {
    // Also reached from addExpenseCategoryAction, which has already checked.
    // Re-checking is cheap and keeps this safe as its own entry point.
    if (!(await requireExpenseAccess())) return denied;

    await connect();

    if (!id) {
      return {
        success: false,
        message: "Expense category ID is required",
      };
    }

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return {
        success: false,
        message: "Invalid expense category ID",
      };
    }

    // Get current category to access companyId and projectIds for duplicate check
    const currentCategory = await ExpenseCategoryModel.findById(id);
    if (!currentCategory || currentCategory.isDeleted) {
      return {
        success: false,
        message: "Expense category not found",
      };
    }

    // Check for duplicate name if name is being updated
    if (data.name && data.name.trim() !== currentCategory.name) {
      // The category's own company, not the request's — a category cannot move
      // company, so this is the only value the duplicate check can mean.
      const companyId = currentCategory.companyId;
      const projectIds =
        data.projectIds !== undefined
          ? data.projectIds
          : currentCategory.projectIds;

      const duplicateCategory = await checkDuplicateName(
        data.name,
        companyId,
        projectIds,
        id // Exclude current category from duplicate check
      );

      if (duplicateCategory) {
        const scope =
          projectIds && projectIds.length > 0 ? "selected projects" : "company";
        return {
          success: false,
          message: `An expense category with the name "${data.name}" already exists in this ${scope}`,
        };
      }
    }

    // Prepare update data
    const updateData = {
      updatedAt: new Date(),
    };

    // Only update provided fields
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined)
      updateData.description = data.description.trim();
    if (data.budget !== undefined) {
      const validBudget = positiveAmount(data.budget);
      if (validBudget === null) {
        return { success: false, message: "Budget must be a number above zero" };
      }
      updateData.budget = validBudget;
    }
    // `companyId` is deliberately not updatable. It is the caller's own tenant,
    // set on creation; accepting one here would let a client move a category to
    // another company's id, and the form no longer collects it.
    if (data.projectIds !== undefined) {
      updateData.projectIds = data.projectIds.map((id) => createObjectId(id));
    }
    if (data.updatedBy !== undefined)
      updateData.updatedBy = createObjectId(data.updatedBy);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Update the expense category
    const updatedCategory = await ExpenseCategoryModel.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedCategory) {
      return {
        success: false,
        message: "Expense category not found",
      };
    }

    return {
      success: true,
      message: "Expense category updated successfully",
    };
  } catch (error) {
    console.log("Error updating expense category:", error);
    return {
      success: false,
      message: error.message || "Failed to update expense category",
    };
  }
}

// Get all expense categories with aggregation pipeline
export async function getAllExpenseCategories(filter = {}) {
  try {
    if (!(await requireExpenseAccess())) return emptyPage("categories");

    // Connect to database if not connected
    await connect();

    // Build match stage for filtering
    const matchStage = {
      isDeleted: false, // Always exclude deleted items
    };

    // Apply filters
    if (filter.companyId) {
      matchStage.companyId = createObjectId(filter.companyId);
    }

    if (filter.isActive !== undefined) {
      matchStage.isActive = filter.isActive;
    }

    if (filter.status !== undefined) {
      matchStage.status = filter.status;
    }

    if (filter.projectId) {
      matchStage.projectIds = { $in: [createObjectId(filter.projectId)] };
    }

    if (filter.createdBy) {
      matchStage.createdBy = createObjectId(filter.createdBy);
    }

    // Search by name if provided
    if (filter.search) {
      matchStage.name = { $regex: filter.search, $options: "i" };
    }

    // Budget range filter
    if (filter.minBudget || filter.maxBudget) {
      matchStage.budget = {};
      if (filter.minBudget) matchStage.budget.$gte = Number(filter.minBudget);
      if (filter.maxBudget) matchStage.budget.$lte = Number(filter.maxBudget);
    }

    // Date range filters
    if (filter.startDate || filter.endDate) {
      matchStage.createdAt = {};
      if (filter.startDate)
        matchStage.createdAt.$gte = new Date(filter.startDate);
      if (filter.endDate) matchStage.createdAt.$lte = new Date(filter.endDate);
    }

    // Set up sorting
    const sortStage = {};
    if (filter.sortBy) {
      const sortOrder = filter.sortOrder === "desc" ? -1 : 1;
      sortStage[filter.sortBy] = sortOrder;
    } else {
      sortStage.createdAt = -1; // Default sort by creation date
    }

    // Set up pagination
    const page = parseInt(filter.page) || 1;
    const limit = parseInt(filter.limit) || 10;
    const skip = (page - 1) * limit;

    // Build aggregation pipeline
    const pipeline = [
      // Match stage for filtering
      { $match: matchStage },

      // No company join. Every row belongs to the signed-in company, so it
      // resolved the same name for every document and nothing reads it any
      // more — the tables dropped the column and the invoice takes the name
      // from branding, which is the same record.

      // Lookup for project details (optional)
      {
        $lookup: {
          from: "projectsites", // Adjust collection name as needed
          localField: "projectIds",
          foreignField: "_id",
          as: "projects",
          pipeline: [{ $project: { siteName: 1, siteType: 1 } }],
        },
      },

      // Add computed fields
      {
        $addFields: {
          projectCount: { $size: "$projectIds" },
          budgetStatus: {
            $switch: {
              branches: [
                { case: { $gte: ["$budget", 10000] }, then: "High" },
                { case: { $gte: ["$budget", 5000] }, then: "Medium" },
                { case: { $gte: ["$budget", 1000] }, then: "Low" },
              ],
              default: "Very Low",
            },
          },
        },
      },

      // Remove temporary fields
      {
        $project: {
          createdByUser: 0,
          updatedByUser: 0,
        },
      },

      // Sort stage
      { $sort: sortStage },

      // Facet for pagination and total count
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
          // Additional aggregations for summary
          summary: [
            {
              $group: {
                _id: null,
                totalBudget: { $sum: "$budget" },
                avgBudget: { $avg: "$budget" },
                maxBudget: { $max: "$budget" },
                minBudget: { $min: "$budget" },
                activeCount: {
                  $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
                },
                inactiveCount: {
                  $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] },
                },
                statusTrueCount: {
                  $sum: { $cond: [{ $eq: ["$status", true] }, 1, 0] },
                },
                statusFalseCount: {
                  $sum: { $cond: [{ $eq: ["$status", false] }, 1, 0] },
                },
              },
            },
          ],
          // Budget range distribution
          budgetDistribution: [
            {
              $group: {
                _id: {
                  $switch: {
                    branches: [
                      {
                        case: { $gte: ["$budget", 10000] },
                        then: "High (≥10k)",
                      },
                      {
                        case: { $gte: ["$budget", 5000] },
                        then: "Medium (5k-10k)",
                      },
                      {
                        case: { $gte: ["$budget", 1000] },
                        then: "Low (1k-5k)",
                      },
                    ],
                    default: "Very Low (<1k)",
                  },
                },
                count: { $sum: 1 },
                totalBudget: { $sum: "$budget" },
              },
            },
            { $sort: { totalBudget: -1 } },
          ],
        },
      },
    ];

    // Execute aggregation
    const result = await ExpenseCategoryModel.aggregate(pipeline);

    const categories = result[0].data;
    const totalCount = result[0].totalCount[0]?.count || 0;
    const summary = result[0].summary[0] || {};
    const budgetDistribution = result[0].budgetDistribution || [];

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    const data = JSON.stringify({
      categories,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
        showing: `${skip + 1}-${Math.min(
          skip + limit,
          totalCount
        )} of ${totalCount}`,
      },
      summary: {
        totalBudget: summary.totalBudget || 0,
        avgBudget: Math.round(summary.avgBudget || 0),
        maxBudget: summary.maxBudget || 0,
        minBudget: summary.minBudget || 0,
        activeCount: summary.activeCount || 0,
        inactiveCount: summary.inactiveCount || 0,
        statusTrueCount: summary.statusTrueCount || 0,
        statusFalseCount: summary.statusFalseCount || 0,
      },
      budgetDistribution,
      filters: {
        applied: Object.keys(filter).length > 0,
        activeFilters: Object.keys(filter).filter(
          (key) =>
            filter[key] !== undefined &&
            filter[key] !== null &&
            filter[key] !== ""
        ),
      },
    });

    return {
      success: true,
      data: data, // Return formatted JSON
      totalCount,
    };
  } catch (error) {
    console.log("Error fetching expense categories:", error);
    return {
      success: false,
      message: error.message || "Failed to fetch expense categories",
    };
  }
}

// getExpenseCategoryById and getExpenseCategoriesStats used to sit here. Both
// were dead — no caller anywhere — while still being live endpoints. The stats
// one was also redundant: getAllExpenseCategories already returns the same
// totals in its `summary` block, so a chart has something to read without it.

// Expense
export const addExpenseAction = withAudit(
  "Expense.create",
  async (data) => {
    try {
      const user = await requireExpenseAccess();
      if (!user) return denied;
      const createdBy = user._id;
      const role = user.role;

      await connect();

      // Validate required fields
      const { title, amount, date, projectId } = data;

      if (!title || !date || !createdBy) {
        return {
          success: false,
          message: "Missing required fields: title, date, or createdBy",
        };
      }

      // From the session, not the form — see addExpenseCategoryAction.
      const companyId = user.tenantId;

      const validAmount = positiveAmount(amount);
      if (validAmount === null) {
        return { success: false, message: "Amount must be a number above zero" };
      }

      const spentOn = new Date(date);
      if (Number.isNaN(spentOn.getTime())) {
        return { success: false, message: "Invalid date" };
      }

      if (!isValidObjectId(companyId)) {
        return { success: false, message: "No company in context" };
      }
      if (projectId && !isValidObjectId(projectId)) {
        return { success: false, message: "Invalid site or project" };
      }

      // Resolved before the upload, not after. The category is the one field
      // that can fail on a value the form chose, and uploading first would
      // leave an orphaned object in the bucket — counted against the company's
      // storage allowance — for an expense that was never created.
      //
      // The lookup is tenant-scoped by the plugin, so this doubles as the check
      // that the category is one of *this* company's: a category id belonging
      // to another tenant simply does not resolve.
      if (!isValidObjectId(data.category)) {
        return { success: false, message: "Select a category" };
      }
      const categoryData = await ExpenseCategoryModel.findOne({
        _id: createObjectId(data.category),
        isDeleted: false,
      }).select("name");
      if (!categoryData) {
        // Previously this wrote the expense anyway, labelled "Uncategorized" —
        // a silent miscategorisation of real money.
        return {
          success: false,
          message: "That expense category no longer exists",
        };
      }

      let uploadReceipts = [];
      if (data?.receipt) {
        // The category only, not a location: generatePreSignedUrl puts it under
        // this company's own prefix. The old value keyed on the *business*
        // companyId — a value the user picks on the form — which since the rename
        // is explicitly not the tenant boundary, so two companies referencing the
        // same record would have shared a prefix.
        uploadReceipts = await uploadImage({
          file: data.receipt,
          path: projectId
            ? `expenses/receipts/${projectId}`
            : "expenses/receipts",
          access: "private",
        });
        if (!uploadReceipts || uploadReceipts?.length === 0) {
          return {
            success: false,
            message: "Failed to upload receipt files",
          };
        }
      }

      // Create new expense
      const newExpense = new ExpenseModel({
        employeeId: createObjectId(createdBy),
        title: title.trim(),
        amount: validAmount,
        date: spentOn,
        categoryId: createObjectId(data.category),
        categoryLabel: categoryData.name.trim(),
        description: data.description?.trim() || "",
        receiptFiles: uploadReceipts.map((file) => ({
          ...file,
          uploadedAt: new Date(),
          uploadedBy: createObjectId(createdBy),
        })),
        companyId: companyId ? createObjectId(companyId) : null,
        projectId: projectId ? createObjectId(projectId) : null,
        updatedBy: createObjectId(createdBy),
        status: role === "superAdmin" ? "approved" : "pending", // Default status based on role
        isDeleted: false,
      });

      await newExpense.save();

      recordAudit({
        entityId: newExpense._id,
        after: newExpense.toObject(),
        description: `Filed expense "${newExpense.title}" for ${newExpense.amount}`,
      });

      return {
        success: true,
        message: "Expense added successfully",
      };
    } catch (error) {
      console.log("Error adding expense:", error);
      return {
        success: false,
        message: error.message || "Failed to add expense",
      };
    }
  },
  { module: "Expense" }
);

/**
 * Correct an expense that is already filed.
 *
 * Receipts are deliberately not editable here — replacing one would orphan the
 * old object and needs the delete path in server/aws/upload.js to be part of
 * the same unit of work. Amount, category, date and description cover what the
 * table's Edit button is for.
 *
 * Editing an approved expense sends it back to pending. An approval is a
 * statement about a specific amount; letting the figure change underneath one
 * would make the audit trail say something that was never agreed.
 */
export const updateExpenseAction = withAudit(
  "Expense.update",
  async (id, data = {}) => {
    try {
      if (!(await requireExpenseAccess())) return denied;
      if (!isValidObjectId(id)) {
        return { success: false, message: "Invalid expense" };
      }

      await connect();

      const before = await ExpenseModel.findById(id).lean();
      if (!before || before.isDeleted) {
        return { success: false, message: "Expense not found" };
      }

      const updateData = {};

      if (data.title !== undefined) {
        const title = String(data.title).trim();
        if (title.length < 3) {
          return {
            success: false,
            message: "Title must be at least 3 characters",
          };
        }
        updateData.title = title;
      }

      if (data.amount !== undefined) {
        const validAmount = positiveAmount(data.amount);
        if (validAmount === null) {
          return {
            success: false,
            message: "Amount must be a number above zero",
          };
        }
        updateData.amount = validAmount;
      }

      if (data.date !== undefined) {
        const spentOn = new Date(data.date);
        if (Number.isNaN(spentOn.getTime())) {
          return { success: false, message: "Invalid date" };
        }
        updateData.date = spentOn;
      }

      if (data.description !== undefined) {
        updateData.description = String(data.description).trim();
      }

      if (data.category !== undefined) {
        if (!isValidObjectId(data.category)) {
          return { success: false, message: "Select a category" };
        }
        const category = await ExpenseCategoryModel.findOne({
          _id: createObjectId(data.category),
          isDeleted: false,
        }).select("name");
        if (!category) {
          return {
            success: false,
            message: "That expense category no longer exists",
          };
        }
        updateData.categoryId = category._id;
        updateData.categoryLabel = category.name.trim();
      }

      if (data.projectId !== undefined) {
        if (data.projectId && !isValidObjectId(data.projectId)) {
          return { success: false, message: "Invalid site or project" };
        }
        updateData.projectId = data.projectId
          ? createObjectId(data.projectId)
          : null;
      }

      if (Object.keys(updateData).length === 0) {
        return { success: false, message: "Nothing to update" };
      }

      // See the docblock: a changed figure invalidates the approval it was
      // given under.
      const financiallyChanged =
        updateData.amount !== undefined || updateData.categoryId !== undefined;
      if (financiallyChanged && before.status === "approved") {
        updateData.status = "pending";
      }

      const updated = await ExpenseModel.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      });
      if (!updated) return { success: false, message: "Expense not found" };

      recordAudit({
        entityId: updated._id,
        before,
        after: updated.toObject(),
        description: `Updated expense "${updated.title}"`,
      });

      return {
        success: true,
        message:
          updateData.status === "pending" && before.status === "approved"
            ? "Expense updated and returned to pending approval"
            : "Expense updated successfully",
      };
    } catch (error) {
      console.log("Error updating expense:", error);
      return {
        success: false,
        message: error.message || "Failed to update expense",
      };
    }
  },
  { module: "Expense" }
);

/**
 * Remove an expense.
 *
 * Soft, like every other delete in this feature. The receipt objects are left
 * in the bucket on purpose: a deleted expense is still a financial record
 * someone may have to produce, and Media Management already lists and reclaims
 * orphaned receipts.
 */
export const deleteExpenseAction = withAudit(
  "Expense.delete",
  async (id) => {
    try {
      if (!(await requireExpenseAccess())) return denied;
      if (!isValidObjectId(id)) {
        return { success: false, message: "Invalid expense" };
      }

      await connect();

      const before = await ExpenseModel.findById(id).lean();
      if (!before || before.isDeleted) {
        return { success: false, message: "Expense not found" };
      }

      await ExpenseModel.findByIdAndUpdate(id, {
        isDeleted: true,
        isActive: false,
      });

      recordAudit({
        entityId: before._id,
        before,
        description: `Deleted expense "${before.title}" for ${before.amount}`,
      });

      return { success: true, message: "Expense deleted successfully" };
    } catch (error) {
      console.log("Error deleting expense:", error);
      return {
        success: false,
        message: error.message || "Failed to delete expense",
      };
    }
  },
  { module: "Expense" }
);

/**
 * Approve or reject a pending expense.
 *
 * The status enum has existed on the model since the beginning and nothing
 * could ever move it: addExpenseAction set it once and there was no second
 * writer, so every expense filed by an admin sat on "pending" for good.
 *
 * Nobody may rule on their own claim, super admins included. That is the one
 * rule worth hard-coding here — an approval workflow where the filer is also
 * the approver records a decision that was never really made.
 */
export const setExpenseStatusAction = withAudit(
  "Expense.setStatus",
  async (id, status) => {
    try {
      const user = await requireExpenseAccess();
      if (!user) return denied;
      if (!isValidObjectId(id)) {
        return { success: false, message: "Invalid expense" };
      }
      if (!EXPENSE_STATUSES.includes(status)) {
        return { success: false, message: "Unknown status" };
      }

      await connect();

      const before = await ExpenseModel.findById(id).lean();
      if (!before || before.isDeleted) {
        return { success: false, message: "Expense not found" };
      }

      // employeeId, not createdBy: the latter was never on the schema, so this
      // check silently matched nobody until the field was corrected.
      if (String(before.employeeId) === String(user._id)) {
        return {
          success: false,
          message: "You cannot approve or reject an expense you filed yourself",
        };
      }

      if (before.status === status) {
        return { success: false, message: `Already ${status}` };
      }

      const updated = await ExpenseModel.findByIdAndUpdate(
        id,
        { status, updatedBy: createObjectId(user._id) },
        { new: true, runValidators: true }
      );
      if (!updated) return { success: false, message: "Expense not found" };

      recordAudit({
        entityId: updated._id,
        before,
        after: updated.toObject(),
        description: `${status === "approved" ? "Approved" : "Rejected"} expense "${
          updated.title
        }" for ${updated.amount}`,
      });

      return { success: true, message: `Expense ${status}` };
    } catch (error) {
      console.log("Error setting expense status:", error);
      return {
        success: false,
        message: error.message || "Failed to update the expense status",
      };
    }
  },
  { module: "Expense" }
);

/**
 * A time-limited link to one receipt.
 *
 * Narrower than calling generateDownloadUrl directly. That helper accepts any
 * key this company owns, which for the expense page is too much: it would let
 * the receipt viewer sign an employment contract or a payslip. Requiring the
 * key to appear on the named expense keeps this feature's reach to this
 * feature's files.
 */
export async function getExpenseReceiptUrl(expenseId, key) {
  try {
    if (!(await requireExpenseAccess())) return denied;
    if (!isValidObjectId(expenseId) || !key) {
      return { success: false, message: "Invalid receipt" };
    }

    await connect();

    // Tenant-scoped by the plugin, so an expense from another company does not
    // resolve and its keys can never be reached through here.
    const expense = await ExpenseModel.findOne({
      _id: createObjectId(expenseId),
      isDeleted: false,
      "receiptFiles.key": key,
    })
      .select("_id")
      .lean();

    if (!expense) {
      return { success: false, message: "Receipt not found on this expense" };
    }

    // Still goes through assertKeyOwnedByTenant inside, which is the check that
    // matters if the record and the object ever disagree.
    return generateDownloadUrl({ key });
  } catch (error) {
    console.log("Error generating receipt URL:", error);
    return { success: false, message: "Failed to open the receipt" };
  }
}

// fetch all expenses with aggregation
export async function getAllExpenses(filter = {}) {
  try {
    if (!(await requireExpenseAccess())) return emptyPage("expenses");

    await connect();

    // Build match stage for filtering
    const matchStage = { isDeleted: false };

    // Apply filters. The company is never taken from the caller — the plugin
    // already restricts every row to the signed-in tenant.

    if (filter.projectId) {
      if (filter.projectId === OFFICE) {
        // Office expenses are the ones filed against no site at all — exactly
        // what the table labels "Office". `null` matches a null field and a
        // missing one, which is how older rows were written.
        matchStage.projectId = null;
      } else {
        const projectId = resolveProjectId(filter.projectId);
        // An unreadable id filters to nothing rather than throwing a BSONError
        // out of the action, which is what a stray value used to do.
        matchStage.projectId = projectId ? createObjectId(projectId) : null;
      }
    }

    if (filter.employeeId && isValidObjectId(filter.employeeId)) {
      matchStage.employeeId = createObjectId(filter.employeeId);
    }

    if (filter.categoryId && isValidObjectId(filter.categoryId)) {
      matchStage.categoryId = createObjectId(filter.categoryId);
    }

    // Each end applies on its own. This used to require *both* — half a range
    // was dropped in silence, so "everything since March" returned everything.
    // Unparseable values are ignored rather than turned into an Invalid Date,
    // which as a $gte matches nothing and empties the table.
    const fromDate = toValidDate(filter.fromDate);
    const toDate = toValidDate(filter.toDate);
    if (fromDate || toDate) {
      matchStage.date = {};
      if (fromDate) matchStage.date.$gte = fromDate;
      // Expenses are stored at UTC midnight (lib/formatDate normalizeDateToUTC),
      // but end-of-day makes the range hold for any row that ever carries a
      // time — an import, a migration, a different write path.
      if (toDate) matchStage.date.$lte = endOfUtcDay(toDate);
    }

    // Search by title if provided
    if (filter.query) {
      matchStage.title = { $regex: filter.query, $options: "i" };
    }

    // Set up sorting
    const sortStage = {};
    if (filter.sortBy) {
      const sortOrder = filter.sortOrder === "desc" ? -1 : 1;
      sortStage[filter.sortBy] = sortOrder;
    } else {
      sortStage.createdAt = -1; // Default sort by creation date
    }

    // Set up pagination
    const page = parseInt(filter.page) || 1;
    const limit = parseInt(filter.limit) || 10;
    const skip = (page - 1) * limit;

    // Build aggregation pipeline
    const pipeline = [
      { $match: matchStage },

      // Lookup for employee details
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
          pipeline: [{ $project: { name: 1, email: 1 } }],
        },
      },

      // No company join — see the note in getAllExpenseCategories.

      // Lookup for project details
      {
        $lookup: {
          from: "projectsites",
          localField: "projectId",
          foreignField: "_id",
          as: "project",
          pipeline: [{ $project: { siteName: 1, siteType: 1 } }],
        },
      },
      {
        $addFields: {
          employee: { $arrayElemAt: ["$employee", 0] },
          project: { $arrayElemAt: ["$project", 0] },
        },
      },
      // Add computed fields
      {
        $addFields: {
          receiptCount: { $size: "$receiptFiles" },
          totalAmount: "$amount",
        },
      },
      // Sort stage
      { $sort: sortStage },
      // Facet for pagination and total count
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];
    // Execute aggregation
    const result = await ExpenseModel.aggregate(pipeline);
    const expenses = result[0].data;
    const totalCount = result[0].totalCount[0]?.count || 0;
    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    const data = JSON.stringify({
      expenses,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
        showing: `${skip + 1}-${Math.min(
          skip + limit,
          totalCount
        )} of ${totalCount}`,
      },
    });
    return {
      success: true,
      data: data, // Return formatted JSON
      totalCount,
    };
  } catch (error) {
    console.log("Error fetching expenses:", error);
    return {
      success: false,
      message: error.message || "Failed to fetch expenses",
    };
  }
}

// ── Dropdown options ───────────────────────────────────────────────────────
// Both of these were in selectServer.js, where nothing is guarded. They belong
// with the feature: a company whose plan excludes expenses should not be able to
// enumerate expense categories either.

const asOptions = [
  {
    $project: {
      _id: 0,
      value: "$_id",
      label: "$name",
    },
  },
  { $sort: { label: 1 } },
];

/**
 * Category options for the expense form.
 *
 * Takes no company: it is always the caller's own, which the tenant plugin
 * already filters by. The parameter used to come from a picker offering exactly
 * one option, and passing it back meant the dropdown stayed empty until the
 * user chose the only company they had.
 */
export async function getSelectExpenseCategory({ projectId } = {}) {
  try {
    const user = await requireExpenseAccess();
    if (!user) return { success: true, data: JSON.stringify([]) };
    await connect();

    const match = {
      isActive: true,
      isDeleted: false,
      companyId: createObjectId(user.tenantId),
    };

    // Three distinct cases, using the same vocabulary as the project filter:
    //
    //   a site id  → the categories attached to that site
    //   OFFICE     → the company-wide ones, tied to no site
    //   absent     → every category
    //
    // The last one used to fall in with OFFICE, which is right for the *form*
    // (filing without a site means an office expense) but wrong for the
    // *filter*, where "all sites" must offer every category. Sharing one branch
    // meant the filter listed only the office categories.
    if (projectId === OFFICE) {
      match.$or = [
        { projectIds: { $exists: false } },
        { projectIds: { $size: 0 } },
      ];
    } else if (projectId) {
      const resolved = resolveProjectId(projectId);
      // An unreadable id narrows to nothing rather than silently widening.
      match.projectIds = { $in: resolved ? [createObjectId(resolved)] : [] };
    }

    const categories = await ExpenseCategoryModel.aggregate([
      { $match: match },
      ...asOptions,
    ]).exec();

    return { success: true, data: JSON.stringify(categories) };
  } catch (error) {
    console.log("Error fetching expense category options:", error);
    return { success: false, message: "Failed to fetch expense categories" };
  }
}

/** Category options for one site's expense tab. */
export async function getSelectExpenseCategoryBySite({ projectId }) {
  try {
    if (!(await requireExpenseAccess())) {
      return { success: true, data: JSON.stringify([]) };
    }
    if (!isValidObjectId(projectId)) {
      return { success: true, data: JSON.stringify([]) };
    }
    await connect();

    const categories = await ExpenseCategoryModel.aggregate([
      {
        $match: {
          isActive: true,
          isDeleted: false,
          projectIds: { $in: [createObjectId(projectId)] },
        },
      },
      ...asOptions,
    ]).exec();

    return { success: true, data: JSON.stringify(categories) };
  } catch (error) {
    console.log("Error fetching site expense category options:", error);
    return { success: false, message: "Failed to fetch expense categories" };
  }
}
