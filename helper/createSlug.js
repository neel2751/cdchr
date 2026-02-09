export function createSlug(title) {
  return title
    ? title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : Math.random().toString(36).substring(2, 8);
}
