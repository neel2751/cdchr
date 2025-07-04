import bcrypt from "bcryptjs";

export async function isMatchedPassword(password, hash) {
  try {
    const isMatch = await bcrypt.compare(password, hash);
    return isMatch;
  } catch (error) {
    console.log("Error comparing password: ", error);
    return false;
  }
}
export async function hashPassword(password) {
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    return hashedPassword;
  } catch (error) {
    console.log("Error hashing password: ", error);
    return null;
  }
}
