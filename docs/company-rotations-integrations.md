# Company rotation integrations

Source audit: October 30, 2026. These contracts cover optional assignments within
one company. The internship end date is an estimate and must never cap rotations
or their related narrative coverage. This audit used source inspection and mocked
regression tests, without modifying live data.

| Connected feature | Contract to preserve |
| --- | --- |
| Student My Records | Tracking is optional for all academic departments. Pending/ongoing records can toggle it; assignment writes require an enabled, ongoing record owned by the student. Dates must be valid and ordered, start on or after the placement start, and not overlap inclusively. There is no estimated-end upper bound. |
| Staff record Overview and Rotations | The shared timeline displays all saved assignments, including those beyond the estimate. Existing Admin/current-department-head/assigned-employer API read permissions remain. Staff cannot write assignments. |
| Searched student profiles | The profile's Company rotations panel is restricted to that student's current department head. Its stricter UI exposure does not change authorized staff record-detail views or the student's own management page. |
| Weekly narrative form | Suggestions use overlap between narrative coverage and saved assignment dates. A week can select more than one unit. Assignments after the internship estimate remain selectable. Selection stays optional; failed rotation reads block saving rather than silently clearing selections. |
| Narrative create/edit | Lock the ongoing parent record and enforce the existing internship-start gate. Resolve IDs only within that internship. Save authoritative assignment snapshots; do not compare coverage with the end estimate. |
| Narrative cards and staff/profile reads | Render saved rotation_assignments. Ordinary internships keep their existing display. Renaming, removing or disabling live assignments does not rewrite saved labels. |
| Journal PDF preview/print/download | Read all authorized saved narratives and render their stored snapshots. Do not rebuild assignments from the current timeline or truncate entries at the estimated end. Owned finished records remain printable. |
| Disabling or deleting rotations | Disabling retains the timeline. Deletion soft-deletes the assignment; saved narrative snapshots remain. Explicit empty rotation_ids clears the snapshot; omitted IDs preserve it on edit. |
| Finished internship history | Finished records keep their timelines and journals readable. Completion, rather than the estimated date, prevents further assignment writes. |
| Cache and loading | Reads use private/no-store, viewer-and-record query keys, cancellation/deadlines, and bounded transient retry. Mutations commit before server cache invalidation, then refetch the shared rotation query and invalidate the student's related record/narrative/storage queries. Keep skeletons, retry UI and authorization-loss handling. |
| Activity logs | Keep the existing audit event and formatted rotation date range; do not rewrite stored audit descriptions when assignment history changes. |
| DTR, maps, summary reports and evaluations | Remain attached to the original internship/company/supervisor. Rotations do not split attendance totals, change the academic department/map grouping, create another internship, or change evaluation permissions. |

## Main code locations

- Backend policy/authorization/mutations: features/internship-rotations/.
- Narrative snapshot writes/reads: features/weekly-narratives/ and
  features/internship-rotations/rotationPolicy.js.
- Shared frontend timeline: components/internship-records-ui/CompanyRotations.js.
- Student/staff/profile placements: InternshipRecordsManager,
  StudentInternshipRecordList, RecordOverviewTab, RecordsDetailsPageContent and
  SearchedUserRecordsManager in their respective feature folders.
- Narrative selection/display: NarrativeRotationPicker and NarrativeRotations.
- Journal template: app/_services/weeklyNarrativesTemplate.js.
- Client reads/cache helpers: useInternshipRotations, rotation-read.mjs,
  rotations-actions.js and lib/internship-rotations.mjs.

The rotation response retains dateEnded as informational metadata for compatible
clients. Do not turn it back into an HTML max or server-side deadline. SQL keeps
only date_to >= date_from; no new migration, dependency or environment variable
is required for this policy or its connected-feature updates.

## Regression coverage

Backend: tests/internship-rotations.test.js,
tests/weekly-narratives-print.test.js, tests/weekly-narratives-cache.test.js,
tests/student-profile-department-access.test.js.

Frontend: tests/internship-rotations.test.mjs, tests/rotation-read.test.mjs,
tests/student-profile-department-access.test.mjs, tests/help-guides.test.mjs.

The suite checks post-estimate narrative create/edit and printing, original
snapshots after live timeline edits/removal, finished-history read-only behavior,
overlap/ownership/department rules, and loading/retry handling. Live browser/PDF
appearance and deployed service behavior require separate verification.
