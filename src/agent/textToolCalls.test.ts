import { describesToolCalls, extractTextToolCalls } from "./textToolCalls";

const tools = new Set(["search_files", "read_file"]);

describe("extractTextToolCalls", () => {
  it("recovers a fenced JSON tool call", () => {
    const content = '```json\n{"name": "search_files", "arguments": {"query": "duty", "mode": "text"}}\n```\n';
    expect(extractTextToolCalls(content, tools)).toEqual([
      { function: { name: "search_files", arguments: { query: "duty", mode: "text" } } },
    ]);
  });

  it("recovers bare JSON and <tool_call> tags", () => {
    expect(extractTextToolCalls('{"name":"read_file","arguments":{"path":"a.lua"}}', tools)).toHaveLength(1);
    const tagged = '<tool_call>\n{"name": "read_file", "arguments": {"path": "a.lua"}}\n</tool_call>\n<tool_call>{"name":"search_files","arguments":{"query":"x"}}</tool_call>';
    expect(extractTextToolCalls(tagged, tools).map((c) => c.function.name)).toEqual(["read_file", "search_files"]);
    const wrongTag = '<tool_response>\n{"name": "read_file", "arguments": {"path":"shared/config.lua"}}\n</tool_response>';
    expect(extractTextToolCalls(wrongTag, tools)[0]?.function.arguments).toEqual({ path: "shared/config.lua" });
    expect(extractTextToolCalls('<tool_call>{"name":"read_file","arguments":{}}</tool_response>', tools)).toEqual([]);
  });

  it("ignores answers that merely contain JSON or unknown tools", () => {
    expect(extractTextToolCalls('Here is the config:\n```json\n{"name": "search_files"}\n```', tools)).toEqual([]);
    expect(extractTextToolCalls('{"name": "delete_everything", "arguments": {}}', tools)).toEqual([]);
    expect(extractTextToolCalls('{"name": "Alice", "age": 3}', tools)).toEqual([]);
    expect(extractTextToolCalls("plain text", tools)).toEqual([]);
    expect(extractTextToolCalls('<tool_call>{"name":"read_file","arguments":{}}</tool_call> and more text', tools)).toEqual([]);
  });

  it("recovers several bare or fenced calls in one reply", () => {
    const content = '{"name": "read_file", "arguments": {"path": "a}.js"}}\n\n```json\n{"name": "search_files", "arguments": {"query": "x"}}\n```';
    expect(extractTextToolCalls(content, tools).map((c) => c.function.name)).toEqual(["read_file", "search_files"]);
    expect(extractTextToolCalls('{"name": "read_file", "arguments": {}} {"name": "nope", "arguments": {}}', tools)).toEqual([]);
  });
});

describe("describesToolCalls", () => {
  it("detects tool calls written inside prose", () => {
    expect(describesToolCalls('Step 1:\n```json\n{"name": "read_file", "arguments": {"path": "a"}}\n```\nDone.', tools)).toBe(true);
    expect(describesToolCalls('First I will call {"name": "search_files", "arguments": {"query": "x"}} then edit.', tools)).toBe(true);
    expect(describesToolCalls('Config: {"name": "Alice"}', tools)).toBe(false);
  });
});
