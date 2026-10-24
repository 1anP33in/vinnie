import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakes, resetStores } from "@/test/fakes";
import { Markdown } from "./Markdown";

let fakes: ReturnType<typeof installFakes>;

beforeEach(() => {
  resetStores();
  fakes = installFakes();
});

describe("Markdown", () => {
  it("renders headings, lists, tables, and inline code", () => {
    render(
      <Markdown
        content={"# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nUse `cargo build`."}
      />,
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("cargo build").tagName).toBe("CODE");
  });

  it("renders highlighted code blocks with a language label and copy button", async () => {
    const user = userEvent.setup();
    const { container } = render(<Markdown content={"```rust\nfn main() {}\n```"} />);
    expect(screen.getByText("rust")).toBeInTheDocument();
    expect(container.querySelector("code.hljs.language-rust")).not.toBeNull();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("fn");

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(fakes.copied).toEqual(["fn main() {}\n"]);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("does not render raw HTML or scripts from model output", () => {
    const { container } = render(
      <Markdown content={'<script>window.pwned = true</script><img src=x onerror="alert(1)"><b>bold?</b>'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it("strips javascript: links and opens http links externally", async () => {
    const user = userEvent.setup();
    render(<Markdown content={"[bad](javascript:alert(1)) and [docs](https://ollama.com)"} />);
    expect(screen.getByText("bad").closest("a")?.getAttribute("href") ?? "").not.toMatch(/javascript/i);

    await user.click(screen.getByText("docs"));
    expect(fakes.opened).toEqual(["https://ollama.com"]);

    await user.click(screen.getByText("bad"));
    expect(fakes.opened).toEqual(["https://ollama.com"]);
  });

  it("never loads remote images", () => {
    const { container } = render(<Markdown content={"![chart](https://example.com/track.png)"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("[image: chart]")).toBeInTheDocument();
  });
});
