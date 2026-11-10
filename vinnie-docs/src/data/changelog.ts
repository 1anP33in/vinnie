// Single source for the Changelog page and the homepage's "Latest updates".
// Entries follow the repository history. Vinnie has not published tagged
// releases yet; every phase so far ships as version 0.1.0.

export interface ChangelogEntry {
  /** Milestone name. */
  title: string;
  /** Date of the commit that completed it (YYYY-MM-DD). */
  date: string;
  version: string;
  summary: string;
  highlights: string[];
  /** Docs page with details. */
  href: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    title: "Phase 4: MCP integration and skills",
    date: "2026-11-09",
    version: "0.1.0",
    summary: "Connect MCP servers and use skills to extend Vinnie without changing its code.",
    highlights: [
      "MCP servers over stdio and Streamable HTTP, built on the official MCP TypeScript SDK",
      "Per-tool permissions, approval policies, and secrets in Windows Credential Manager",
      "Ten built-in skills, custom skills, and automatic skill selection",
      "MCP Manager, Skills Manager, and Tool Explorer screens",
      "Fix: starting Ollama from Vinnie no longer opens console windows on every model load",
    ],
    href: "mcp/introduction/",
  },
  {
    title: "Phase 3: Autonomous agent engine",
    date: "2026-10-25",
    version: "0.1.0",
    summary: "A controlled agent loop that plans, acts through tools, verifies its work, and reports honestly.",
    highlights: [
      "Agent modes: Ask, Assist, and Agent",
      "Visible, editable plans; pause, resume, and stop",
      "Scoped approvals, error recovery, and independent verification",
      "Task panel, timeline, and debug view",
      "Launch Ollama button",
    ],
    href: "agent-system/how-the-agent-works/",
  },
  {
    title: "Phase 2: Project intelligence and developer tools",
    date: "2026-10-24",
    version: "0.1.0",
    summary: "Work inside a project folder: explore, edit, search, review changes, and run commands.",
    highlights: [
      "Explorer, Monaco editor, and project search",
      "Change history with diffs and revert",
      "Terminal with a command safety policy",
      "Project analysis and dependency installs",
    ],
    href: "user-guide/project-workspaces/",
  },
  {
    title: "Phase 1: Desktop foundation",
    date: "2026-10-23",
    version: "0.1.0",
    summary: "The desktop app: streaming chat with local Ollama models, conversations, and settings.",
    highlights: ["Streaming chat with stop and retry", "Conversations stored in SQLite", "Settings and project selection"],
    href: "user-guide/chat-interface/",
  },
];
