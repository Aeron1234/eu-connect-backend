# EU-Connect Hostinger VPS deployment guides

Prepared November 17, 2026 from the current frontend and backend source. This is a deployment handoff for the school's technical administrator. Commands target a fresh Ubuntu 24.04 LTS x86-64 VPS, a school-owned domain, one frontend process and one backend process. Replace example.edu and all REPLACE values before use. The school must select its domain, hosting resources, database location, backup retention and maintenance owner.

## Read in this order

1. [Requirements and architecture](01-requirements.md)
2. [VPS preparation](02-vps-preparation.md)
3. [Database and backend](03-backend.md)
4. [Frontend and PDF exports](04-frontend.md)
5. [Nginx, DNS and HTTPS](05-nginx-https.md)
6. [Updates, backups and troubleshooting](06-operations.md)
7. [Go-live acceptance checklist](07-go-live-checklist.md)

The [templates](templates/) directory contains two environment examples, two systemd units and an Nginx site. They contain placeholders and must be reviewed before installation. They are documentation examples and have not been installed on a VPS.

## Reference layout

```text
/srv/eu-connect/
  current -> releases/RELEASE_ID
  releases/RELEASE_ID/
    frontend/                # ims
    backend/                 # ims-backend
  shared/
    frontend.env             # private production values
    backend.env              # private production values
```

The release IDs should identify a tested frontend/backend pair. Keep a previous release for rollback. Build the frontend before switching current. Both applications run as the unprivileged euconnect user. Next.js uses port 3000; Express/Socket.IO uses 7000. Only Nginx's 80/443 and restricted SSH are publicly allowed.

## Scope of this handoff

For faculty orientation, the supplied original export and its existing demonstration data are included under [database/](database/README.md). Use that dataset for orientation instead of the separate cleaned exports. Restrict access to this folder because the SQL contains private account data.

No live server, DNS, certificates, database or provider settings were changed. Repository versions inspected are Next.js 16.4.6 and a Node engine requirement of >=24.22.3 <25. Verify the newest patched Node 24.x and framework releases when deploying. The school must perform the staging and real-device checks listed here.

Official references support the hosting and infrastructure guidance. Application-specific statements come from next.config.mjs, package scripts, auth-shared.js, SocketProvider.js, pdfBrowser.js, backend server.js, config/db.js and the feature code. [Sources](08-sources.md)

