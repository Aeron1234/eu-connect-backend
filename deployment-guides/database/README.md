# Faculty orientation database

[eu-connect-20261117-075330.sql](eu-connect-20261117-075330.sql) is an unchanged copy of the SQL export supplied by the user. It retains the existing accounts and demonstration records for faculty orientation. The copy was verified against the source using SHA-256.

Import into the intended orientation database after backing up any existing target. This full dump contains DROP TABLE statements and replaces exported tables. It includes personal information and password hashes, so share this folder only with authorized school administrators.

The export predates the backend daily narrative removal. After importing it, deploy the updated backend and apply scripts/2026-11-17-remove-daily-narratives.sql if retiring that table. This drops daily narratives while retaining the other orientation data. The cleaned admin1-only exports are separate and are not the selected orientation dataset.

Database imports do not include Supabase storage objects. Demonstration uploads require the corresponding authorized storage project and files. No live database was changed by attaching this export.

For the selected move to Hostinger uploads, follow [the storage migration guide](../09-hostinger-vps-storage.md). Existing database references need the corresponding file bytes transferred from Supabase before orientation downloads can work on local storage.
