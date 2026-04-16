import { type Editor } from "@tiptap/core";

export const NODE_HANDLES_SELECTED_STYLE_CLASSNAME = "node-handles-selected-style";

const DANGEROUS_URI_SCHEME = /^(javascript|data|vbscript|blob):/i;

export function isValidUrl(url: string) {
  if (DANGEROUS_URI_SCHEME.test(url.trim())) return false;
  return /^https?:\/\/\S+$/.test(url);
}

export const duplicateContent = (editor: Editor) => {
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
        updateSelection: true
      }
    )
    .focus(selection.to)
    .run();
};

export function getUrlFromString(str: string) {
  // Block dangerous URI schemes before any processing
  if (DANGEROUS_URI_SCHEME.test(str.trim())) return null;

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

export function absoluteUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')}${path}`;
}
