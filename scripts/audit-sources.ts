/**
 * Runs the same searches a list would, over many seeds, and writes every
 * candidate with the shared gate's verdict to audit/sources.csv for review.
 *
 *   npm run audit            # 20 seeds
 *   npm run audit -- 5       # 5 seeds
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createGetter } from "../worker/http";
import { rejectReason } from "../worker/kind";
import type { Getter, WorkDraft } from "../worker/types";
import { backupSlots, buildSlots, loadSlot, makeRng, type Slot } from "../worker/works";

const runs = Number(process.argv[2] ?? 20);
const apiKey = process.env.SMITHSONIAN_API_KEY ?? devVar("SMITHSONIAN_API_KEY");
const hasKey = apiKey.length > 0;

const COLUMNS = ["seed", "search", "source", "kind", "verdict", "license", "artist", "title", "medium", "date", "credit", "page"];
const rows: string[][] = [];
const tally = new Map<string, { ok: number; rejected: number }>();
const reasons = new Map<string, number>();
const failures = new Map<string, number>();
/** The Met's firewall blocks an address for a while after bursts from one machine; a Worker's requests spread across Cloudflare. */
let metQueue = Promise.resolve();

for (let run = 0; run < runs; run++) {
  const seed = `audit-${run}`;
  const rng = makeRng(`works:${seed}`);
  const slots = [...buildSlots(rng, hasKey), ...backupSlots(rng, hasKey)];
  const lists = await Promise.all(
    slots.map((slot, index) =>
      loadSlot(slot, makeRng(`works:${seed}:${index}`), politeGetter(), apiKey).catch(() => [] as WorkDraft[]),
    ),
  );
  lists.forEach((list, index) => {
    const search = describe(slots[index] as Slot);
    for (const work of list) {
      const reason = rejectReason(work);
      const key = `${work.source} · ${work.kind}`;
      const counts = tally.get(key) ?? { ok: 0, rejected: 0 };
      if (reason) {
        counts.rejected += 1;
        reasons.set(`${work.source}: ${reason}`, (reasons.get(`${work.source}: ${reason}`) ?? 0) + 1);
      } else {
        counts.ok += 1;
      }
      tally.set(key, counts);
      rows.push([
        seed,
        search,
        work.source,
        work.kind,
        reason ?? "ok",
        work.license,
        work.artist,
        work.title,
        work.medium,
        work.date,
        work.credit,
        work.pageUrl,
      ]);
    }
  });
  process.stdout.write(`\rseed ${run + 1}/${runs}, ${rows.length} candidates`);
}

mkdirSync("audit", { recursive: true });
writeFileSync("audit/sources.csv", [COLUMNS, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n");
console.log(`\n\nWrote audit/sources.csv (${rows.length} rows)\n`);
console.table(
  [...tally.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, counts]) => ({ "source · kind": key, ...counts })),
);
if (reasons.size > 0) {
  console.log("\nRejected by the shared gate:");
  console.table([...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })));
}
if (failures.size > 0) {
  console.log("\nFailed requests (a source with many of these is under-represented above):");
  console.table([...failures.entries()].sort((a, b) => b[1] - a[1]).map(([request, count]) => ({ request, count })));
}

function politeGetter(): Getter {
  const get = createGetter(48);
  return async (url) => {
    const host = new URL(url).hostname;
    if (host === "collectionapi.metmuseum.org") {
      const turn = metQueue.then(() => new Promise<void>((resolve) => setTimeout(resolve, 250)));
      metQueue = turn;
      await turn;
    }
    try {
      return await get(url);
    } catch (error) {
      const key = `${host}: ${error instanceof Error ? error.message : String(error)}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
      throw error;
    }
  };
}

function describe(slot: Slot): string {
  switch (slot.kind) {
    case "met":
      return `met ${slot.departmentId} ${slot.classification}`;
    case "artic":
      return `artic ${slot.place}`;
    case "cleveland":
      return `cleveland ${slot.department} ${slot.type} ${slot.after}–${slot.before}`;
    case "smithsonian":
      return `smithsonian ${slot.unit}`;
    case "openverse":
      return `openverse ${slot.query}`;
    case "smk":
      return `smk ${slot.smk}`;
    case "wellcome":
      return `wellcome ${slot.query}`;
    case "commons":
      return `commons ${slot.room.search}`;
  }
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function devVar(name: string): string {
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : "";
  } catch {
    return "";
  }
}
