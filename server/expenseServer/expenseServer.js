"use server";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import ExpenseCategoryModel from "@/models/expense/expenseCategoryModel";
import { getServerSideProps } from "../session/session";
import ExpenseModel from "@/models/expense/expenseModel";
import { uploadImage } from "../aws/upload";
import { decrypt } from "@/lib/algo";

// Helper function to check duplicate names
async function checkDuplicateName(
  name,
  companyId,
  projectIds = [],
  excludeId = null
) {
  const query = {
    name: { $regex: new RegExp(`^${name.trim()}$`, "i") }, // Case insensitive exact match
    isDeleted: false,
  };

  // Add exclude condition for updates
  if (excludeId) {
    query._id = { $ne: createObjectId(excludeId) };
  }

  // Check based on projectIds or companyId
  if (projectIds && projectIds.length > 0) {
    // If projectIds provided, check within those projects
    query.projectIds = {
      $in: projectIds.map((id) => createObjectId(id)),
    };
  } else {
    // Otherwise check within company and categories without specific projects
    query.$and = [
      { companyId: createObjectId(companyId) },
      {
        $or: [
          { projectIds: { $size: 0 } }, // Empty projectIds array
          { projectIds: { $exists: false } }, // No projectIds field
        ],
      },
    ];
  }

  const existingCategory = await ExpenseCategoryModel.findOne(query);
  return existingCategory;
}

// Add new expense category
export async function addExpenseCategoryAction(data, id) {
  try {
    const { props } = await getServerSideProps();
    const createdBy = props?.session?.user?._id;

    await connect();

    // Validate required fields
    const { name, budget, companyId } = data;

    if (!name || !budget || !companyId || !createdBy) {
      return {
        success: false,
        message:
          "Missing required fields: name, budget, companyId, or createdBy",
      };
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
      budget: Number(budget),
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
      const companyId = data.companyId || currentCategory.companyId;
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
    if (data.budget !== undefined) updateData.budget = Number(data.budget);
    if (data.companyId !== undefined)
      updateData.companyId = createObjectId(data.companyId);
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

      // Lookup for company details (optional)
      {
        $lookup: {
          from: "companies", // Adjust collection name as needed
          localField: "companyId",
          foreignField: "_id",
          as: "company",
          pipeline: [{ $project: { name: 1, code: 1 } }],
        },
      },

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
          company: { $arrayElemAt: ["$company", 0] },
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

// Get single expense category by ID with aggregation
export async function getExpenseCategoryById({
  companyId,
  projectId,
  categoryId,
}) {
  try {
    await connect();
    const id = categoryId || projectId || companyId;
    if (!id) {
      return {
        success: false,
        message: "Expense category ID is required",
      };
    }
    if (!isValidObjectId(id)) {
      return {
        success: false,
        message: "Invalid expense category ID",
      };
    }

    const match = { isDeleted: false };
    if (companyId) {
      match.companyId = createObjectId(companyId);
    }
    if (projectId) {
      match.projectIds = { $in: [createObjectId(projectId)] };
    }
    if (categoryId) {
      match._id = createObjectId(categoryId);
    }

    const pipeline = [
      { $match: match },

      // Lookup for company and projects
      {
        $lookup: {
          from: "companies",
          localField: "companyId",
          foreignField: "_id",
          as: "company",
          pipeline: [{ $project: { name: 1, code: 1 } }],
        },
      },
      {
        $lookup: {
          from: "projectsites",
          localField: "projectIds",
          foreignField: "_id",
          as: "projects",
          pipeline: [{ $project: { siteName: 1 } }],
        },
      },

      // Add computed fields
      {
        $addFields: {
          company: { $arrayElemAt: ["$company", 0] },
          projectCount: { $size: "$projectIds" },
        },
      },

      // Clean up
      {
        $project: {
          createdByUser: 0,
          updatedByUser: 0,
        },
      },
    ];

    const result = await ExpenseCategoryModel.aggregate(pipeline);
    const category = result[0];

    if (!category) {
      return {
        success: false,
        message: "Expense category not found",
      };
    }

    return {
      success: true,
      data: JSON.stringify(category), // Return formatted JSON
    };
  } catch (error) {
    console.log("Error fetching expense category:", error);
    return {
      success: false,
      message: error.message || "Failed to fetch expense category",
    };
  }
}

// Get expense categories summary/stats
export async function getExpenseCategoriesStats(filter = {}) {
  try {
    await connect();

    const matchStage = { isDeleted: false };

    // Apply company filter if provided
    if (filter.companyId) {
      matchStage.companyId = createObjectId(filter.companyId);
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalCategories: { $sum: 1 },
          totalBudget: { $sum: "$budget" },
          avgBudget: { $avg: "$budget" },
          activeCategories: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
          },
          inactiveCategories: {
            $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] },
          },
        },
      },
    ];

    const result = await ExpenseCategoryModel.aggregate(pipeline);
    const stats = result[0] || {};

    return {
      success: true,
      data: {
        totalCategories: stats.totalCategories || 0,
        totalBudget: stats.totalBudget || 0,
        avgBudget: Math.round(stats.avgBudget || 0),
        activeCategories: stats.activeCategories || 0,
        inactiveCategories: stats.inactiveCategories || 0,
        activePercentage: stats.totalCategories
          ? Math.round((stats.activeCategories / stats.totalCategories) * 100)
          : 0,
      },
    };
  } catch (error) {
    console.log("Error fetching expense categories stats:", error);
    return {
      success: false,
      message: error.message || "Failed to fetch expense categories stats",
    };
  }
}

// Expense
export async function addExpenseAction(data) {
  try {
    const { props } = await getServerSideProps();
    const createdBy = props?.session?.user?._id;
    const role = props?.session?.user?.role;

    await connect();

    // Validate required fields
    const { title, amount, date, companyId, projectId } = data;

    if (!title || !amount || !date || !createdBy) {
      return {
        success: false,
        message: "Missing required fields: title, amount, date, or createdBy",
      };
    }

    let uploadReceipts = [];
    if (data?.receipt) {
      uploadReceipts = await uploadImage({
        file: data.receipt,
        path:
          companyId && createObjectId(companyId)
            ? projectId && createObjectId(projectId)
              ? `${companyId}/${projectId}/expenses/receipts`
              : `${companyId}/expenses/receipts`
            : projectId && createObjectId(projectId)
            ? `${projectId}/expenses/receipts`
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
    const categoryData = await ExpenseCategoryModel.findById(
      data.category
    ).select("name");

    // Create new expense
    const newExpense = new ExpenseModel({
      employeeId: createObjectId(createdBy),
      title: title.trim(),
      amount: Number(amount),
      date: new Date(date),
      categoryId: createObjectId(data.category),
      categoryLabel: categoryData ? categoryData.name.trim() : "Uncategorized",
      description: data.description?.trim() || "",
      receiptFiles: uploadReceipts.map((file) => ({
        ...file,
        uploadedAt: new Date(),
        uploadedBy: createObjectId(createdBy),
      })),
      companyId:
        companyId && createObjectId(companyId)
          ? createObjectId(companyId)
          : null,
      projectId:
        projectId && createObjectId(projectId)
          ? createObjectId(projectId)
          : null,
      createdBy: createObjectId(createdBy),
      updatedBy: createObjectId(createdBy),
      status: role === "superAdmin" ? "approved" : "pending", // Default status based on role
      isActive: true,
      isDeleted: false,
    });

    await newExpense.save();

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
}

// fetch all expenses with aggregation
export async function getAllExpenses(filter = {}) {
  try {
    await connect();

    // Build match stage for filtering
    const matchStage = { isDeleted: false };

    // Apply filters
    if (filter.companyId) {
      matchStage.companyId = createObjectId(filter.companyId);
    }

    if (filter.projectId) {
      if (!isValidObjectId(filter.projectId)) {
        const projectDecryptId = decrypt(filter.projectId);
        matchStage.projectId = createObjectId(projectDecryptId);
      } else {
        matchStage.projectId = createObjectId(filter.projectId);
      }
    }

    if (filter.employeeId) {
      matchStage.employeeId = createObjectId(filter.employeeId);
    }

    if (filter.categoryId) {
      matchStage.categoryId = createObjectId(filter.categoryId);
    }

    if (filter.fromDate && filter.toDate) {
      matchStage.date = {};
      if (filter.fromDate)
        matchStage.date.$gte = new Date(filter.fromDate || new Date());
      if (filter.toDate)
        matchStage.date.$lte = new Date(filter.toDate) || new Date();
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

      // Lookup for company details
      {
        $lookup: {
          from: "companies",
          localField: "companyId",
          foreignField: "_id",
          as: "company",
          pipeline: [{ $project: { name: 1, code: 1 } }],
        },
      },

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
          company: { $arrayElemAt: ["$company", 0] },
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
