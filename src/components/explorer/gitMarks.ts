export interface GitMarks {
  modified: Set<string>;
  untracked: Set<string>;
  /** Folders containing changes. */
  dirty: Set<string>;
}

export function gitMarks(modified: string[], untracked: string[]): GitMarks {
  const dirty = new Set<string>();
  for (const path of [...modified, ...untracked]) {
    const parts = path.replace(/\/$/, "").split("/");
    for (let i = 1; i < parts.length; i++) dirty.add(parts.slice(0, i).join("/"));
  }
  // `git status` reports untracked folders as "dir/".
  const untrackedSet = new Set(untracked.map((p) => p.replace(/\/$/, "")));
  return { modified: new Set(modified), untracked: untrackedSet, dirty };
}
