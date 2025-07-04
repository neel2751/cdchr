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
    const key =
      "52bdc56fb0440989d14fad277de68f2221727ae3501ffe3d37607e5684d4be88";
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
    console.error(error);
    return null;
  }
}
