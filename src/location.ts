// Whether a listing's location is in the United States. Pure text matching on what job boards write
// ("Tysons, Virginia", "London, United Kingdom", "Hub - Porto"); "unknown" when nothing in it says.

const STATES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia";
const STATE_CODES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
// Cities that boards often give with no state after them.
const US_CITIES =
  "San Francisco|Bay Area|Silicon Valley|Palo Alto|Mountain View|Sunnyvale|San Jose|Los Angeles|San Diego|Seattle|Bellevue|Portland|Denver|Boulder|Austin|Houston|Dallas|Chicago|Boston|Atlanta|Miami|Philadelphia|Pittsburgh|Detroit|Ann Arbor|Minneapolis|Phoenix|Salt Lake City|Nashville|Raleigh|Charlotte|NYC|New York City|Brooklyn";
const COUNTRIES =
  "United Kingdom|UK|England|Scotland|Wales|Ireland|Canada|Mexico|Brazil|Argentina|Chile|Colombia|Peru|Germany|France|Spain|Portugal|Italy|Netherlands|Belgium|Luxembourg|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Iceland|Poland|Czechia|Czech Republic|Slovakia|Hungary|Romania|Bulgaria|Greece|Serbia|Croatia|Slovenia|Estonia|Latvia|Lithuania|Ukraine|Turkey|Israel|Egypt|Nigeria|Kenya|South Africa|United Arab Emirates|UAE|Saudi Arabia|Qatar|India|Pakistan|Bangladesh|Sri Lanka|China|Hong Kong|Taiwan|Japan|South Korea|Korea|Singapore|Malaysia|Thailand|Vietnam|Indonesia|Philippines|Australia|New Zealand";
const ABROAD_PLACES =
  "London|Manchester|Edinburgh|Dublin|Toronto|Vancouver|Montreal|Ottawa|Ontario|Quebec|British Columbia|Alberta|Berlin|Munich|Hamburg|Paris|Madrid|Barcelona|Lisbon|Porto|Amsterdam|Zurich|Geneva|Stockholm|Copenhagen|Oslo|Helsinki|Warsaw|Krak[oó]w|Prague|Budapest|Bucharest|Tel Aviv|Dubai|Bengaluru|Bangalore|Hyderabad|Pune|Mumbai|Delhi|Gurgaon|Chennai|Tokyo|Seoul|Shanghai|Beijing|Shenzhen|Sydney|Melbourne|S[aã]o Paulo|Mexico City|EMEA|APAC|LATAM|Europe|Asia";

const US = new RegExp(`\\b(United States|${STATES}|${US_CITIES})\\b`, "i");
const US_SHORT = /\b(USA|US|U\.S\.A?\.?)(?![a-z])|D\.C\./;
const ABROAD = new RegExp(`\\b(${COUNTRIES}|${ABROAD_PLACES})\\b`, "i");
// "Austin, TX". Two letters alone prove little ("Bengaluru, IN", "Berlin, DE"), so this is tried last.
const CITY_STATE = new RegExp(`, (${STATE_CODES})\\b`);

export type Place = "us" | "abroad" | "unknown";
// A location that names a place in the United States counts as there, whatever else it names.
export function placeOf(location: string | null | undefined): Place {
  if (!location?.trim()) return "unknown";
  if (US.test(location) || US_SHORT.test(location)) return "us";
  if (ABROAD.test(location)) return "abroad";
  return CITY_STATE.test(location) ? "us" : "unknown";
}
