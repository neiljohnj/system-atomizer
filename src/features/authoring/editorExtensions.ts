import { mergeAttributes, Node } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Mathematics from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

const AtomImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: null },
      alt: { default: "" },
      caption: { default: "" },
    };
  },
  parseHTML() { return [{ tag: "figure[data-atom-image]" }]; },
  renderHTML({ HTMLAttributes }) {
    const assetId = String(HTMLAttributes.assetId ?? "");
    return [
      "figure",
      { "data-atom-image": assetId, class: "rich-image" },
      ["img", mergeAttributes({ src: `/api/activity-assets/${assetId}/file`, alt: HTMLAttributes.alt ?? "" })],
      HTMLAttributes.caption ? ["figcaption", {}, String(HTMLAttributes.caption)] : ["figcaption", { hidden: "hidden" }, ""],
    ];
  },
});

const AtomAttachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { assetId: { default: null }, label: { default: "Attachment" } };
  },
  parseHTML() { return [{ tag: "div[data-atom-attachment]" }]; },
  renderHTML({ HTMLAttributes }) {
    const assetId = String(HTMLAttributes.assetId ?? "");
    return [
      "div",
      { "data-atom-attachment": assetId, class: "rich-attachment" },
      ["a", { href: `/api/activity-assets/${assetId}/file`, download: "", contenteditable: "false" }, String(HTMLAttributes.label || "Attachment")],
    ];
  },
});

export const academicEditorExtensions = [
  StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: "python" }),
  TableKit.configure({ table: { resizable: false } }),
  Mathematics.configure({ katexOptions: { throwOnError: false, strict: false } }),
  AtomImage,
  AtomAttachment,
];
