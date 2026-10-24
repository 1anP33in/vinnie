import type { ProjectMetadata } from "@/lib/ipc/types";
import { buildSystemPrompt, extractKeywords, keywordPattern, MAX_ACTIVE_FILE_CHARS } from "./context";

const metadata: ProjectMetadata = {
  name: "mystic-core",
  root: "C:\\Projects\\mystic-core",
  projectTypes: ["FiveM Resource"],
  languages: [
    { name: "Lua", files: 12 },
    { name: "JavaScript", files: 3 },
  ],
  frameworks: [],
  packageManagers: [
    { ecosystem: "node", manager: null, candidates: ["npm", "yarn"], ambiguous: true, reason: "", evidence: [] },
  ],
  configFiles: ["fxmanifest.lua", "config.lua"],
  entryPoints: ["client/main.lua", "server/main.lua"],
  readme: "README.md",
  instructionFiles: ["AGENTS.md"],
  fivem: {
    manifestFile: "fxmanifest.lua",
    fxVersion: "cerulean",
    games: ["gta5"],
    clientScripts: ["client/main.lua"],
    serverScripts: ["server/main.lua"],
    sharedScripts: ["config.lua"],
    uiPage: null,
    files: [],
    dependencies: [],
  },
  git: { isRepo: true, gitAvailable: true, branch: "main", upstream: null, ahead: 0, behind: 0, modified: ["a"], staged: [], untracked: [], deleted: [], truncated: false },
  filesScanned: 20,
  scanTruncated: false,
  analyzedAt: 0,
};

describe("project context", () => {
  it("extracts identifier-like keywords and skips filler words", () => {
    expect(extractKeywords("What files handle the duty system?")).toEqual(["system", "duty"]);
    expect(extractKeywords("Where is RegisterCommand used for handcuffs?")[0]).toBe("RegisterCommand");
    expect(extractKeywords("hi")).toEqual([]);
  });

  it("builds an escaped filename pattern", () => {
    expect(keywordPattern(["duty", "a.b"])).toBe("duty|a\\.b");
    expect(keywordPattern([])).toBeNull();
  });

  it("summarizes the project without dumping it", () => {
    const prompt = buildSystemPrompt(
      {
        projectName: "mystic-core",
        root: "C:\\Projects\\mystic-core",
        metadata,
        tree: "client/\n  main.lua\nserver/\n",
        activeFile: { path: "client/main.lua", content: "x".repeat(MAX_ACTIVE_FILE_CHARS + 500) },
        relevantFiles: ["client/duty.lua"],
      },
      true,
    );
    expect(prompt).toContain("Project: mystic-core");
    expect(prompt).toContain("Type: FiveM Resource");
    expect(prompt).toContain("Languages: Lua (12), JavaScript (3)");
    expect(prompt).toContain("node: unclear (npm/yarn)");
    expect(prompt).toContain("Important files: client/main.lua, server/main.lua, fxmanifest.lua, config.lua");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("Git: branch main, 1 modified");
    expect(prompt).toContain("client/duty.lua");
    expect(prompt).toContain("truncated; use read_file");
    expect(prompt).toContain("search_files");
    expect(prompt.length).toBeLessThan(MAX_ACTIVE_FILE_CHARS + 6_000);
  });

  it("explains when no project is selected and omits tool guidance when tools are off", () => {
    const prompt = buildSystemPrompt(null, false);
    expect(prompt).toContain("No project folder is selected");
    expect(prompt).not.toContain("search_files");
  });
});
