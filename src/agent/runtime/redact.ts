// Redaction for the task debug view: hide likely secrets in tool arguments
// and results, and shorten large values.

const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|private[_-]?key|webhook)/i;
const SECRET_VALUE = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, // API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /https:\/\/(discord(?:app)?\.com)\/api\/webhooks\/\S+/gi, // Discord webhooks
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /(^|\n)([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*\s*=\s*)\S+/g, // .env lines
];
const MAX_STRING = 2_000;

export function redactText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE) {
    out = out.replace(pattern, (_match, ...groups) => {
      // .env style: keep the key, hide the value.
      if (typeof groups[1] === "string" && /=\s*$/.test(groups[1])) return `${groups[0]}${groups[1]}[redacted]`;
      return "[redacted]";
    });
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}… (${out.length - MAX_STRING} more characters)` : out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  return value;
}
