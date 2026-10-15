export function formatPersonName(firstName, middleInitial, lastName) {
  const initial = String(middleInitial ?? "").trim().replace(/\.$/, "");
  return [
    String(firstName ?? "").trim(),
    initial ? `${initial.toUpperCase()}.` : "",
    String(lastName ?? "").trim(),
  ].filter(Boolean).join(" ");
}

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
