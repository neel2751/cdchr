import mongoose from "mongoose";
/**
 * Creates a Mongoose ObjectId from a string.
 * @param {string} id - The id string to convert.
 * @returns {mongoose.Types.ObjectId}
 */
export function createObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

/**
 * Checks if a string is a valid Mongoose ObjectId.
 * @param {string} id - The id string to validate.
 * @returns {boolean}
 */
export function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}

/**
 * Start a new Mongoose session.
 * Use for transactions, etc.
 */
export async function startSession() {
  return await mongoose.startSession();
}

export async function withTransaction(callback) {
  const session = await startSession();
  try {
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    console.log("❌ Transaction Error:", error);
    await session.abortTransaction();
    return { success: false, message: error.message };
  } finally {
    session.endSession();
  }
}
