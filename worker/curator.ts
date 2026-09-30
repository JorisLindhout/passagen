import { CLEVELAND, MET_DEPARTMENTS, PLACES, SMITHSONIAN, WINDOWS, windowLabel } from "./catalog";
import { CLEVELAND_TYPES } from "./sources/cleveland";
import { COMMONS_ROOMS, COMMONS_WIDE, type CommonsRoom } from "./sources/commons";
import type { MetClassification } from "./sources/met";
import { SMK_KINDS, type SmkKind } from "./sources/smk";
import { asRecord, cleanText, type TasteSummary, type TasteWork } from "./types";
import type { Slot } from "./works";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/**
 * Past this the maze goes out with random searches. The 70B model answers in
 * about 3.5 s and the 8B in 7 to 10 s; a maze is asked for two mazes ahead,
 * so only a returning visitor's first maze waits on it.
 */
const CURATOR_MS = 10_000;
const MAX_TOKENS = 500;
const MET_CLASSIFICATIONS: MetClassification[] = ["Paintings", "Drawings", "Prints", "Photographs"];
/** Wellcome pages with a curator's words run out sooner than its own broad searches. */
const CURATED_WELLCOME_PAGES = 2;

const SYSTEM = [
  "You curate an endless museum of public-domain art, one maze of rooms at a time.",
  "From the works a visitor lingered on and the ones they walked past, choose the searches for their next maze.",
  "Follow their taste, but vary it within that taste: other artists, neighbouring cultures and periods, related techniques and subjects.",
  "Do not use the same search twice. Free-text searches are one to three plain words, such as a subject, a technique, or a place.",
  "Answer with JSON only.",
].join(" ");

type Field = {
  describe: string;
  schema: Record<string, unknown>;
  read: (value: Record<string, unknown>) => Slot | null;
};

type Runner = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };

/** Models that refused a JSON schema; they get the shape in the prompt instead, and every answer is checked anyway. */
const withoutSchema = new Set<string>();

/**
 * Parameters for the slots at `positions` in the template, chosen from the
 * visitor's taste; the same kind of search stays in each position, so the
 * source mix does not move. A position the model leaves out or fills with
 * something off the lists comes back null and keeps its random search.
 */
export async function curate(
  env: Env,
  taste: TasteSummary,
  template: Slot[],
  positions: number[],
): Promise<(Slot | null)[]> {
  const none = template.map(() => null);
  if (env.CURATOR === "off" || positions.length === 0) return none;
  const model = /^@(cf|hf)\//.test(env.CURATOR_MODEL ?? "") ? env.CURATOR_MODEL : DEFAULT_MODEL;
  const fields = new Map<string, { index: number; field: Field }>();
  positions.forEach((index, order) => {
    const slot = template[index];
    if (slot) fields.set(`s${order + 1}`, { index, field: fieldFor(slot) });
  });

  const properties: Record<string, unknown> = {};
  const lines: string[] = [];
  const shape: Record<string, Record<string, string>> = {};
  for (const [key, { field }] of fields) {
    properties[key] = field.schema;
    lines.push(`${key} ${field.describe}`);
    shape[key] = Object.fromEntries(Object.keys(field.schema.properties as object).map((name) => [name, "..."]));
  }
  const prompt = [
    describeTaste(taste),
    "",
    "Choose for each slot:",
    ...lines,
    "",
    `Reply with one JSON object shaped like ${JSON.stringify(shape)}, using only the listed values where a list is given.`,
  ].join("\n");
  const started = Date.now();
  const runner = env.AI as unknown as Runner;
  const ask = async (): Promise<unknown> => {
    const input: Record<string, unknown> = {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.8,
    };
    if (withoutSchema.has(model)) return runner.run(model, input);
    try {
      return await runner.run(model, {
        ...input,
        response_format: {
          type: "json_schema",
          json_schema: { type: "object", properties, required: [...fields.keys()] },
        },
      });
    } catch (failure) {
      if (!(failure instanceof Error) || !/json schema/i.test(failure.message)) throw failure;
      withoutSchema.add(model);
      return runner.run(model, input);
    }
  };

  try {
    const answer = await Promise.race([
      ask(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CURATOR_MS)),
    ]);
    if (answer === null) {
      log({ message: "curator timed out", model, ms: Date.now() - started });
      return none;
    }
    const record = asRecord(answer);
    const chosen = readResponse(record?.response);
    const usage = asRecord(record?.usage);
    const slots: (Slot | null)[] = none.slice();
    const picks: Record<string, unknown> = {};
    for (const [key, { index, field }] of fields) {
      const value = asRecord(chosen?.[key]);
      const slot = value ? field.read(value) : null;
      slots[index] = slot;
      picks[key] = slot ?? "invalid";
    }
    log({
      message: "curator",
      model,
      ms: Date.now() - started,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      picks,
    });
    return slots;
  } catch (failure) {
    log({
      message: "curator failed",
      model,
      ms: Date.now() - started,
      error: failure instanceof Error ? failure.message.slice(0, 180) : String(failure),
    });
    return none;
  }
}

function fieldFor(slot: Slot): Field {
  switch (slot.kind) {
    case "met": {
      const names = MET_DEPARTMENTS.map((department) => department.name);
      return {
        describe: `Met: department (${names.join(" | ")}), classification (${MET_CLASSIFICATIONS.join(" | ")}; not every department holds every one), search (free text)`,
        schema: object({ department: choice(names), classification: choice(MET_CLASSIFICATIONS), search: words() }),
        read(value) {
          const department = MET_DEPARTMENTS.find((item) => item.name === value.department);
          if (!department) return null;
          const asked = MET_CLASSIFICATIONS.find((item) => item === value.classification);
          const classification =
            asked && department.classifications.includes(asked) ? asked : department.classifications[0];
          if (!classification) return null;
          return {
            kind: "met",
            departmentId: department.id,
            classification,
            region: department.region,
            q: searchText(value.search) ?? undefined,
          };
        },
      };
    }
    case "artic": {
      const places = PLACES.map((item) => item.place);
      return {
        describe: `Art Institute of Chicago: place of origin (${places.join(" | ")})`,
        schema: object({ place: choice(places) }),
        read(value) {
          const place = PLACES.find((item) => item.place === value.place);
          return place ? { kind: "artic", place: place.place, region: place.region } : null;
        },
      };
    }
    case "cleveland": {
      const names = CLEVELAND.map((item) => item.name);
      const periods = WINDOWS.map(windowLabel);
      return {
        describe: `Cleveland Museum of Art: department (${names.join(" | ")}), type (${CLEVELAND_TYPES.join(" | ")}), period (${periods.join(" | ")})`,
        schema: object({ department: choice(names), type: choice(CLEVELAND_TYPES), period: choice(periods) }),
        read(value) {
          const department = CLEVELAND.find((item) => item.name === value.department);
          const type = CLEVELAND_TYPES.find((item) => item === value.type);
          const window = WINDOWS.find((item) => windowLabel(item) === value.period);
          if (!department || !type || !window) return null;
          return {
            kind: "cleveland",
            department: department.name,
            region: department.region,
            after: window.after,
            before: window.before,
            type,
          };
        },
      };
    }
    case "smithsonian": {
      const names = SMITHSONIAN.map((item) => item.name);
      return {
        describe: `Smithsonian: museum (${names.join(" | ")})`,
        schema: object({ museum: choice(names) }),
        read(value) {
          const unit = SMITHSONIAN.find((item) => item.name === value.museum);
          return unit ? { kind: "smithsonian", unit: unit.code, region: unit.region } : null;
        },
      };
    }
    case "openverse":
      return {
        describe: "Openverse (Rijksmuseum, Brooklyn Museum, New York Public Library and others): search (free text)",
        schema: object({ search: words() }),
        read(value) {
          const query = searchText(value.search);
          return query ? { kind: "openverse", query } : null;
        },
      };
    case "smk":
      return {
        describe: `National Gallery of Denmark: kind (${SMK_KINDS.join(" | ")})`,
        schema: object({ kind: choice(SMK_KINDS) }),
        read(value) {
          const kind = SMK_KINDS.find((item): item is SmkKind => item === value.kind);
          return kind ? { kind: "smk", smk: kind } : null;
        },
      };
    case "wellcome":
      return {
        describe: "Wellcome Collection (paintings, prints and drawings from around the world): search (free text)",
        schema: object({ search: words() }),
        read(value) {
          const query = searchText(value.search);
          return query ? { kind: "wellcome", query, region: "unknown", pages: CURATED_WELLCOME_PAGES } : null;
        },
      };
    case "commons": {
      const rooms = COMMONS_WIDE.includes(slot.room) ? COMMONS_WIDE : COMMONS_ROOMS;
      const labels = rooms.map(roomLabel);
      return {
        describe: `Wikimedia Commons: room (${labels.join(" | ")})`,
        schema: object({ room: choice(labels) }),
        read(value) {
          const room = rooms.find((item) => roomLabel(item) === value.room);
          return room ? { kind: "commons", room } : null;
        },
      };
    }
  }
}

function describeTaste(taste: TasteSummary): string {
  const lines = ["Lingered on:"];
  for (const work of taste.liked) lines.push(`- ${describeWork(work, true)}`);
  if (taste.liked.length === 0) lines.push("- nothing yet");
  if (taste.disliked.length > 0) {
    lines.push("Walked past quickly:");
    for (const work of taste.disliked) lines.push(`- ${describeWork(work, false)}`);
  }
  if (taste.favoriteArtists.length > 0) lines.push(`Favourite artists: ${taste.favoriteArtists.join(", ")}`);
  return lines.join("\n");
}

function describeWork(work: TasteWork, liked: boolean): string {
  const signals = liked
    ? [`${work.seconds}s`, work.plaque ? "read the label" : "", work.revisits > 0 ? `came back ${work.revisits}x` : ""]
    : [];
  const about = [
    `"${work.title || "Untitled"}"`,
    work.artist && !/^unknown$/i.test(work.artist) ? `by ${work.artist}` : "",
    work.date,
    work.culture,
    work.medium,
    [work.kind, work.region !== "unknown" ? work.region : ""].filter(Boolean).join(", "),
  ];
  return [...signals, ...about].filter(Boolean).join("; ");
}

function roomLabel(room: CommonsRoom): string {
  return `${room.museum || "Wikimedia Commons"}: ${room.kind}s`;
}

/** Schema mode answers with an object; a model without it writes text, maybe with words around the JSON. */
function readResponse(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return asRecord(value);
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(value.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function searchText(value: unknown): string | null {
  const text = cleanText(value, 40)
    .replace(/[^\p{L}\p{N} '-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function object(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties) };
}

function choice(values: readonly string[]): Record<string, unknown> {
  return { type: "string", enum: values };
}

function words(): Record<string, unknown> {
  return { type: "string", maxLength: 40 };
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}
