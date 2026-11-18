// Keep this CSV parser aligned with its counterpart in the other application.
const requiredIdentity = ["first_name", "last_name", "email"];
const requiredByRole = {
  student: ["course_code", "gender"],
  employer: ["username"],
  department_head: ["username", "department_code"],
  admin: ["username"],
};

function normalizeCsvAccount(data, role) {
  const formatName = name => (name ?? "").normalize("NFC").toLowerCase()
    .replace(/\p{L}[\p{L}\p{M}]*/gu, word => {
      const [initial, ...remaining] = [...word];
      return initial.toUpperCase() + remaining.join("");
    }).replace(/ {2,}/g, " ");
  return {
    ...data,
    first_name: formatName(data.first_name),
    last_name: formatName(data.last_name),
    middle_initial: (data.middle_initial ?? "").toUpperCase(),
    ...(role === "student" && { gender: data.gender.toLowerCase() }),
  };
}

function readAccountCsv(csv, role) {
  if (typeof role !== "string" || !Object.hasOwn(requiredByRole, role)) throw new Error("Select a supported account role before importing.");
  const requiredColumns = [...requiredIdentity, ...requiredByRole[role]];
  const columns = [...requiredColumns, "middle_initial", ...(role === "student" ? ["school_id"] : [])];
  if (typeof csv !== "string" || new TextEncoder().encode(csv).length > 256 * 1024) throw new Error("Upload a CSV of at most 256 KB.");
  const records = [];
  let record = [], value = "", quoted = false, closed = false;
  const pushValue = () => { record.push(value.trim()); value = ""; closed = false; };
  const pushRecord = () => {
    pushValue();
    if (record.some(Boolean)) records.push(record);
    record = [];
    if (records.length > 101) throw new Error("Import at most 100 accounts at a time.");
  };
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      if (char === ",") pushValue();
      else { pushRecord(); if (char === "\r" && text[i + 1] === "\n") i++; }
    } else if (char === '"' && !value && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting. Export the file as CSV UTF-8.");
      value += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (value || record.length || closed) pushRecord();
  const headers = records.shift()?.map(s => s.toLowerCase()) ?? [];
  if (!records.length) throw new Error("Include a header and at least one account.");
  if (new Set(headers).size !== headers.length || headers.some(s => !columns.includes(s)) || requiredColumns.some(s => !headers.includes(s))) {
    throw new Error("Use the provided CSV template for the selected role with its original column names.");
  }
  const formattedRecords = records.map(values => {
    const data = normalizeCsvAccount(Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])), role);
    return values.map((value, index) => data[headers[index]] ?? value);
  });
  return { headers, records: formattedRecords };
}

export function parseAccountCsv(csv, role) {
  const { headers, records } = readAccountCsv(csv, role);
  return records.map((values, index) => ({
    row: index + 2,
    data: Object.fromEntries(headers.map((key, n) => [key, values[n] ?? ""])),
    error: values.length !== headers.length ? "Column count does not match the header." : null,
  }));
}

export function formatAccountCsv(csv, role) {
  const { headers, records } = readAccountCsv(csv, role);
  const escapeCell = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  return [headers, ...records].map(values => values.map(escapeCell).join(",")).join("\n");
}
