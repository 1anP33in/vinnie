import { diagnose } from "./diagnose";

describe("diagnose", () => {
  it("recognizes missing npm modules", () => {
    const d = diagnose("node:internal/modules/cjs/loader:1228\n  throw err;\nError: Cannot find module 'express'\nRequire stack:");
    expect(d?.cause).toBe("Cannot find module 'express'.");
    expect(d?.missingPackages).toEqual(["express"]);
    expect(d?.suggestion).toMatch(/npm install express/);
  });

  it("handles scoped packages and deep imports", () => {
    expect(diagnose("Module not found: Error: Can't resolve '@mui/material/Button'")?.missingPackages).toEqual([
      "@mui/material",
    ]);
  });

  it("does not treat relative imports as packages", () => {
    const d = diagnose("Error: Cannot find module './config'");
    expect(d?.missingPackages).toEqual([]);
    expect(d?.suggestion).toMatch(/import path/);
  });

  it("recognizes Python, PATH, port, and TypeScript failures", () => {
    expect(diagnose("ModuleNotFoundError: No module named 'requests.adapters'")?.missingPackages).toEqual(["requests"]);
    expect(diagnose("'pnpm' is not recognized as an internal or external command")?.cause).toMatch(/pnpm/);
    expect(diagnose("Error: listen EADDRINUSE: address already in use :::3000")?.cause).toBe("Port 3000 is already in use.");
    expect(diagnose("src/a.ts(3,1): error TS2304: Cannot find name 'x'.")?.cause).toMatch(/TypeScript/);
  });

  it("returns null for unknown output", () => {
    expect(diagnose("everything is fine")).toBeNull();
  });
});
