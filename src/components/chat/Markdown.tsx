import { memo, useRef, type ComponentProps, type ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { getServices } from "@/services";
import { CopyButton } from "@/components/common/CopyButton";

// Safety: raw HTML in model output is never rendered (no rehype-raw), unsafe
// URL schemes are stripped by react-markdown's default urlTransform, links
// open in the system browser via a validated backend command, and remote
// images are never fetched. Code is displayed, never executed.

const remarkPlugins = [remarkGfm];
const rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [[rehypeHighlight, { detect: false }]];

function isHttpUrl(href: string | undefined): href is string {
  return !!href && /^https?:\/\//i.test(href);
}

function openLink(href: string | undefined) {
  if (isHttpUrl(href)) {
    void getServices()
      .system.openExternalUrl(href)
      .catch(() => {
        /* Invalid or blocked URL: nothing to open. */
      });
  }
}

function languageOf(children: unknown): string | null {
  const child = (Array.isArray(children) ? children[0] : children) as ReactElement<{ className?: string }> | undefined;
  const className = child?.props?.className ?? "";
  return /language-([\w+#.-]+)/.exec(className)?.[1] ?? null;
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const language = languageOf(children);
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-border bg-code">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-xs text-faint">
        <span className="font-mono">{language ?? "text"}</span>
        <CopyButton text={() => preRef.current?.textContent ?? ""} label="Copy code" showLabel />
      </div>
      <pre ref={preRef} className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        openLink(href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => {
    const label = `[image${alt ? `: ${alt}` : ""}]`;
    const href = typeof src === "string" ? src : undefined;
    return isHttpUrl(href) ? (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault();
          openLink(href);
        }}
      >
        {label}
      </a>
    ) : (
      <span className="text-faint">{label}</span>
    );
  },
};

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
