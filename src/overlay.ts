import type { Work } from "./fallback";

export function setPlaque(work: Work | null): void {
  const plaque = document.querySelector("#plaque");
  if (!(plaque instanceof HTMLElement)) return;
  if (!work) {
    plaque.classList.remove("show");
    window.setTimeout(() => {
      if (!plaque.classList.contains("show")) plaque.replaceChildren();
    }, 360);
    return;
  }

  const artist = document.createElement("p");
  artist.className = "artist";
  artist.textContent = work.artist || "Unknown";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = work.title || "Untitled";

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [work.date, work.credit].filter(Boolean).join(" · ");

  const license = document.createElement("p");
  license.className = "license";
  license.textContent = work.license === "CC BY" ? `CC BY · ${work.artist}` : work.license;

  plaque.replaceChildren(artist, title, meta, license);
  plaque.classList.add("show");
}
