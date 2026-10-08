# SMF Condo Activation (NutriChunks / Majesty condo sampling)

Separate from the Barker's app. Own Google Sheet, own Cloudflare Worker. Nothing here touches the Barker's sheet or Worker.

## How it works
1. Resident scans the QR poster at the booth -> opens `/?c=RR` (RR = condo code) on their own phone.
2. Fills in privacy consent, pet details, name, mobile -> gets a **claim ticket** (number + QR + which sample).
3. BA opens `/ba.html`, scans the ticket (or types the number), takes a photo of the ticket + sample, taps **Sample given**.
4. Client opens `/report.html` with the report passcode.

Rules: one sample per mobile number for the whole activation. Dog: puppy -> Puppy Lamb, small breed -> Small Breed, others -> Maintenance Adult (falls back if out of stock). Cat -> Majesty Adult Salmon. Dog & Cat home -> one of each. BA can change the pack.

## Google Sheet tabs (edit these, not the code)
| Tab | What to put |
|---|---|
| CONDOS | condo code, name, address, booth location |
| SCHEDULE | date (yyyy-mm-dd), condo code, BA staff code |
| STOCK | date, condo code, product, packs for that day |
| STAFF | BA staff code, name, 4-digit PIN |
| BRANDS | brands shown to residents |
| SETTINGS | TEST_MODE = YES for practice on any date; **set NO before the event** |
| REGISTRATIONS / REDEMPTIONS | filled by the app — don't edit |

## Setup (once)
1. New Google Sheet -> Extensions -> Apps Script -> paste `gateway/Code.gs` -> run `setupSheets` -> allow access.
2. Deploy -> New deployment -> Web app, Execute as **Me**, Access **Anyone** -> copy the URL.
3. Project Settings -> Script properties -> copy `GATEWAY_SECRET`.
4. Cloudflare: deploy `worker/` (`npx wrangler deploy`) and set secrets
   `GATEWAY_URL`, `GATEWAY_SECRET`, `SESSION_SECRET` (any long random text), `REPORT_PASSCODE` (8+ chars).
5. Print one QR poster per condo pointing to `https://<worker-url>/?c=<CONDO CODE>`.

## Tests
`npm test` — runs the real `Code.gs` on an in-memory sheet and the real Worker. `npm run dev` starts a local practice copy.
