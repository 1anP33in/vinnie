import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// Monaco needs a real browser; render plain textareas instead.
vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  const Editor = (props: { value?: string; path?: string; onChange?: (v: string) => void }) =>
    React.createElement("textarea", {
      "data-testid": "monaco-editor",
      "aria-label": `Editor for ${props.path ?? "file"}`,
      value: props.value ?? "",
      onChange: (e: { target: { value: string } }) => props.onChange?.(e.target.value),
    });
  const DiffEditor = (props: { original?: string; modified?: string }) =>
    React.createElement(
      "div",
      { "data-testid": "monaco-diff" },
      React.createElement("pre", { "data-testid": "diff-original" }, props.original),
      React.createElement("pre", { "data-testid": "diff-modified" }, props.modified),
    );
  return { default: Editor, Editor, DiffEditor, loader: { config: () => {} } };
});

// jsdom lacks layout; give scroll APIs harmless implementations.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
