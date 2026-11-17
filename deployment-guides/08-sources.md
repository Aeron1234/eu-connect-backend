# Sources and application trace

Checked November 17, 2026. Re-check installation instructions and supported versions at deployment time.

- [Hostinger Node.js deployment overview](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) describes VPS administration as a manually operated deployment path.
- [Hostinger VPS documentation](https://www.hostinger.com/support/vps/) covers the school's selected OS/template and server controls.
- [Node.js release schedule](https://github.com/nodejs/Release) documents supported release lines. The current application separately constrains Node to >=24.22.3 <25.
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) covers reverse proxies and streaming for a Node server.
- [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) describes forwarding protocol-upgrade headers.
- [Certbot Nginx/snap instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap) cover certificate installation and renewal.
- [Puppeteer troubleshooting](https://pptr.dev/troubleshooting) documents Linux dependencies and browser sandbox problems.

Frontend paths are relative to ims. Backend paths are relative to ims-backend.

| Topic | Owning source |
| --- | --- |
| Node and package scripts | Both package.json and package-lock.json files |
| API rewrites, Server Action transport, image origins | Frontend next.config.mjs |
| API URL normalization | Frontend lib/api-base-url.mjs |
| Server-only shared access secret and cookies | Frontend lib/server-actions/auth-shared.js |
| Socket public origin, tickets and transports | Frontend components/ui/SocketProvider.js |
| Chrome platform branch | Frontend app/_services/pdfBrowser.js |
| PDF viewer assets | Frontend scripts/prepare-pdf-preview.mjs |
| CORS, proxy trust, listeners and cron | Backend server.js |
| Database pool, collation and SQL timezone | Backend config/db.js |
| Supabase client and storage bucket use | Backend config/supabase.js, config/uploadLifecycle.js |
| EmailJS runtime parameters | Backend services/accountSetupMail.js |
| Duty reminders | Backend config/dtrDutyJobs.js |
| Account invitation queue | Backend features/accounts/accountInvitationQueue.js |
| School ID/import schema | Backend scripts/2026-11-17-student-account-import.sql |
| DTR cap | Backend config/shiftLimits.js |
| Retention/file cleanup | Backend config/softDeleteRetention.js, config/dtrPhotoCleanup.js |

These files were inspected without reading environment secret values. Environment templates list source-supported settings only. Older LocationIQ middleware/helpers and lib/db.js are inactive and do not establish current deployment requirements.

