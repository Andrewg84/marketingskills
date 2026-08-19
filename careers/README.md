# Collective Solar — Careers Page (v1 prototype)

## What this is
One single page (`index.html`) that automatically shows the right language
and currency depending on which country link someone clicks. Instead of
6 separate pages, we use one page with 6 "modes."

## How the country switching works
Add `?country=MX` (or CO, BO, VE, EG, PH) to the end of the URL, e.g.:

- careers.collectivesolar.io/?country=mx  → Spanish, Mexican pesos
- careers.collectivesolar.io/?country=ph  → English, Philippine pesos

Share the right link per ad/campaign per country. No link = default English/USD version.

## Still needs to be finished (not done yet)
1. **Odoo connection** — find the line in `index.html` that says
   `const ODOO_ENDPOINT = "REPLACE_WITH_ODOO_WEBHOOK_URL";` and replace it
   with the real Odoo webhook/API URL once Andrew has it from Rana/IT.
   Until then, applications just print to the browser console instead of
   sending anywhere — nothing is lost, it just doesn't reach Odoo yet.
2. **Real domain** — needs to be hosted at careers.collectivesolar.io
   (subdomain DNS setup + hosting, e.g. Vercel or Netlify).
3. **Currency exchange rates** are hardcoded estimates — swap for a live
   exchange-rate API if precision matters, or update manually monthly.
4. **Conversion tracking dashboard** — UTM params are already being
   captured on submit (utm_source, utm_medium, utm_campaign, plus which
   country page it came from) but nothing yet visualizes them. Recommend
   a simple Odoo report or Google Sheet fed by the webhook.

## Files
- `index.html` — the whole page (HTML, CSS, JS, no external dependencies)
