export const NODE_HANDLES_SELECTED_STYLE_CLASSNAME =
  "node-handles-selected-style";

export function isValidUrl(url) {
  return /^https?:\/\/\S+$/.test(url);
}

export const duplicateContent = (editor) => {
  const { view } = editor;
  const { state } = view;
  const { selection } = state;

  editor
    .chain()
    .insertContentAt(
      selection.to,
      /* eslint-disable */
      // @ts-nocheck
      selection.content().content.firstChild?.toJSON(),
      {
        updateSelection: true,
      }
    )
    .focus(selection.to)
    .run();
};

export function getUrlFromString(str) {
  if (isValidUrl(str)) {
    return str;
  }
  try {
    if (str.includes(".") && !str.includes(" ")) {
      return new URL(`https://${str}`).toString();
    }
  } catch {
    return null;
  }
}

export function absoluteUrl(path) {
  return `${process.env.NEXTAUTH_URL}${path}`;
}
