# DNS, Nginx and HTTPS

## Domain

Create an A record for eu-connect.example.edu pointing to the VPS IPv4 address. Publish AAAA only if IPv6 is configured and firewalled correctly. Obtain permission from the school's DNS administrator. Confirm resolution and a reachable port 80 before certificate issuance.

If another control panel/web server owns ports 80/443, adapt that configuration deliberately. This guide's example is a fresh Nginx virtual host.

## Install the site

Replace the example hostname in templates/eu-connect.nginx.conf and copy it to /etc/nginx/sites-available/eu-connect. Its map block belongs in the http context; sites-enabled is normally included there on Ubuntu. Enable the site with a symlink after checking it does not already exist.

```bash
sudo ln -s /etc/nginx/sites-available/eu-connect /etc/nginx/sites-enabled/eu-connect
sudo nginx -t
sudo systemctl reload nginx
```

The supplied site initially uses HTTP to allow certificate setup. It forwards /api/v1/ and /eu-connect/api/ to Express, preserving both prefixes. /socket.io/ goes to Express with upgrade headers. Other routes, including /api/socket-ticket, /api/reports/* and Server Actions, go to Next.js. Forwarding every /api/ path to Express would break these local Next APIs.

The sample permits 50 MB requests at Nginx, aligned with the current Server Action transport limit. The backend has a 10 MB JSON body limit and separate multipart/feature limits. Nginx's cap does not change those validation rules. Buffering is disabled for streamed responses, and read/send timeouts are set to 180 seconds.

The proxy overwrites forwarding headers with the actual client address and original host/protocol. The backend currently trusts one proxy hop. Direct public access to 7000 must stay blocked so clients cannot bypass that boundary. Server-side Next requests go directly to loopback and may be identified as loopback by IP-only logging/rate limits; verify the existing identity-based limiter behavior during staging. Adding CDN proxies requires another explicit trust review.

## Certificate and renewal

Install Certbot using the school's maintained method. On Ubuntu with the snap method:

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d eu-connect.example.edu
sudo /snap/bin/certbot renew --dry-run
sudo nginx -t
```

Complete the email/terms prompts and select HTTPS redirection. Certbot updates the HTTP site with TLS settings and renewal automation; verify its timer and actual redirect. Keep 80 reachable for HTTP validation unless switching to a deliberate DNS-validation setup. Confirm the resulting HTTPS location blocks retain the supplied routing and headers. [Certbot instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap)

Keep Host equal to the public school hostname. Next Server Actions compare request origin information; preserving Host and X-Forwarded-Host avoids common origin mismatch failures. Test a real form submission after TLS is active.

Socket.IO needs HTTP/1.1 Upgrade and Connection headers through Nginx. A public https socket URL negotiates secure WebSockets as needed. [Nginx WebSocket documentation](https://nginx.org/en/docs/http/websocket.html)

## Verify

```bash
curl -I http://eu-connect.example.edu/login
curl -I https://eu-connect.example.edu/login
curl -i https://eu-connect.example.edu/api/v1/accounts
```

HTTP should redirect to HTTPS. The unauthenticated accounts endpoint should reject access, rather than returning account data. Log in through the frontend to test the authorized path. In browser developer tools confirm socket.io connects, no mixed-content URLs point to localhost, and secure cookies are present. Anonymous polling may be rejected because the app requires a socket-only ticket; a raw socket URL alone is not an authentication test.

