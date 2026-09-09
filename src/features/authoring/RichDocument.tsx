import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  ArrowDown, ArrowUp, Bold, Code, Code2, Heading1, Heading2, Heading3,
  Image as ImageIcon, Italic, Link2, List, ListOrdered, Minus, Paperclip,
  Quote, Redo2, RemoveFormatting, Search, Sigma, Table2, Trash2, Undo2, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActivityAsset, ActivitySection, RichTextNode } from "../../types";
import { academicEditorExtensions } from "./editorExtensions";

export function RichSectionEditor({ section, assets, editable, onChange, onTitleChange, onMove, onRemove, canMoveUp, canMoveDown }: {
  section: ActivitySection;
  assets: ActivityAsset[];
  editable: boolean;
  onChange: (content: RichTextNode) => void;
  onTitleChange: (title: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [equationOpen, setEquationOpen] = useState(false);
  const editor = useEditor({
    extensions: academicEditorExtensions,
    content: section.content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getJSON() as RichTextNode),
  });
  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);
  if (!editor) return <div className="editor-loading">Opening section…</div>;
  return <section className={`author-section author-section--${section.kind}`}>
    <header className="author-section__header">
      <input aria-label="Section title" disabled={!editable} value={section.title} onChange={(event) => onTitleChange(event.target.value)} />
      {editable ? <div className="author-section__actions"><button className="icon-button" disabled={!canMoveUp} onClick={() => onMove(-1)} title="Move section up"><ArrowUp size={16} /></button><button className="icon-button" disabled={!canMoveDown} onClick={() => onMove(1)} title="Move section down"><ArrowDown size={16} /></button>{section.kind === "custom" ? <button className="icon-button icon-button--danger" onClick={onRemove} title="Remove section"><Trash2 size={16} /></button> : null}</div> : null}
    </header>
    {editable ? <div className="editor-toolbar" role="toolbar" aria-label={`${section.title} formatting`}>
      <Tool active={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></Tool>
      <Tool active={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></Tool>
      <HeadingMenu editor={editor} />
      <Tool active={editor.isActive("code")} label="Inline code" onClick={() => editor.chain().focus().toggleCode().run()}><Code size={16} /></Tool>
      <Tool active={editor.isActive("bulletList")} label="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Tool>
      <Tool active={editor.isActive("orderedList")} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Tool>
      <Tool active={editor.isActive("blockquote")} label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></Tool>
      <CodeMenu editor={editor} />
      <TableMenu editor={editor} />
      <Tool label="Add or edit link" active={editor.isActive("link")} onClick={() => setLinkOpen(true)}><Link2 size={16} /></Tool>
      <Tool label="Insert equation" onClick={() => setEquationOpen(true)}><Sigma size={16} /></Tool>
      <Tool label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={16} /></Tool>
      <AssetDialog label="Insert image" icon={<ImageIcon size={16} />} assets={assets.filter((asset) => asset.kind === "image")} image onSelect={(asset, alt, caption) => editor.chain().focus().insertContent({ type: "image", attrs: { assetId: asset.id, alt, caption } }).run()} />
      <AssetDialog label="Insert teaching file" icon={<Paperclip size={16} />} assets={assets.filter((asset) => asset.kind === "attachment")} onSelect={(asset) => editor.chain().focus().insertContent({ type: "attachment", attrs: { assetId: asset.id, label: asset.originalFilename } }).run()} />
      <Tool label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={16} /></Tool>
      <span className="toolbar-spacer" />
      <Tool label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></Tool>
      <Tool label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></Tool>
    </div> : null}
    <EditorContent className="rich-editor" editor={editor} />
    <ValueDialog open={linkOpen} onOpenChange={setLinkOpen} title="Add or edit link" description="Use an http, https, or mailto address." label="Link address" initialValue={String(editor.getAttributes("link").href ?? "")} placeholder="https://example.edu/resource" onApply={(href) => editor.chain().focus().extendMarkRange("link").setLink({ href }).run()} onRemove={() => editor.chain().focus().unsetLink().run()} />
    <ValueDialog open={equationOpen} onOpenChange={setEquationOpen} title="Insert equation" description="ATOM renders this LaTeX with KaTeX in preview and student views." label="LaTeX" placeholder="x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" multiline onApply={(latex) => editor.chain().focus().insertBlockMath({ latex }).run()} />
  </section>;
}

function Tool({ children, label, active = false, disabled = false, onClick }: { children: React.ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) { return <button type="button" className={`toolbar-button${active ? " is-active" : ""}`} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>{children}</button>; }

function HeadingMenu({ editor }: { editor: Editor }) { return <DropdownMenu.Root><DropdownMenu.Trigger className={`toolbar-button${editor.isActive("heading") ? " is-active" : ""}`} aria-label="Heading level"><Heading2 size={16} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" sideOffset={5}><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={15} />Heading 1</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} />Heading 2</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} />Heading 3</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>; }

function CodeMenu({ editor }: { editor: Editor }) { const languages = ["python", "javascript", "java", "kotlin", "html", "css", "php", "mermaid"]; return <DropdownMenu.Root><DropdownMenu.Trigger className={`toolbar-button${editor.isActive("codeBlock") ? " is-active" : ""}`} aria-label="Code block language"><Code2 size={16} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" sideOffset={5}><DropdownMenu.Label className="menu-label">Code block language</DropdownMenu.Label>{languages.map((language) => <DropdownMenu.Item className="menu-item" key={language} onSelect={() => editor.chain().focus().toggleCodeBlock({ language }).run()}>{language === "mermaid" ? "Diagram source (Mermaid)" : language}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>; }

function TableMenu({ editor }: { editor: Editor }) { const inTable = editor.isActive("table"); return <DropdownMenu.Root><DropdownMenu.Trigger className={`toolbar-button${inTable ? " is-active" : ""}`} aria-label="Table tools"><Table2 size={16} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" sideOffset={5}>{!inTable ? <DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Insert 3 × 3 table</DropdownMenu.Item> : <><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().addRowAfter().run()}>Add row below</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().addColumnAfter().run()}>Add column right</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().deleteRow().run()}>Delete row</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().deleteColumn().run()}>Delete column</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</DropdownMenu.Item><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item menu-item--danger" onSelect={() => editor.chain().focus().deleteTable().run()}>Remove table</DropdownMenu.Item></>}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>; }

function ValueDialog({ open, onOpenChange, title, description, label, initialValue = "", placeholder, multiline = false, onApply, onRemove }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; label: string; initialValue?: string; placeholder?: string; multiline?: boolean; onApply: (value: string) => void; onRemove?: () => void }) { const [value, setValue] = useState(initialValue); useEffect(() => { if (open) setValue(initialValue); }, [initialValue, open]); const apply = () => { if (!value.trim()) return; onApply(value.trim()); onOpenChange(false); }; return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal value-dialog"><header className="modal__header"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={18} /></button></Dialog.Close></header><label><span>{label}</span>{multiline ? <textarea autoFocus rows={5} value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} /> : <input autoFocus value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} />}</label><footer className="modal__actions">{onRemove ? <button className="button button--danger" onClick={() => { onRemove(); onOpenChange(false); }}>Remove</button> : null}<Dialog.Close asChild><button className="button">Cancel</button></Dialog.Close><button className="button button--primary" disabled={!value.trim()} onClick={apply}>Apply</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>; }

function AssetDialog({ label, icon, assets, image = false, onSelect }: { label: string; icon: React.ReactNode; assets: ActivityAsset[]; image?: boolean; onSelect: (asset: ActivityAsset, alt: string, caption: string) => void }) { const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [selectedId, setSelectedId] = useState(""); const [alt, setAlt] = useState(""); const [caption, setCaption] = useState(""); const filtered = useMemo(() => assets.filter((asset) => asset.originalFilename.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [assets, query]); useEffect(() => { if (open) { setQuery(""); setSelectedId(""); setAlt(""); setCaption(""); } }, [open]); const selected = assets.find((asset) => asset.id === selectedId); return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button type="button" className="toolbar-button" aria-label={label} disabled={!assets.length}>{icon}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal asset-insert-dialog"><header className="modal__header"><div><Dialog.Title>{label}</Dialog.Title><Dialog.Description>Search teaching files already uploaded to this activity.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={18} /></button></Dialog.Close></header><label className="stream-search"><Search size={15} /><span className="sr-only">Search teaching files</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></label><div className="asset-choice-list">{filtered.map((asset) => <label key={asset.id}><input type="radio" name="asset" checked={selectedId === asset.id} onChange={() => { setSelectedId(asset.id); setAlt(asset.originalFilename); }} /><span><strong>{asset.originalFilename}</strong><small>{asset.mimeType}</small></span></label>)}</div>{image ? <div className="asset-image-fields"><label><span>Alternative text</span><input value={alt} onChange={(event) => setAlt(event.target.value)} /></label><label><span>Caption</span><input value={caption} onChange={(event) => setCaption(event.target.value)} /></label></div> : null}<footer className="modal__actions"><Dialog.Close asChild><button className="button">Cancel</button></Dialog.Close><button className="button button--primary" disabled={!selected} onClick={() => { if (selected) onSelect(selected, alt, caption); setOpen(false); }}>Insert</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>; }
