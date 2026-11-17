# Frontend and PDF reports

The frontend runs as a Next.js Node server. Static-file-only hosting does not cover the current Server Actions, protected routes or report APIs. The current config has no standalone output setting; the service uses the ordinary .next production build.

## Environment

Use templates/frontend.env.example. Set the server-only API_BASE_URL to http://127.0.0.1:7000/api/v1 and ACCESS_TOKEN_SECRET to the backend's exact access secret. Set NEXT_PUBLIC_SOCKET_URL=https://eu-connect.example.edu before building. Browser-public variables are compiled into client bundles, so changing the socket origin requires another build.

The runtime uses production secure cookies. Use the final HTTPS origin for school testing. The backend's CLIENT_URL must match it. Camera, location and phone permission testing must happen on HTTPS. Keep secrets out of NEXT_PUBLIC variables.

## Install and build

As euconnect, inside releases/RELEASE_ID/frontend:

```bash
ln -s /srv/eu-connect/shared/frontend.env .env.local
npm ci --include=dev
npm run build
```

Build dependencies such as Tailwind and the compiler are needed during installation/build. Do not set an npm omit=dev policy before building. Review npm's blocked install-script warnings; the required PDF preparation hook must execute. The prebuild/postinstall script scripts/prepare-pdf-preview.mjs populates public/pdfjs with version-matched assets. Keep that directory in the deployed release.

Install Linux dependencies fresh from the lockfile. Keep .next, node_modules, public, package manifests and next.config.mjs with their required source/config imports for this normal next start deployment. Avoid modifying a release currently serving traffic while building its replacement.

## Puppeteer and Chrome

On the VPS, leave VERCEL unset. The code checks its truthiness, so even VERCEL=0 would choose the Vercel-specific browser path. The normal VPS path calls puppeteer.launch under the service user.

Puppeteer's Chrome needs Linux libraries and a working sandbox. As an operator, review Puppeteer's current dependency list for the selected Ubuntu version. A root setup command from the frontend directory can install the pinned browser and dependencies into the service user's cache:

```bash
sudo env PUPPETEER_CACHE_DIR=/srv/eu-connect/.cache/puppeteer ./node_modules/.bin/puppeteer browsers install chrome --install-deps
sudo chown -R euconnect:euconnect /srv/eu-connect/.cache
```

Confirm the .cache path resolves inside /srv/eu-connect before changing ownership. The unit sets the same PUPPETEER_CACHE_DIR. Test a PDF as the unprivileged service account. Keep Chromium's sandbox available; --no-sandbox is not the standard fix. Ubuntu/AppArmor or kernel user-namespace restrictions may require the administrator to apply a supported browser sandbox policy. [Puppeteer troubleshooting](https://pptr.dev/troubleshooting)

The @sparticuz/chromium dependency is still present for the alternate platform branch; installation does not mean the VPS should set VERCEL. PDF generation consumes CPU and memory, so include concurrent exports in capacity tests.

## Service and validation

Install templates/eu-connect-frontend.service into /etc/systemd/system using sudo install -m 644. It binds Next.js to 127.0.0.1:3000. EnvironmentFile, HOME and the Chrome cache path are supplied explicitly.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eu-connect-frontend
curl -I http://127.0.0.1:3000/login
sudo journalctl -u eu-connect-frontend --since '15 minutes ago'
```

The existing next.config.mjs remote image pattern references the former Vercel hostname. Review actual external next/image sources and allow only required HTTPS image hosts if the school changes them. Keep the existing PDF tracing, API normalization, 50 MB Server Action transport limit and security upgrade configuration.

NEXT_PUBLIC_SOCKET_URL should reference the public origin, while the browser's authenticated /api/socket-ticket request stays on Next.js. Nginx sends /socket.io/ to Express. Confirm real-time notifications and live locations after proxy setup.

The Next.js self-hosting guide recommends a reverse proxy and documents streaming behavior. This package uses next start behind Nginx with buffering disabled. [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)

