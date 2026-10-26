// Short-term task memory: important facts that must survive context
// compression (user decisions, discovered locations, failures). Facts come
// from real tool results and from the model's `remember` tool.

export const MAX_FACTS = 30;
const MAX_FACT_CHARS = 300;

export class TaskMemory {
  private facts: string[] = [];

  constructor(initial: string[] = []) {
    for (const f of initial) this.add(f);
  }

  add(fact: string): boolean {
    const text = fact.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_CHARS);
    if (!text) return false;
    const key = text.toLowerCase();
    if (this.facts.some((f) => f.toLowerCase() === key)) return false;
    this.facts.push(text);
    if (this.facts.length > MAX_FACTS) this.facts.splice(0, this.facts.length - MAX_FACTS);
    return true;
  }

  list(): string[] {
    return [...this.facts];
  }

  render(): string {
    return this.facts.length ? this.facts.map((f) => `- ${f}`).join("\n") : "- (nothing recorded yet)";
  }
}
