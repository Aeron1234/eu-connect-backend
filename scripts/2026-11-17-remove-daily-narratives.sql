-- Run after deploying the backend that retires daily narrative APIs and cleanup queries.
-- Permanently removes daily narratives and their data. Weekly narratives are separate.
-- Take a database backup before applying this irreversible DDL migration.
DROP TABLE IF EXISTS daily_narratives;
