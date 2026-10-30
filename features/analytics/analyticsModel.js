export const companyKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const name = value => String(value || '').trim().replace(/\s+/g, ' ');
export function academicYear(row) {
  if (!row.date_started) return null;
  const year = Number(row.date_started.slice(0, 4)), month = Number(row.date_started.slice(5, 7));
  // Match internship_records_with_ay, including explicit first/second/summer terms.
  const start = row.semester === '1st' || (row.semester === '2nd' && month === 12) || (!row.semester && month >= 7) ? year : year - 1;
  return `${start}-${start + 1}`;
}
export function inPeriod(row, filters) {
  const date = row.date_started;
  return (!filters.from || (date && date >= filters.from)) && (!filters.to || (date && date <= filters.to)) &&
    (!filters.academicYear || academicYear(row) === filters.academicYear) && (!filters.term || row.semester === filters.term);
}
export function companyAnalytics(records, directory, filters) {
  const known = new Map(), selected = records.filter(row => inPeriod(row, filters));
  for (const row of [...records, ...directory]) {
    const key = companyKey(row.company_name);
    if (key && !known.has(key)) known.set(key, { key, company: name(row.company_name), students: new Map(), courses: new Set(), departments: new Set() });
  }
  const students = new Set(), months = new Map(); let undatedRecords = 0, unnamedRecords = 0;
  for (const row of selected) {
    const key = companyKey(row.company_name);
    if (!key) { unnamedRecords++; continue; }
    const group = known.get(key), state = group.students.get(row.user_id) || { ongoing: false, finished: false };
    state[row.status] = true; group.students.set(row.user_id, state); students.add(row.user_id);
    if (row.course_name) group.courses.add(row.course_name);
    if (row.department_code) group.departments.add(row.department_code);
    if (row.date_started) {
      const month = row.date_started.slice(0, 7);
      if (!months.has(month)) months.set(month, new Set());
      months.get(month).add(`${key}\u0000${row.user_id}`);
    } else undatedRecords++;
  }
  const all = [...known.values()].map(group => {
    let ongoing = 0, finished = 0;
    for (const state of group.students.values()) { if (state.ongoing) ongoing++; else if (state.finished) finished++; }
    return { key: group.key, company: group.company, students: group.students.size, ongoing, finished, courses: [...group.courses].sort(), departments: [...group.departments].sort() };
  });
  const ranked = all.filter(row => row.students).sort((a,b) => b.students-a.students || a.company.localeCompare(b.company, 'en'));
  const placements = ranked.reduce((sum,row) => sum + row.students, 0);
  let rank = 0, previous = null;
  for (const [index,row] of ranked.entries()) { if (row.students !== previous) rank = index+1; previous = row.students; row.rank = rank; row.share = placements ? row.students/placements*100 : 0; }
  return { companies: ranked, zeroCompanies: all.filter(row => !row.students).sort((a,b) => a.company.localeCompare(b.company, 'en')),
    most: ranked.length ? ranked.filter(row => row.students === ranked[0].students) : [],
    least: ranked.length ? ranked.filter(row => row.students === ranked.at(-1).students) : [],
    stats: { distinctStudents: students.size, studentCompanyPairs: placements, companiesWithPlacements: ranked.length, zeroCompanies: all.length-ranked.length, ongoing: ranked.reduce((sum,row)=>sum+row.ongoing,0), finished: ranked.reduce((sum,row)=>sum+row.finished,0), undatedRecords, unnamedRecords },
    trends: [...months].sort(([a],[b]) => a.localeCompare(b)).map(([month,pairs]) => ({ month, placements: pairs.size })) };
}
export function registrarAnalytics(records, reports, year) {
  const placements = records.filter(row => !year || academicYear(row) === year), selectedReports = reports.filter(row => !year || row.academic_year === year);
  const students = new Set(placements.map(row=>row.user_id)), distribution = new Map(), trend = new Map();
  for (const row of placements) {
    const key = `${row.department_code || 'Unclassified'}\u0000${row.course_id || 'unknown'}`;
    if (!distribution.has(key)) distribution.set(key, { department: row.department_code || 'Unclassified', course: row.course_name || 'No course', students: new Set() });
    distribution.get(key).students.add(row.user_id);
  }
  for (const row of selectedReports) if (row.submitted_at) { const month = row.submitted_at.slice(0,7); trend.set(month,(trend.get(month)||0)+1); }
  return { stats: { confirmedStudents: students.size, confirmedRecords: placements.length, reports: selectedReports.length, drafts: selectedReports.filter(row=>row.status==='draft').length, submitted: selectedReports.filter(row=>row.status==='submitted').length },
    distribution: [...distribution.values()].map(row=>({ ...row, students: row.students.size })).sort((a,b)=>a.department.localeCompare(b.department)||a.course.localeCompare(b.course)),
    trends: [...trend].sort(([a],[b])=>a.localeCompare(b)).map(([month,reports])=>({month,reports})),
    recent: [...selectedReports].sort((a,b)=>String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0,10) };
}
