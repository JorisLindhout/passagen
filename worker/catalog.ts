import type { MetClassification } from "./sources/met";
import type { RegionName } from "./types";

/** Classifications with at least a few dozen public-domain works in the department. */
export const MET_DEPARTMENTS: {
  id: number;
  name: string;
  region: RegionName;
  classifications: MetClassification[];
}[] = [
  { id: 11, name: "European Paintings", region: "europe", classifications: ["Paintings"] },
  { id: 6, name: "Asian Art", region: "asia", classifications: ["Paintings", "Prints"] },
  { id: 10, name: "Egyptian Art", region: "africa", classifications: ["Paintings", "Drawings"] },
  { id: 14, name: "Islamic Art", region: "asia", classifications: ["Paintings"] },
  {
    id: 5,
    name: "Arts of Africa, Oceania, and the Americas",
    region: "unknown",
    classifications: ["Paintings", "Photographs", "Drawings", "Prints"],
  },
  { id: 19, name: "Photographs", region: "unknown", classifications: ["Photographs"] },
  { id: 1, name: "The American Wing", region: "americas", classifications: ["Paintings", "Drawings"] },
  {
    id: 21,
    name: "Modern and Contemporary Art",
    region: "unknown",
    classifications: ["Paintings", "Drawings", "Prints", "Photographs"],
  },
  { id: 9, name: "Drawings and Prints", region: "unknown", classifications: ["Drawings", "Prints", "Photographs"] },
  { id: 13, name: "Greek and Roman Art", region: "europe", classifications: ["Paintings"] },
];

export const PLACES: { place: string; region: RegionName }[] = [
  { place: "China", region: "asia" },
  { place: "Japan", region: "asia" },
  { place: "France", region: "europe" },
  { place: "Italy", region: "europe" },
  { place: "Netherlands", region: "europe" },
  { place: "India", region: "asia" },
  { place: "Mexico", region: "americas" },
  { place: "Egypt", region: "africa" },
  { place: "Iran", region: "asia" },
  { place: "United States", region: "americas" },
  { place: "Korea", region: "asia" },
  { place: "Germany", region: "europe" },
  { place: "Nigeria", region: "africa" },
  { place: "Peru", region: "americas" },
];

export const CLEVELAND: { name: string; region: RegionName }[] = [
  { name: "European Painting and Sculpture", region: "europe" },
  { name: "Modern European Painting and Sculpture", region: "europe" },
  { name: "Chinese Art", region: "asia" },
  { name: "Japanese Art", region: "asia" },
  { name: "Korean Art", region: "asia" },
  { name: "Indian and South East Asian Art", region: "asia" },
  { name: "Islamic Art", region: "asia" },
  { name: "African Art", region: "africa" },
  { name: "Egyptian and Ancient Near Eastern Art", region: "africa" },
  { name: "Art of the Americas", region: "americas" },
  { name: "American Painting and Sculpture", region: "americas" },
  { name: "Oceania", region: "oceania" },
  { name: "Prints", region: "unknown" },
  { name: "Drawings", region: "unknown" },
  { name: "Photography", region: "unknown" },
];

export const WINDOWS = [
  { after: -2000, before: 600 },
  { after: 600, before: 1400 },
  { after: 1400, before: 1700 },
  { after: 1700, before: 1850 },
  { after: 1850, before: 1950 },
  { after: 1950, before: 2020 },
];

/** The American Indian museum shares no CC0 images and Cooper Hewitt gives no dimensions, so neither can fill a frame. */
export const SMITHSONIAN: { code: string; name: string; region: RegionName }[] = [
  { code: "SAAM", name: "Smithsonian American Art Museum", region: "americas" },
  { code: "NMAfA", name: "National Museum of African Art", region: "africa" },
  { code: "NMAA", name: "National Museum of Asian Art", region: "asia" },
];

export function windowLabel(window: { after: number; before: number }): string {
  const year = (value: number) => (value < 0 ? `${-value} BCE` : String(value));
  return `${year(window.after)} to ${year(window.before)}`;
}
