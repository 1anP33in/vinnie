// Recognize common failures in command output and explain them. The raw
// output is always kept; this only adds a readable summary.

export interface Diagnosis {
  /** One-line cause, e.g. "Cannot find module 'express'". */
  cause: string;
  /** Suggested next step for the user (or the model). */
  suggestion: string;
  /** Packages that appear to be missing, if any. */
  missingPackages: string[];
}

interface Rule {
  pattern: RegExp;
  build(match: RegExpMatchArray): Diagnosis;
}

const RULES: Rule[] = [
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    build: (m) => missing(m[1]!, "Cannot find module", "npm"),
  },
  {
    pattern: /Module not found: (?:Error: )?Can't resolve ['"]([^'"]+)['"]/,
    build: (m) => missing(m[1]!, "Can't resolve", "npm"),
  },
  {
    pattern: /ERR_MODULE_NOT_FOUND[^\n]*?package ['"]([^'"]+)['"]/,
    build: (m) => missing(m[1]!, "Cannot find package", "npm"),
  },
  {
    pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/,
    build: (m) => missing(m[1]!.split(".")[0]!, "No module named", "pip"),
  },
  {
    pattern: /'([^']+)' is not recognized as an internal or external command/,
    build: (m) => ({
      cause: `\`${m[1]}\` is not installed or not on PATH.`,
      suggestion: `Install ${m[1]} (or add it to PATH), then restart Vinnie.`,
      missingPackages: [],
    }),
  },
  {
    pattern: /`([^`]+)` was not found\. Make sure it is installed/,
    build: (m) => ({
      cause: `\`${m[1]}\` is not installed or not on PATH.`,
      suggestion: `Install ${m[1]}, then restart Vinnie so it picks up the new PATH.`,
      missingPackages: [],
    }),
  },
  {
    pattern: /npm (?:ERR!|error) code E404[\s\S]*?(?:404 Not Found[^\n]*?- |'?)([@\w./-]+)/,
    build: (m) => ({
      cause: `The package ${m[1]} was not found in the npm registry.`,
      suggestion: "Check the package name for typos.",
      missingPackages: [],
    }),
  },
  {
    pattern: /EADDRINUSE[^\n]*?:(\d+)/,
    build: (m) => ({
      cause: `Port ${m[1]} is already in use.`,
      suggestion: "Stop the other process using that port, or configure a different port.",
      missingPackages: [],
    }),
  },
  {
    pattern: /error TS\d+:/,
    build: (_m) => ({
      cause: "TypeScript reported type errors.",
      suggestion: "Open the files listed in the output and fix the reported errors.",
      missingPackages: [],
    }),
  },
  {
    pattern: /error\[E\d{4}\]/,
    build: (_m) => ({
      cause: "The Rust compiler reported errors.",
      suggestion: "Read the first error in the output; later errors are often caused by it.",
      missingPackages: [],
    }),
  },
  {
    pattern: /\b(EACCES|EPERM)\b/,
    build: (m) => ({
      cause: `Permission denied (${m[1]}).`,
      suggestion: "A file may be locked by another program (an editor, antivirus, or a running dev server).",
      missingPackages: [],
    }),
  },
  {
    pattern: /(\d+) (?:failed|failing)\b/i,
    build: (m) => ({
      cause: `${m[1]} test${m[1] === "1" ? "" : "s"} failed.`,
      suggestion: "Review the failing tests in the output.",
      missingPackages: [],
    }),
  },
];

function missing(spec: string, prefix: string, manager: "npm" | "pip"): Diagnosis {
  // "./local" or "../x" are project files, not packages.
  if (spec.startsWith(".") || spec.startsWith("/")) {
    return {
      cause: `${prefix} '${spec}'.`,
      suggestion: "Check that the file exists and the import path is correct.",
      missingPackages: [],
    };
  }
  const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
  return {
    cause: `${prefix} '${spec}'.`,
    suggestion:
      manager === "npm"
        ? `Install the missing dependency (for example \`npm install ${pkg}\`), or run the project's install command.`
        : `Install the missing Python package (for example \`pip install ${pkg}\`).`,
    missingPackages: [pkg],
  };
}

/** Explain a failed command's output, or `null` if nothing is recognized. */
export function diagnose(output: string): Diagnosis | null {
  for (const rule of RULES) {
    const match = output.match(rule.pattern);
    if (match) return rule.build(match);
  }
  return null;
}
