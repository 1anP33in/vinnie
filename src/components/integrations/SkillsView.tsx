// Skills Manager: installed skills, a simple editor, reference files,
// import/export, and manual activation for this session.

import { BookOpen, Download, FileText, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import type { SkillBundle, SkillMeta, SkillSummary } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { emptySkill, REFERENCE_NAME, slugify, validateSkill, type SkillErrors } from "@/skills/validation";
import { useSkillStore } from "@/state/skillStore";
import { PageHeader, Switch } from "./common";

const inputClass =
  "h-8 w-full rounded-md border border-border bg-bg px-2.5 text-sm outline-none focus:border-accent aria-[invalid=true]:border-danger";

const list = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-[11px] text-faint">{hint}</p>
      )}
    </div>
  );
}

function SessionToggle({ id }: { id: string }) {
  const value = useSkillStore((s) => s.overrides[id] ?? null);
  const setOverride = useSkillStore((s) => s.setOverride);
  const options: { v: "on" | "off" | null; label: string }[] = [
    { v: null, label: "Auto" },
    { v: "on", label: "On" },
    { v: "off", label: "Off" },
  ];
  return (
    <div role="radiogroup" aria-label="Use in this session" className="inline-flex rounded-md border border-border bg-bg p-0.5 text-[11px]">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => setOverride(id, o.v)}
          className={`rounded px-2 py-0.5 ${value === o.v ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function References({ skill }: { skill: SkillSummary }) {
  const [refs, setRefs] = useState(skill.references);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!REFERENCE_NAME.test(name)) {
      setError("Use a plain file name with a text extension, like notes.md.");
      return;
    }
    try {
      await getServices().skills.saveReference(skill.id, name, content);
      setRefs((r) => [...new Set([...r, name])].sort());
      setAdding(false);
      setName("");
      setContent("");
      setError(null);
    } catch (err) {
      setError(describeError(err).detail);
    }
  };

  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Reference files</h4>
      {refs.length === 0 && !adding && <p className="text-xs text-faint">None. Vinnie can read references with read_skill_reference when the skill is active.</p>}
      <ul className="flex flex-col gap-1 text-xs">
        {refs.map((r) => (
          <li key={r} className="flex items-center gap-2">
            <FileText size={12} className="text-muted" />
            <span className="flex-1 font-mono">{r}</span>
            <button
              type="button"
              aria-label={`Delete reference ${r}`}
              className="rounded p-1 text-faint hover:bg-surface-3 hover:text-danger"
              onClick={() =>
                void getServices()
                  .skills.deleteReference(skill.id, r)
                  .then(() => setRefs((x) => x.filter((n) => n !== r)))
                  .catch((err) => setError(describeError(err).detail))
              }
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="mt-2 flex flex-col gap-2">
          <input aria-label="Reference file name" className={`${inputClass} font-mono`} placeholder="notes.md" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea aria-label="Reference content" rows={6} className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void add()}>
              Save reference
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="mt-1" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
          Add reference
        </Button>
      )}
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function SkillEditor({ skill, onDone }: { skill: SkillSummary | null; onDone(id: string | null): void }) {
  const isNew = !skill;
  const save = useSkillStore((s) => s.save);
  const remove = useSkillStore((s) => s.remove);
  const exportSkill = useSkillStore((s) => s.exportSkill);
  const [meta, setMeta] = useState<SkillMeta>(skill ?? emptySkill());
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [errors, setErrors] = useState<SkillErrors>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [text, setText] = useState(() => ({
    tags: (skill?.tags ?? []).join(", "),
    keywords: (skill?.match.keywords ?? []).join(", "),
    languages: (skill?.match.languages ?? []).join(", "),
    projectTypes: (skill?.match.projectTypes ?? []).join(", "),
    tools: (skill?.tools ?? []).join(", "),
  }));

  useEffect(() => {
    if (!skill) return;
    let alive = true;
    void useSkillStore
      .getState()
      .read(skill.id)
      .then((d) => alive && setInstructions(d.instructions))
      .catch((err) => alive && setMessage({ ok: false, text: describeError(err).detail }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [skill]);

  const submit = async () => {
    const next: SkillMeta = {
      ...meta,
      id: isNew ? meta.id || slugify(meta.name) : meta.id,
      tags: list(text.tags),
      match: { keywords: list(text.keywords), languages: list(text.languages), projectTypes: list(text.projectTypes) },
      tools: list(text.tools),
    };
    const v = validateSkill(next, instructions);
    setErrors(v);
    if (Object.values(v).some(Boolean)) return;
    try {
      const saved = await save(next, instructions, isNew);
      setMessage({ ok: true, text: "Skill saved." });
      if (isNew) onDone(saved.id);
    } catch (err) {
      setMessage({ ok: false, text: describeError(err).detail });
    }
  };

  if (loading) return <Spinner />;
  return (
    <div className="flex flex-col gap-4" data-testid="skill-editor">
      <div className="flex items-center gap-2">
        <BookOpen size={16} className="text-accent" />
        <h3 className="flex-1 text-base font-semibold">{isNew ? "Create skill" : meta.name}</h3>
        {skill?.builtin && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">BUILT-IN</span>}
        {!isNew && <SessionToggle id={meta.id} />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" htmlFor="skill-name" error={errors.name}>
          <input id="skill-name" className={inputClass} value={meta.name} aria-invalid={!!errors.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
        </Field>
        <Field label="ID" htmlFor="skill-id" error={errors.id} hint={isNew ? "Leave empty to derive it from the name." : undefined}>
          <input id="skill-id" className={`${inputClass} font-mono`} value={isNew ? meta.id : meta.id} disabled={!isNew} placeholder={slugify(meta.name) || "my-skill"} onChange={(e) => setMeta((m) => ({ ...m, id: e.target.value }))} />
        </Field>
      </div>
      <Field label="Description" htmlFor="skill-desc" error={errors.description}>
        <input id="skill-desc" className={inputClass} value={meta.description} aria-invalid={!!errors.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Version" htmlFor="skill-version" error={errors.version}>
          <input id="skill-version" className={inputClass} value={meta.version} onChange={(e) => setMeta((m) => ({ ...m, version: e.target.value }))} />
        </Field>
        <Field label="Author" htmlFor="skill-author" error={errors.author}>
          <input id="skill-author" className={inputClass} value={meta.author} onChange={(e) => setMeta((m) => ({ ...m, author: e.target.value }))} />
        </Field>
        <Field label="Tags (comma separated)" htmlFor="skill-tags" error={errors.tags}>
          <input id="skill-tags" className={inputClass} value={text.tags} onChange={(e) => setText((t) => ({ ...t, tags: e.target.value }))} placeholder="lua, fivem" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Use when the request mentions" htmlFor="skill-keywords" hint="Keywords, comma separated." error={errors.match}>
          <input id="skill-keywords" className={inputClass} value={text.keywords} onChange={(e) => setText((t) => ({ ...t, keywords: e.target.value }))} placeholder="duty, job, police" />
        </Field>
        <Field label="Or the project uses these languages" htmlFor="skill-langs">
          <input id="skill-langs" className={inputClass} value={text.languages} onChange={(e) => setText((t) => ({ ...t, languages: e.target.value }))} placeholder="Lua, TypeScript" />
        </Field>
        <Field label="Or is one of these project types" htmlFor="skill-types">
          <input id="skill-types" className={inputClass} value={text.projectTypes} onChange={(e) => setText((t) => ({ ...t, projectTypes: e.target.value }))} placeholder="FiveM, Node.js" />
        </Field>
        <Field label="Tool hints (optional)" htmlFor="skill-tools" error={errors.tools} hint="e.g. github.* — only affects which tools are offered, never permissions.">
          <input id="skill-tools" className={`${inputClass} font-mono`} value={text.tools} onChange={(e) => setText((t) => ({ ...t, tools: e.target.value }))} />
        </Field>
      </div>
      <Field label="Instructions" htmlFor="skill-instructions" error={errors.instructions} hint="Markdown. Guidance only: a skill can't grant permissions or change Vinnie's rules.">
        <textarea
          id="skill-instructions"
          rows={12}
          className="rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent aria-[invalid=true]:border-danger"
          aria-invalid={!!errors.instructions}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      {message && (
        <p className={`text-xs ${message.ok ? "text-success" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void submit()}>
          {isNew ? "Create skill" : "Save skill"}
        </Button>
        {!isNew && (
          <>
            <Button
              variant="ghost"
              icon={<Download size={13} />}
              onClick={() =>
                void exportSkill(meta.id)
                  .then((path) => path && setMessage({ ok: true, text: `Exported to ${path}.` }))
                  .catch((err) => setMessage({ ok: false, text: describeError(err).detail }))
              }
            >
              Export
            </Button>
            <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        )}
        {isNew && (
          <Button variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
        )}
      </div>
      {skill && <References key={skill.references.join("|")} skill={skill} />}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${meta.name}?`}
        description={skill?.builtin ? "This built-in skill won't be reinstalled automatically. You can disable it instead to keep it." : "The skill's folder and reference files are deleted. This can't be undone."}
        confirmLabel="Delete skill"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          void remove(meta.id)
            .then(() => onDone(null))
            .catch((err) => setMessage({ ok: false, text: describeError(err).detail }));
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function SkillsView() {
  const skills = useSkillStore((s) => s.skills);
  const status = useSkillStore((s) => s.status);
  const loadError = useSkillStore((s) => s.error);
  const setEnabled = useSkillStore((s) => s.setEnabled);
  const importSkill = useSkillStore((s) => s.importSkill);
  const importBundle = useSkillStore((s) => s.importBundle);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [conflict, setConflict] = useState<SkillBundle | null>(null);
  const current = skills.find((s) => s.id === selected) ?? null;

  useEffect(() => {
    if (status === "idle") void useSkillStore.getState().load();
  }, [status]);

  const doImport = async () => {
    const r = await importSkill();
    if (r.conflict) setConflict(r.conflict);
    else if (r.error) setNotice({ ok: false, text: r.error });
    else if (r.imported) {
      setNotice({ ok: true, text: `Imported ${r.imported.name}. Imported instructions are guidance only; review them before relying on the skill.` });
      setSelected(r.imported.id);
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="skills-view">
      <PageHeader
        title="Skills"
        description="Reusable instructions for kinds of work. Vinnie loads only the skills that fit each request, to keep the context small."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<Upload size={12} />} onClick={() => void doImport()}>
              Import skill
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={12} />}
              onClick={() => {
                setCreating(true);
                setSelected(null);
              }}
            >
              Create skill
            </Button>
          </>
        }
      />
      {(notice || loadError) && (
        <p className={`border-b border-border px-6 py-2 text-xs ${notice?.ok ? "text-success" : "text-warning"}`} role="status">
          {notice?.text ?? loadError}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <ul className="w-72 shrink-0 overflow-y-auto border-r border-border p-2" aria-label="Installed skills">
          {skills.map((s) => (
            <li key={s.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${selected === s.id && !creating ? "bg-surface-3" : "hover:bg-surface-2"}`}>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setSelected(s.id);
                  setCreating(false);
                }}
              >
                <span className={`block truncate text-sm ${s.enabled ? "" : "text-faint"}`}>{s.name}</span>
                <span className={`block truncate text-[11px] ${s.error ? "text-danger" : "text-faint"}`}>{s.error ?? (s.enabled ? "Enabled" : "Disabled")}</span>
              </button>
              <Switch checked={s.enabled} disabled={!!s.error} onChange={(v) => void setEnabled(s.id, v)} label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`} />
            </li>
          ))}
          {status === "ready" && skills.length === 0 && <li className="px-3 py-4 text-xs text-faint">No skills installed.</li>}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {creating ? (
            <SkillEditor
              key="new"
              skill={null}
              onDone={(id) => {
                setCreating(false);
                setSelected(id);
              }}
            />
          ) : current ? (
            current.error ? (
              <div className="text-sm">
                <p className="font-medium text-danger">This skill could not be loaded.</p>
                <p className="mt-1 text-xs text-muted">{current.error}</p>
              </div>
            ) : (
              <SkillEditor key={current.id} skill={current} onDone={(id) => setSelected(id)} />
            )
          ) : (
            <p className="mt-10 text-center text-sm text-muted">Select a skill to view or edit it, or create your own.</p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!conflict}
        title={`Replace ${conflict?.skill.name ?? "skill"}?`}
        description={`A skill with the id ${conflict?.skill.id} is already installed. Importing replaces its instructions and references.`}
        confirmLabel="Replace"
        destructive
        onConfirm={() => {
          const bundle = conflict!;
          setConflict(null);
          void importBundle(bundle, true)
            .then((s) => {
              setNotice({ ok: true, text: `Replaced ${s.name}.` });
              setSelected(s.id);
            })
            .catch((err) => setNotice({ ok: false, text: describeError(err).detail }));
        }}
        onCancel={() => setConflict(null)}
      />
    </div>
  );
}
