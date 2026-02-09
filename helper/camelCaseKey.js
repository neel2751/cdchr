export const toCamelCaseKey = (value) => {
  if (!value) return "";

  let cleaned = value
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      if (index === 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");

  // Ensure first character is a letter
  if (!/^[a-zA-Z]/.test(cleaned)) {
    cleaned = "field" + cleaned;
  }

  return cleaned;
};

export const generateUniqueKey = (value, currentId, allFields) => {
  if (!value) return "";

  let formatted = toCamelCaseKey(value);

  // Auto-fix duplicates
  let base = formatted;
  let counter = 2;

  while (allFields.some((f) => f.id !== currentId && f.name === formatted)) {
    formatted = base + counter;
    counter++;
  }

  return formatted;
};
