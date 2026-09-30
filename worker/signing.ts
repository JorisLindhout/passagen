import type { WorkDraft } from "./types";

/** What an image path carries: enough to fetch the picture without storing anything. */
export type SignedImage = { imageUrl: string; thumbHost: string | null; source: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keys = new Map<string, Promise<CryptoKey>>();
/** The Art Institute's CDN refuses requests from Workers but lets any page load its IIIF images. */
const DIRECT_HOSTS = new Set(["www.artic.edu"]);

/** What the browser loads: the museum's own URL for a direct host, otherwise a path this Worker signed. */
export async function imageSource(secret: string, work: WorkDraft): Promise<string> {
  if (DIRECT_HOSTS.has(new URL(work.imageUrl).hostname)) return work.imageUrl;
  return imagePath(secret, work);
}

/** `/api/image/<id>/<payload>/<signature>`; the id alone names the picture in the cache. */
async function imagePath(secret: string, work: WorkDraft): Promise<string> {
  const payload = toBase64Url(encoder.encode([work.source, work.thumbHost ?? "", work.imageUrl].join("\n")));
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(`${work.id}/${payload}`));
  return `/api/image/${work.id}/${payload}/${toBase64Url(new Uint8Array(signature))}`;
}

/** The picture a path names, or null when this Worker did not sign it. */
export async function readImagePath(
  secret: string,
  id: string,
  payload: string,
  signature: string,
): Promise<SignedImage | null> {
  const mac = fromBase64Url(signature);
  const bytes = fromBase64Url(payload);
  if (!mac || !bytes) return null;
  const valid = await crypto.subtle.verify("HMAC", await keyFor(secret), mac, encoder.encode(`${id}/${payload}`));
  if (!valid) return null;
  const [source = "", thumbHost = "", imageUrl = ""] = decoder.decode(bytes).split("\n");
  return { imageUrl, thumbHost: thumbHost || null, source };
}

function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keys.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
