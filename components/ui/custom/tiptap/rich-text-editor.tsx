"use client";
import "./tiptap.css";
import { cn } from "@/lib/utils";
import { ImageExtension } from "./extensions/image";
import { ImagePlaceholder } from "./extensions/image-placeholder";
import SearchAndReplace from "./extensions/search-and-replace";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import { EditorContent, type Extension, useEditor, type Content } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TipTapFloatingMenu } from "./extensions/floating-menu";
import { FloatingToolbar } from "./extensions/floating-toolbar";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import { EditorToolbarBasic } from "./toolbars/editor-toolbar-basic";

const createExtensions = (placeholderText?: string) => [
  StarterKit.configure({
    orderedList: {
      HTMLAttributes: {
        class: "list-decimal"
      }
    },
    bulletList: {
      HTMLAttributes: {
        class: "list-disc"
      }
    },
    heading: {
      levels: [1, 2, 3, 4]
    }
  }),
  Placeholder.configure({
    emptyNodeClass: "is-editor-empty",
    placeholder: placeholderText
      ? placeholderText
      : ({ node }) => {
          switch (node.type.name) {
            case "heading":
              return `Heading ${node.attrs.level}`;
            case "detailsSummary":
              return "Section title";
            case "codeBlock":
              // never show the placeholder when editing code
              return "";
            default:
              return "Write, type '/' for commands";
          }
        },
    includeChildren: false
  }),
  TextAlign.configure({
    types: ["heading", "paragraph"]
  }),
  TextStyleKit,
  Subscript,
  Superscript,
  Underline,
  Link,
  Color,
  Highlight.configure({
    multicolor: true
  }),
  ImageExtension,
  ImagePlaceholder,
  SearchAndReplace,
  Typography
];

interface RichTextEditorDemoProps {
  className?: string;
  value?: string | Content;
  onChange?: (value: string | Content) => void;
  editorContentClassName?: string;
  output?: "html" | "text" | "json";
  placeholder?: string;
  autofocus?: boolean;
  editable?: boolean;
  editorClassName?: string;
}

export function RichTextEditorDemo({
  className,
  value,
  onChange,
  editorContentClassName,
  output = "html",
  placeholder,
  autofocus = false,
  editable = true,
  editorClassName
}: RichTextEditorDemoProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: createExtensions(placeholder) as Extension[],
    content: value || "",
    editable,
    autofocus,
    editorProps: {
      attributes: {
        class: cn("max-w-full focus:outline-none", editorClassName)
      }
    },
    onUpdate: ({ editor }) => {
      if (onChange) {
        const content =
          output === "html"
            ? editor.getHTML()
            : output === "text"
              ? editor.getText()
              : editor.getJSON();
        onChange(content);
      }
    }
  });

  // Update editor content when value prop changes (external updates)
  useEffect(() => {
    if (!editor || value === undefined) return;

    const currentHTML = editor.getHTML();
    const newHTML = typeof value === "string" ? value : "";

    // Only update if the content actually changed to avoid unnecessary updates
    if (newHTML && currentHTML !== newHTML) {
      editor.commands.setContent(newHTML, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "bg-card relative max-h-[calc(100dvh-6rem)] w-full overflow-hidden overflow-y-scroll border pb-[60px] sm:pb-0",
        className
      )}>
      <EditorToolbarBasic editor={editor} />
      <FloatingToolbar editor={editor} />
      <TipTapFloatingMenu editor={editor} />
      <EditorContent
        editor={editor}
        className={cn("min-h-60 w-full min-w-full cursor-text", editorContentClassName)}
      />
    </div>
  );
}
