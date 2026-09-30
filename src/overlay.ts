import type { Work } from "./fallback";

/** How long a new label stays open before it folds into the button. */
const OPEN_MS = 4000;
const FADE_MS = 360;

export type Plaque = { set: (work: Work | null) => void };

/**
 * The label opens when a new work comes into view, then folds into a small
 * button in the corner so it does not sit on the picture. Glancing away and
 * back brings the button, not the label. The button, or the I key, opens it
 * again until closed. Only those opens reach `onOpen`.
 */
export function createPlaque(
  root: HTMLElement,
  text: HTMLElement,
  toggle: HTMLButtonElement,
  onOpen?: (work: Work) => void,
): Plaque {
  let current: Work | null = null;
  let lastId: string | null = null;
  let foldTimer = 0;
  let clearTimer = 0;

  const setOpen = (open: boolean) => {
    root.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Hide label" : "Show label");
  };

  const reopen = () => {
    if (!current) return;
    window.clearTimeout(foldTimer);
    const open = !root.classList.contains("open");
    setOpen(open);
    if (open) onOpen?.(current);
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    reopen();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyI" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    reopen();
  });

  return {
    set(work) {
      window.clearTimeout(foldTimer);
      window.clearTimeout(clearTimer);
      current = work;
      if (!work) {
        root.classList.remove("show");
        setOpen(false);
        clearTimer = window.setTimeout(() => text.replaceChildren(), FADE_MS);
        return;
      }
      root.classList.add("show");
      if (work.id === lastId) {
        if (text.childElementCount === 0) text.replaceChildren(...lines(work));
        setOpen(false);
        return;
      }
      lastId = work.id;
      text.replaceChildren(...lines(work));
      setOpen(true);
      foldTimer = window.setTimeout(() => setOpen(false), OPEN_MS);
    },
  };
}

function lines(work: Work): HTMLParagraphElement[] {
  const line = (className: string, content: string) => {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = content;
    return p;
  };
  return [
    line("artist", work.artist || "Unknown"),
    line("title", work.title || "Untitled"),
    line("meta", [work.date, work.credit].filter(Boolean).join(" · ")),
    line(
      "license",
      work.license === "CC BY" || work.license === "CC BY-SA" ? `${work.license} · ${work.artist}` : work.license,
    ),
  ];
}
