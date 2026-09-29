import type { RegionName } from "./types";

const RULES: { region: RegionName; pattern: RegExp }[] = [
  {
    region: "oceania",
    pattern:
      /\b(oceania|oceanic|maori|papua|hawaii|hawaiian|polynesia|polynesian|australia|australian|fiji|samoa)\b/i,
  },
  {
    region: "americas",
    pattern:
      /\b(american indian|native american|first nations|inuit|navajo|hopi|pueblo|maya|aztec|inca|andes|andean|mexico|mexican|peru|peruvian|brazil|brazilian|canada|canadian|united states|caribbean|haiti|cuba|america|american)\b/i,
  },
  {
    region: "africa",
    pattern:
      /\b(africa|african|egypt|egyptian|bamum|yoruba|benin|congo|mali|ghana|ethiopia|dogon|akan|nigeria|nigerian|cameroon|grassfields|nubia|nubian|morocco|moroccan)\b/i,
  },
  {
    region: "asia",
    pattern:
      /\b(asia|asian|china|chinese|japan|japanese|korea|korean|india|indian|iran|iranian|persia|persian|islamic|islam|arab|arabic|syria|syrian|iraq|iraqi|turkey|turkish|ottoman|thailand|thai|tibet|tibetan|nepal|indonesia|indonesian|vietnam|vietnamese|cambodia|khmer)\b/i,
  },
  {
    region: "europe",
    pattern:
      /\b(europe|european|france|french|paris|italy|italian|rome|roman|venice|florence|spain|spanish|germany|german|netherlands|dutch|holland|belgium|flemish|flanders|england|english|britain|british|london|scotland|scottish|ireland|irish|austria|austrian|poland|polish|portugal|portuguese|greece|greek|sweden|swedish|norway|denmark|switzerland|hungary|czech|russia|russian|ukraine|finland|provence)\b/i,
  },
];

export function classifyRegion(text: string): RegionName {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.region;
  }
  return "unknown";
}

export function combineRegion(prior: RegionName, text: string): RegionName {
  const found = classifyRegion(text);
  return found === "unknown" ? prior : found;
}
