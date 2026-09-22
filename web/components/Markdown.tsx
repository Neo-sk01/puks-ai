"use client";

import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/CopyButton";

/** Flatten a rendered code element back to the plain text it came from. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function languageOf(node: ReactNode): string {
  const element = Array.isArray(node) ? node[0] : node;
  if (!isValidElement<{ className?: string }>(element)) return "";
  return /language-([\w-]+)/.exec(element.props.className ?? "")?.[1] ?? "";
}

/** The corpus is largely SQL procedures, and people paste from these blocks
 *  straight into production tools — hence the copy button and the language
 *  label. The block scrolls sideways inside itself rather than widening the
 *  page. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const language = languageOf(children);
  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl border border-rule bg-bay">
      <div className="flex items-center justify-between border-b border-rule px-3 py-1">
        <span className="font-display text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {language || "code"}
        </span>
        <CopyButton text={textOf(children).replace(/\n$/, "")} label="Copy code" />
      </div>
      <pre className="scroll-thin overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed text-type">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="scroll-thin my-4 overflow-x-auto rounded-xl border border-rule">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

/** Colour and type come from the design tokens (globals.css) rather than the
 *  typography plugin's default palette: the prose-* modifiers below pin body
 *  text, links and rules to --color-type / --color-signal / --color-rule, which
 *  is what lets the same markup follow the light and dark themes. Inline code
 *  is IBM Plex Mono — every table name and column in this corpus is a fixed
 *  field that has to read unambiguously. */
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className="prose max-w-none text-[15px] leading-[1.75] text-type
        prose-headings:font-display prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-type
        prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
        prose-p:text-type prose-strong:font-semibold prose-strong:text-type prose-em:text-type
        prose-li:text-type prose-li:marker:text-muted-foreground prose-ul:text-type prose-ol:text-type
        prose-a:font-medium prose-a:text-signal prose-a:underline prose-a:decoration-signal/30 prose-a:underline-offset-2 hover:prose-a:decoration-signal
        prose-blockquote:border-l-brand prose-blockquote:font-normal prose-blockquote:text-muted-foreground prose-blockquote:not-italic
        prose-hr:border-rule
        prose-code:rounded-md prose-code:bg-bay prose-code:px-1.5 prose-code:py-0.5
        prose-code:font-mono prose-code:text-[13px] prose-code:font-normal prose-code:text-type
        prose-code:before:content-none prose-code:after:content-none
        prose-table:my-0 prose-table:text-[13px]
        prose-thead:border-rule prose-th:bg-bay prose-th:px-3 prose-th:py-2 prose-th:font-medium prose-th:text-muted-foreground
        prose-tr:border-rule prose-td:px-3 prose-td:py-2 prose-td:text-type
        [&>:first-child]:mt-0 [&>:last-child]:mb-0"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
