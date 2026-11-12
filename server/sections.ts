import type { PinBatchInput, PinDocument, PinSection } from "../shared/pins";

type Upsert = { status: "created" | "updated" | "unchanged"; section: PinSection };
type Remove = { status: "removed"; section: PinSection } | { status: "absent"; key: string };

// Operates only on the candidate document; the caller commits it atomically with pin changes.
export function applySections(document: PinDocument, input: PinBatchInput) {
  const upsert: Upsert[] = [];
  const remove: Remove[] = [];
  for (const section of input.sections?.upsert ?? []) {
    const index = document.sections.findIndex((item) => item.key === section.key);
    const previous = document.sections[index];
    if (!previous) document.sections.push(section);
    else document.sections[index] = section;
    upsert.push({
      status: !previous ? "created" : previous.title === section.title ? "unchanged" : "updated",
      section,
    });
  }
  for (const key of input.sections?.remove ?? []) {
    const section = document.sections.find((item) => item.key === key);
    remove.push(section ? { status: "removed", section } : { status: "absent", key });
    document.sections = document.sections.filter((item) => item.key !== key);
  }
  return { upsert, remove };
}
