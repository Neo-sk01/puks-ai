import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The corpus is largely SQL procedures and schema tables, so GFM tables and
 *  fenced code are not optional — and both scroll inside their own container
 *  rather than pushing the page wide.
 *
 *  Colour and type come from the design tokens (globals.css) rather than the
 *  typography plugin's default palette: the prose-* modifiers below pin body text,
 *  links, and rules to --color-type / --color-signal / --color-rule. Code —
 *  inline and fenced — is IBM Plex Mono at 13px per the design direction,
 *  since every code, table name, and SQL block in this corpus is a fixed
 *  field that has to read unambiguously. */
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className="prose max-w-none text-[15px] leading-[1.7] text-type
        prose-headings:font-display prose-headings:font-medium prose-headings:text-type
        prose-p:text-type prose-strong:text-type prose-em:text-type
        prose-li:text-type prose-ul:text-type prose-ol:text-type
        prose-a:text-signal prose-a:no-underline hover:prose-a:underline
        prose-blockquote:border-l-rule prose-blockquote:text-muted-foreground
        prose-hr:border-rule
        prose-code:rounded prose-code:bg-bay prose-code:px-1 prose-code:py-0.5
        prose-code:font-mono prose-code:text-[13px] prose-code:font-normal prose-code:text-type
        prose-code:before:content-none prose-code:after:content-none
        prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border
        prose-pre:border-rule prose-pre:bg-bay prose-pre:font-mono prose-pre:text-[13px]
        prose-table:block prose-table:overflow-x-auto prose-table:font-mono prose-table:text-[13px]
        prose-thead:border-rule prose-th:border-rule prose-th:text-muted-foreground
        prose-td:border-rule prose-td:text-type"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
