import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import katex from "katex";
import { createElement, Fragment, type ReactNode } from "react";
import type { ActivityBlueprintV1, ActivityDocumentV1, ActivitySection, RichTextNode } from "../../types";

hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("php", php);
hljs.registerLanguage("java", java);

export default function RichDocumentRenderer({ document, blueprint, className = "" }: { document: ActivityDocumentV1; blueprint?: ActivityBlueprintV1; className?: string }) {
  return <div className={`rich-document ${className}`}>
    {document.sections.map((section) => <ReadOnlySection section={section} key={section.id} />)}
    {blueprint?.mode === "progressive" ? <ProgressiveParts blueprint={blueprint} /> : null}
    {blueprint ? <SubmissionSpecification blueprint={blueprint} /> : null}
    {blueprint?.rubric ? <Rubric blueprint={blueprint} /> : null}
  </div>;
}

function ProgressiveParts({ blueprint }: { blueprint: ActivityBlueprintV1 }) {
  return <section className="rendered-parts"><header><span>{blueprint.progression === "sequential" ? "Sequential progression" : "Independent parts"}</span><h2>Activity parts</h2></header><nav className="part-navigator" aria-label="Activity parts">{blueprint.parts.map((part) => <a href={`#activity-part-${part.id}`} key={part.id}>{part.shortLabel}</a>)}</nav>{blueprint.parts.map((part) => <details className="rendered-part" id={`activity-part-${part.id}`} open key={part.id}><summary><span>{part.shortLabel}</span><strong>{part.title}</strong></summary><div>{part.contentDocument.sections.map((section) => <ReadOnlySection section={section} key={section.id} />)}</div></details>)}</section>;
}

function SubmissionSpecification({ blueprint }: { blueprint: ActivityBlueprintV1 }) {
  const submission = blueprint.submission;
  if (!submission.requirements.length) return null;
  return <section className="structured-preview"><header><span>Submission manifest</span><h2>Required deliverables</h2><p>{submission.delivery === "zip" ? "Submit a ZIP bundle." : submission.delivery === "single_file" ? "Submit one individual file." : "Submit an individual file or ZIP bundle."} {submission.validationMode === "strict" ? "Mismatches are rejected." : submission.validationMode === "warning" ? "Mismatches are accepted with a recorded warning." : "Requirements are descriptive only."}</p></header><ul>{submission.requirements.map((item) => <li key={item.id}><strong>{item.label}</strong><code>{item.filenameTemplate}</code><span>{item.allowedExtensions.join(", ")}{item.kind === "file_set" ? ` · at least ${item.minCount}` : ""}{item.partId ? ` · ${blueprint.parts.find((part) => part.id === item.partId)?.shortLabel ?? "part"}` : ""}</span></li>)}</ul></section>;
}

function Rubric({ blueprint }: { blueprint: ActivityBlueprintV1 }) {
  const rubric = blueprint.rubric!;
  const total = rubric.criteria.reduce((sum, item) => sum + item.points, 0);
  return <section className="structured-preview rubric-preview"><header><span>Assessment rubric</span><h2>Full-credit evidence</h2><p>{total} criterion points · configured maximum {rubric.expectedPoints}</p></header><div className="rich-table-scroll"><table><thead><tr><th>Criterion</th>{rubric.mode === "per_part" ? <th>Part</th> : null}<th>Evidence</th><th>Points</th></tr></thead><tbody>{rubric.criteria.map((item) => <tr key={item.id}><td><strong>{item.title}</strong>{item.description ? <small>{item.description}</small> : null}</td>{rubric.mode === "per_part" ? <td>{blueprint.parts.find((part) => part.id === item.partId)?.shortLabel ?? "—"}</td> : null}<td>{item.fullCreditEvidence}</td><td>{item.points}</td></tr>)}</tbody></table></div></section>;
}

function ReadOnlySection({ section }: { section: ActivitySection }) {
  return <section className={`rich-section rich-section--${section.kind}`}><h2>{section.title}</h2><div className="tiptap">{renderChildren(section.content)}</div></section>;
}

function renderChildren(node: RichTextNode): ReactNode[] {
  return (node.content ?? []).map((child, index) => <NodeRenderer node={child} key={`${child.type}-${index}`} />);
}

function NodeRenderer({ node }: { node: RichTextNode }): ReactNode {
  const children = renderChildren(node);
  switch (node.type) {
    case "doc": return <Fragment>{children}</Fragment>;
    case "text": return applyMarks(node.text ?? "", node);
    case "paragraph": return <p>{children}</p>;
    case "heading": return createElement(`h${headingLevel(node)}`, {}, children);
    case "bulletList": return <ul>{children}</ul>;
    case "orderedList": return <ol start={positiveInteger(node.attrs?.start)}>{children}</ol>;
    case "listItem": return <li>{children}</li>;
    case "blockquote": return <blockquote>{children}</blockquote>;
    case "hardBreak": return <br />;
    case "horizontalRule": return <hr />;
    case "codeBlock": return <CodeBlock node={node} />;
    case "table": return <div className="rich-table-scroll"><table><tbody>{children}</tbody></table></div>;
    case "tableRow": return <tr>{children}</tr>;
    case "tableHeader": return <th colSpan={positiveInteger(node.attrs?.colspan)} rowSpan={positiveInteger(node.attrs?.rowspan)}>{children}</th>;
    case "tableCell": return <td colSpan={positiveInteger(node.attrs?.colspan)} rowSpan={positiveInteger(node.attrs?.rowspan)}>{children}</td>;
    case "image": return <figure className="rich-image"><img src={assetUrl(node)} alt={stringAttr(node, "alt")} />{stringAttr(node, "caption") ? <figcaption>{stringAttr(node, "caption")}</figcaption> : null}</figure>;
    case "attachment": return <div className="rich-attachment"><a href={assetUrl(node)} download>{stringAttr(node, "label") || "Attachment"}</a></div>;
    case "mathematics":
    case "inlineMath": return <MathExpression latex={stringAttr(node, "latex")} block={false} />;
    case "blockMath": return <MathExpression latex={stringAttr(node, "latex")} block />;
    default: return null;
  }
}

function CodeBlock({ node }: { node: RichTextNode }) {
  const language = stringAttr(node, "language").toLowerCase();
  const code = plainText(node);
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);
  return <pre><code className={language ? `language-${language} hljs` : "hljs"} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>;
}

function MathExpression({ latex, block }: { latex: string; block: boolean }) {
  let rendered: string;
  try {
    rendered = katex.renderToString(latex, { displayMode: block, throwOnError: false, strict: false, trust: false });
  } catch {
    rendered = escapeHtml(latex);
  }
  const Tag = block ? "div" : "span";
  return <Tag className={block ? "rich-math rich-math--block" : "rich-math"} dangerouslySetInnerHTML={{ __html: rendered }} />;
}

function applyMarks(value: string, node: RichTextNode): ReactNode {
  return (node.marks ?? []).reduce<ReactNode>((content, mark, index) => {
    switch (mark.type) {
      case "bold": return <strong key={index}>{content}</strong>;
      case "italic": return <em key={index}>{content}</em>;
      case "strike": return <s key={index}>{content}</s>;
      case "underline": return <u key={index}>{content}</u>;
      case "code": return <code key={index}>{content}</code>;
      case "link": {
        const href = typeof mark.attrs?.href === "string" && /^(https?:|mailto:)/i.test(mark.attrs.href) ? mark.attrs.href : undefined;
        return href ? <a href={href} target="_blank" rel="noopener noreferrer" key={index}>{content}</a> : content;
      }
      default: return content;
    }
  }, value);
}

function plainText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(plainText).join("");
}

function headingLevel(node: RichTextNode): 1 | 2 | 3 {
  const level = Number(node.attrs?.level);
  return level === 1 || level === 3 ? level : 2;
}

function positiveInteger(value: unknown): number {
  return Math.max(1, Number(value) || 1);
}

function stringAttr(node: RichTextNode, name: string): string {
  return typeof node.attrs?.[name] === "string" ? node.attrs[name] as string : "";
}

function assetUrl(node: RichTextNode): string {
  return `/api/activity-assets/${encodeURIComponent(stringAttr(node, "assetId"))}/file`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
