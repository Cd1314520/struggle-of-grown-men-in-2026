import { placeOf } from "./location";

const STATES = new Map(
  (
    "Alabama AL|Alaska AK|Arizona AZ|Arkansas AR|California CA|Colorado CO|Connecticut CT|Delaware DE|Florida FL|Georgia GA|Hawaii HI|" +
    "Idaho ID|Illinois IL|Indiana IN|Iowa IA|Kansas KS|Kentucky KY|Louisiana LA|Maine ME|Maryland MD|Massachusetts MA|Michigan MI|" +
    "Minnesota MN|Mississippi MS|Missouri MO|Montana MT|Nebraska NE|Nevada NV|New Hampshire NH|New Jersey NJ|New Mexico NM|New York NY|" +
    "North Carolina NC|North Dakota ND|Ohio OH|Oklahoma OK|Oregon OR|Pennsylvania PA|Rhode Island RI|South Carolina SC|South Dakota SD|" +
    "Tennessee TN|Texas TX|Utah UT|Vermont VT|Virginia VA|Washington WA|West Virginia WV|Wisconsin WI|Wyoming WY|District of Columbia DC"
  )
    .split("|")
    .flatMap(s => {
      const name = s.slice(0, -3),
        code = s.slice(-2);
      return [
        [name.toLowerCase(), { name, code }],
        [code.toLowerCase(), { name, code }],
      ] as const;
    }),
);
const COUNTRY = /^(the )?(united states( of america)?|usa?|u\.s\.(a\.)?|america)$/i;

export type Home = { kind: "city"; name: string } | { kind: "state"; name: string; code: string };

export function homeOf(location: string | null | undefined): Home | null {
  const parts = (location ?? "")
    .split(",")
    .map(p => p.trim())
    .filter(p => p && !COUNTRY.test(p));
  const [first] = parts;
  if (!first) return null;
  const state = parts.length === 1 ? STATES.get(first.toLowerCase()) : undefined;
  if (state) return { kind: "state", ...state };
  if (parts.length === 1 && placeOf(first) === "abroad") return null;
  return { kind: "city", name: first.replace(/\b\w/g, c => c.toUpperCase()) };
}

export function nearHome(home: Home): { label: string; test: (place: string | null, source: string) => boolean } {
  const board = (source: string) => source === "linkedin" || source === "indeed";
  if (home.kind === "city") {
    const city = home.name.toLowerCase();
    return { label: `Near ${home.name}`, test: (place, source) => board(source) || (place ?? "").toLowerCase().includes(city) };
  }
  const named = new RegExp(`\\b${home.name}\\b|, ${home.code}\\b`, "i");
  return { label: `In ${home.name}`, test: (place, source) => board(source) || named.test(place ?? "") };
}
