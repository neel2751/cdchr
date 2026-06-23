import { createDecipheriv } from "crypto";

const useAuthTag = async (searchParams) => {
  console.log(searchParams);
  const id = searchParams[0];
  const iv = searchParams[1];
  const authTag = searchParams[2];
  const decryptedId = await decryptId(id, iv, authTag);
  return { res: decryptedId, id, iv, authTag };
};
export default useAuthTag;
export function decryptId(encryptedId, iv, authTag) {
  try {
    // Key is sourced exclusively from environment configuration (no in-code
    // fallback). Mirrors lib/algo.js: NEXT_PUBLIC_ALGO_KEY (client-inlined) with
    // a fallback to the server-only variable.
    const key =
      process.env.NEXT_PUBLIC_ALGO_KEY || process.env.EMAIL_ENCRYPTION_KEY;
    if (!key || key.length !== 64) {
      throw new Error("Encryption key is not configured");
    }
    const cipherKey = Buffer.from(key, "hex");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cipherKey,
      Buffer.from(iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    let decrypted = decipher.update(encryptedId, "hex", "utf8");
    decrypted += decipher.final("utf8");
    const decryptedId = JSON.parse(decrypted).id;
    return decryptedId;
  } catch (error) {
    console.log(error);
    return null;
  }
}
