import { createHash } from "node:crypto";
import type { Pin, PinDocument } from "../shared/pins";
import {
  type RefreshApply,
  type RefreshReport,
  refreshApplySchema,
  refreshReportSchema,
} from "../shared/refresh";
import type { RefreshRun } from "../shared/refresh-state";
import type { PinStore } from "./store";
import type { TurnIdentity } from "./summary-records";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function pinRevision(pin: Pin) {
  const { readAttentionToken: _read, updatedAt: _updated, ...resource } = pin;
  return hash(resource);
}
export function sectionRevision(document: PinDocument, key: string) {
  return hash([
    document.sections.find((s) => s.key === key),
    document.pins
      .filter((p) => p.section === key)
      .map((p) => [p.key, p.instanceId])
      .sort(),
  ]);
}
export function activeRun(document: PinDocument, agentId: string, now = Date.now()): RefreshRun {
  const run = document.refresh;
  if (
    !run ||
    run.agentId !== agentId ||
    run.outcome ||
    !["starting", "running"].includes(run.state) ||
    Date.parse(run.deadline) <= now
  )
    throw new Error("This refresh is no longer active.");
  return run;
}
export function scopedSnapshot(document: PinDocument, run: RefreshRun) {
  return {
    mode: run.mode ?? (run.initialCount === 0 ? "discovery" : "maintenance"),
    discoveryVersion: run.discoveryVersion,
    pins: document.pins.map((pin) => ({
      ...pin,
      revision: pinRevision(pin),
      editable: run.scope[pin.key] === pin.instanceId,
    })),
    sections: document.sections.map((section) => ({
      ...section,
      revision: sectionRevision(document, section.key),
      editable: run.sectionKeys.includes(section.key),
    })),
  };
}
function eligible(document: PinDocument, run: RefreshRun, key: string, revision: string) {
  const pin = document.pins.find((p) => p.key === key);
  if (!pin || run.scope[key] !== pin.instanceId || pinRevision(pin) !== revision)
    throw new Error(`Pin ${key} changed or is outside this refresh. Read the list again.`);
  return pin;
}
function checkSection(
  document: PinDocument,
  run: RefreshRun,
  key: string,
  revision: string | undefined,
) {
  if (
    !run.sectionKeys.includes(key) ||
    !document.sections.some((s) => s.key === key) ||
    !revision ||
    sectionRevision(document, key) !== revision
  )
    throw new Error(`Section ${key} changed. Read the list again.`);
}
function replay(run: RefreshRun, id: string, input: unknown) {
  const saved = run.receipts[id];
  if (saved && saved.hash !== hash(input))
    throw new Error("Operation ID already used with different input.");
  if (!saved && Object.keys(run.receipts).length >= 200)
    throw new Error("Refresh operation limit reached.");
  return saved;
}
function evidence(run: RefreshRun, sources: string[]) {
  if (
    !sources.length ||
    sources.some(
      (source) =>
        !run.sources.some((entry) => entry.id === source && entry.inspected) &&
        !run.repositoryGaps.some((gap) => source === `repository:${gap}`),
    )
  )
    throw new Error(
      "New pins require a supplied conversation source or a reported repository context gap.",
    );
}
export function applyRefresh(
  store: PinStore,
  workspaceId: string,
  agentId: string,
  input: RefreshApply,
  turn: TurnIdentity,
  signal?: AbortSignal,
) {
  const value = refreshApplySchema.parse(input);
  return store.transaction(
    workspaceId,
    (document, apply) => {
      const run = activeRun(document, agentId);
      const previous = replay(run, value.operationId, value);
      if (previous) return previous.result;
      const beforeSections = document.sections.map((section) => ({ ...section }));
      const before = document.pins.map((pin) => ({ ...pin }));
      const newSections = new Set<string>();
      for (const section of value.sections?.upsert ?? []) {
        if (section.expectedRevision === null) {
          if (document.sections.some((s) => s.key === section.key))
            throw new Error("Section already exists. Reread before changing it.");
          newSections.add(section.key);
        } else checkSection(document, run, section.key, section.expectedRevision);
      }
      for (const section of value.sections?.remove ?? []) {
        checkSection(document, run, section.key, section.expectedRevision);
        for (const pin of document.pins.filter((p) => p.section === section.key)) {
          eligible(document, run, pin.key, value.memberRevisions[pin.key] ?? "");
        }
      }
      const destinations = new Set(document.pins.map((p) => new URL(p.url).href));
      for (const item of value.upsert ?? []) {
        if (item.expectedRevision === null) {
          if (
            document.pins.some((p) => p.key === item.key) ||
            run.removedKeys.includes(item.key) ||
            destinations.has(new URL(item.url).href)
          )
            throw new Error(
              "Pin key or destination already exists, or was removed in this run. Reread and deduplicate.",
            );
          evidence(run, item.sources);
          destinations.add(new URL(item.url).href);
        } else eligible(document, run, item.key, item.expectedRevision);
        if (item.section && !newSections.has(item.section))
          checkSection(document, run, item.section, value.sectionRevisions[item.section]);
      }
      for (const item of value.remove ?? [])
        eligible(document, run, item.key, item.expectedRevision);
      const result = apply(
        {
          upsert: value.upsert?.map(
            ({ expectedRevision: _revision, reason: _reason, sources: _sources, ...pin }) => pin,
          ),
          remove: value.remove?.map((item) => item.key),
          sections: value.sections && {
            upsert: value.sections.upsert?.map(({ key, title }) => ({ key, title })),
            remove: value.sections.remove?.map((s) => s.key),
          },
        },
        turn,
      );
      for (const pin of document.pins) {
        const old = before.find((p) => p.instanceId === pin.instanceId);
        if (old && pinRevision(old) === pinRevision(pin)) continue;
        if (!old) {
          run.scope[pin.key] = pin.instanceId;
          run.created.push(pin.instanceId);
        }
        const item = value.upsert?.find((p) => p.key === pin.key);
        const sectionRemoval = value.sections?.remove?.find((s) => old?.section === s.key);
        const change = {
          kind: run.created.includes(pin.instanceId) ? ("added" as const) : ("updated" as const),
          key: pin.key,
          instanceId: pin.instanceId,
          title: pin.title,
          reason: item?.reason ?? sectionRemoval?.reason ?? "Section updated.",
          sources: item?.sources.length
            ? item.sources
            : (run.changes.find((change) => change.instanceId === pin.instanceId)?.sources ?? []),
        };
        run.changes = run.changes.filter((c) => c.instanceId !== pin.instanceId);
        run.changes.push(change);
        run.assessments[pin.instanceId] = {
          revision: pinRevision(pin),
          status: "reviewed",
          reason: change.reason,
        };
      }
      for (const removal of result.remove) {
        if (removal.status !== "removed") continue;
        const pin = removal.pin;
        run.changes = run.changes.filter((c) => c.instanceId !== pin.instanceId);
        if (!run.created.includes(pin.instanceId))
          run.changes.push({
            kind: "removed",
            key: pin.key,
            instanceId: pin.instanceId,
            title: pin.title,
            reason: value.remove?.find((p) => p.key === pin.key)?.reason ?? "Obsolete resource.",
            sources: [],
          });
        run.removedKeys.push(pin.key);
      }
      for (const entry of [...(value.sections?.upsert ?? []), ...(value.sections?.remove ?? [])]) {
        if (newSections.has(entry.key)) run.sectionKeys.push(entry.key);
        const old = beforeSections.find((s) => s.key === entry.key);
        const current = document.sections.find((s) => s.key === entry.key);
        if (JSON.stringify(old) === JSON.stringify(current)) continue;
        run.changes = run.changes.filter((c) => !(c.kind === "section" && c.key === entry.key));
        run.changes.push({
          kind: "section",
          key: entry.key,
          title: "title" in entry ? entry.title : entry.key,
          reason: entry.reason,
          sources: [],
        });
      }
      run.revision++;
      const output = { status: "applied", ...scopedSnapshot(document, run) };
      run.receipts[value.operationId] = {
        hash: hash(value),
        result: JSON.parse(JSON.stringify(output)),
      };
      return output;
    },
    signal,
  );
}
export function reportRefresh(
  store: PinStore,
  workspaceId: string,
  agentId: string,
  input: RefreshReport,
  signal?: AbortSignal,
) {
  const value = refreshReportSchema.parse(input);
  return store.transaction(
    workspaceId,
    (document) => {
      const run = activeRun(document, agentId);
      const previous = replay(run, value.operationId, value);
      if (previous) return previous.result;
      for (const id of value.discovery.reviewedSources)
        if (!run.sources.some((s) => s.id === id && s.inspected))
          throw new Error("Unknown or unread conversation source.");
      const priorities = value.discovery.priorities;
      if (
        run.discoveryVersion === 2 &&
        value.discovery.complete &&
        (priorities === undefined || (!priorities.length && !value.discovery.noActiveWorkReason))
      )
        throw new Error("Account for active work priorities, or explain why none were identified.");
      if (priorities !== undefined) {
        const ids = new Set<string>();
        for (const priority of priorities) {
          if (ids.has(priority.id)) throw new Error("Duplicate work priority.");
          ids.add(priority.id);
          if (
            priority.sources.some(
              (id) =>
                !run.sources.some((s) => s.id === id && s.inspected) &&
                ![...run.repositoryGaps, ...value.discovery.repositoryGaps].some(
                  (gap) => id === `repository:${gap}`,
                ),
            )
          )
            throw new Error(
              "Priority evidence must reference inspected sources or reported repository gaps.",
            );
          if (
            priority.pins.some(
              (ref) =>
                !document.pins.some((p) => p.key === ref.key && p.instanceId === ref.instanceId),
            )
          )
            throw new Error("Priority references an unavailable or replaced pin.");
          const hasDestination = priority.outcome === "selected" || priority.outcome === "covered";
          if (hasDestination && (!priority.pins.length || !priority.sources.length))
            throw new Error("Selected or covered work requires a pin and evidence.");
          if (!hasDestination && priority.pins.length)
            throw new Error("Unresolved/no-destination work cannot claim pin coverage.");
          if (
            priority.outcome === "no_destination" &&
            (!priority.investigation || !priority.sources.length)
          )
            throw new Error(
              "Explain the investigation and evidence before concluding no useful destination was found.",
            );
          if (priority.outcome === "unresolved" && value.discovery.complete)
            throw new Error("Unresolved priorities cannot declare discovery complete.");
        }
        run.priorities = priorities;
        run.priorityReportRecorded =
          priorities.length > 0 || Boolean(value.discovery.noActiveWorkReason);
        run.noActiveWorkReason = value.discovery.noActiveWorkReason ?? null;
      }
      const seen = new Set<string>();
      for (const item of [...value.reviewed, ...value.unverified]) {
        if (seen.has(item.key)) throw new Error("Duplicate assessment.");
        seen.add(item.key);
        const pin = eligible(document, run, item.key, item.revision);
        run.assessments[pin.instanceId] = {
          revision: item.revision,
          status: "reason" in item ? "unverified" : "reviewed",
          reason: "reason" in item ? String(item.reason) : "Reviewed.",
        };
      }
      run.discoveryComplete = value.discovery.complete;
      run.reviewedSources = [
        ...new Set([...run.reviewedSources, ...value.discovery.reviewedSources]),
      ];
      run.repositoryGaps = [...new Set([...run.repositoryGaps, ...value.discovery.repositoryGaps])];
      run.receipts[value.operationId] = { hash: hash(value), result: { status: "recorded" } };
      return { status: "recorded" };
    },
    signal,
  );
}
