// Build report/signature names, omitting absent parts and normalizing the middle initial's dot.
// First/last name casing is retained; this formats text without changing stored identity.
export function formatPersonName(firstName, middleInitial, lastName) {
  const initial = String(middleInitial ?? "").trim().replace(/\.$/, "");
  return [
    String(firstName ?? "").trim(),
    initial ? `${initial.toUpperCase()}.` : "",
    String(lastName ?? "").trim(),
  ].filter(Boolean).join(" ");
}

// Add the creator's middle initial only when Prepared By starts with their matching first/last
// name and a supported suffix boundary. Preserve other signatories and custom text verbatim.
export function formatCreatorPreparedBy(preparedBy, firstName, middleInitial, lastName) {
  const original = String(preparedBy ?? "");
  if (!middleInitial || !firstName || !lastName) return original;

  const creatorName = formatPersonName(firstName, null, lastName);
  const normalized = original.trim();
  if (!normalized.toLocaleLowerCase().startsWith(creatorName.toLocaleLowerCase())) {
    return original;
  }

  const remainder = normalized.slice(creatorName.length);
  if (remainder.trim() && !/^(?:[ \t]*(?:,|\/|[-–—]|\(|\r?\n))/.test(remainder)) {
    return original;
  }
  return `${formatPersonName(firstName, middleInitial, lastName)}${remainder}`;
}
