# SMF Condo Activation (NutriChunks / Majesty condo sampling)

Separate from the Barker's app. Own Google Sheet, own Cloudflare Worker. Nothing here touches the Barker's sheet or Worker.

## How it works
1. Resident scans the QR poster at the booth -> opens `/?c=RR` (RR = condo code) on their own phone.
2. Fills in privacy consent, pet details, name, mobile -> gets a **claim ticket** (number + QR + which sample).
3. BA opens `/ba.html`, takes a photo of the resident’s claim screenshot; the app reads its QR automatically. Ticket-number entry remains a backup. BA confirms the sample, records separate customer-photo consent, takes the customer + sample photo only if consent is YES (furbaby if present), then taps **Sample given**. Declining the customer photo does not prevent claiming.
4. Client opens `/report.html` with the report passcode.

Rules: one registration per mobile number for the whole activation, with one pack per applicable variant regardless of pet count. Puppy -> Puppy Lamb; adult small dog -> Small Breed; adult medium/large dog -> Maintenance Adult; cat -> Majesty Adult Salmon. All eligible variants appear on the ticket once. An unavailable variant is marked out of stock; there is no substitution. BA releases only assigned variants. Existing tickets keep their original allocation.

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
   `GATEWAY_URL` (plain variable) and `GATEWAY_SECRET` (secret). Optional: `SESSION_SECRET`, `REPORT_PASSCODE`; without them the sign-in key is derived from GATEWAY_SECRET and the report passcode is read from SETTINGS > REPORT_PASSCODE in the sheet.
5. Print one QR poster per condo pointing to `https://<worker-url>/?c=<CONDO CODE>`.

## Tests
`npm test` — runs the real `Code.gs` on an in-memory sheet and the real Worker. `npm run dev` starts a local practice copy.

## Short links (Cloudflare Pages project `nutrimajesty`, folder `shortlink/`)
- nutrimajesty.pages.dev/rr → Rainbow Ridge, /lv → La Verti, /ba → BA app, /report → client report.
- New condo: add a line to `shortlink/_redirects` and push.

## Updating the BA photo flow
Deploy the updated Worker and assets together. Replace the existing condo Apps Script with `gateway/Code.gs` and update its existing web-app deployment to a new version; keep the same deployment URL and secrets. New photo columns are appended automatically without moving existing records (or run `setupSheets()` to add them beforehand). Refresh the BA app while online to receive the new offline cache.

The ticket photo is stored in the existing PHOTO_URL column. PHOTO_CONSENT is YES / NO; historical/offline saves from the older app are NOT_RECORDED. CUSTOMER_PHOTO_URL stores the separate consented documentation photo and is available in the client report and CSV. Consent is for activation documentation, not advertising. QR decoding runs locally on the still image, not OCR; a screenshot without a readable QR needs a clearer photo or typed ticket number.

Out-of-stock attempts: the BA stock list labels depleted variants OOS. Ticket lookup disables release for unavailable variants. BAs record a customer attempted redemption using “Record customer tried — OOS” and select the missing variant(s). The claim log saves RESULT=OOS, PRODUCTS_UNAVAILABLE, BA, and timestamps, with no PRODUCTS_GIVEN, no claimed status, and no stock deduction. The server also rechecks stock under the claim lock and records OOS instead of releasing depleted stock. Records & photos shows OOS attempts separately; training remains excluded.
