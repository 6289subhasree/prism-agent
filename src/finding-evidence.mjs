// Read JSON pointers as data only; never traverse inherited properties.
export function evidenceAt(report, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  let value = report;
  for (const token of pointer.slice(1).split("/")) {
    if (/~(?![01])/u.test(token)) return undefined;
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (["__proto__", "prototype", "constructor"].includes(key) || value == null || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
