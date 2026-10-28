export function fillTemplate(template: string, vars: Record<string, string | number | null>, name = "template"): string {
  const missing = new Set<string>();
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(vars, key)) missing.add(key);
    return String(vars[key] ?? "");
  });
  if (missing.size) throw new Error(`${name}: nothing supplied for ${[...missing].map(key => `{{${key}}}`).join(", ")}`);
  return text;
}
