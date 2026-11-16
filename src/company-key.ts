// How an employer's name is compared: case, accents, punctuation and words like Inc or LLC ignored, so
// "Acme, Inc." and "ACME" are the same employer. Pure, so modules that must not open the app database
// (the referral store, which scripts use on other files) can share it with db.ts.
const COMPANY_NOISE = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "plc",
  "holdings",
  "group",
  "the",
  "and",
]);
export const squash = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();

export const companyKey = (company: string) =>
  squash(company)
    .split(" ")
    .filter(w => w && !COMPANY_NOISE.has(w))
    .join("") || squash(company).replace(/ /g, "");
