# AOG Kiosk — Deployment Guide (all three link modes)

This is the operational guide for how every kiosk link gets built, deployed,
and verified, and what to watch out for at each step. For what the product
*is*, see [README.md](README.md). For reverting a bad content push, see
[ROLLBACK.md](ROLLBACK.md).

---

## The three modes at a glance

| | 1. Classic (Android TV fleet) | 2. Auto links | 3. Autodist links |
|---|---|---|---|
| URL | `https://developerbilions.github.io/AOG-Kiosk-App/` | `https://kiosk.aogcoin.club/auto/…` (`/auto/`, `/auto/portrait/`, `/auto/landscape/`) | `https://kiosk.aogcoin.club/autodist/…` (`/autodist/portrait/`, `/autodist/landscape/`) |
| Loaded by | APK WebView on in-store TVs (sideloaded once) | Any browser / signage player | MDD signage network (venue ID appended at runtime) |
| Sign-in | Typed agent login on `index.html` → `POST /auth/login-agent` | Credentials **inside the link**: `#c=base64(user:pass)` → `POST /auth/login-agent` | Venue/dist ID in the link: `?dist=<VENUEID>` → `POST /auth/login-kiosk-dist` (no credentials in the link) |
| localStorage keys | `aog_token` / `aog_refresh` / `aog_user` | `aog_auto_*` | `aog_dist_*` (+ `aog_dist_id`) |
| Source folder | `web/` (root pages) | `web/auto/` | `web/autodist/` |
| Served from | GitHub Pages | S3 + CloudFront (subdomain) | S3 + CloudFront (subdomain) |

The three flows are **deliberately independent**: separate pages, separate
config.js, separate localStorage keys. They can run side by side on the same
origin and signing out of one never touches another. Never merge them.

Shared by all three: the promo/media files at the top of `web/` (`*.webp`,
`*.webm`, `QR.png`), the QR fetch flow (`GET /referral/my-link` →
`GET /referral/<token>/qr`), and the API at `https://aogclub.api.skynbliss.co/api`.

---

## Shared infrastructure

```
                    git push to main (web/** changed)
                                │
                 .github/workflows/deploy-pages.yml
                    │                         │
          job: deploy (Pages)        job: deploy-aws (S3 mirror)
                    │                         │  ⚠ FAILS — AWS repo secrets
                    ▼                         ▼     never configured
   developerbilions.github.io      MANUAL: aws s3 sync + CF invalidation
        (TV fleet loads this)                 │
                                              ▼
                                 S3 kiosk-aogcoin-club (us-east-2, private, OAC)
                                              │
                                 CloudFront E28CSTH4NONUBK
                                 (d1wd6lc3osvyd9.cloudfront.net)
                                  + CF Function kiosk-index-rewrite
                                  + ACM cert (us-east-1)
                                              │
                                 Route 53 zone aogcoin.club (Z0310667T39Z2DGD2KDI)
                                 A-alias kiosk → the CloudFront domain
                                              │
                                    https://kiosk.aogcoin.club
```

- **DNS** (since 2026-08-21): `aogcoin.club` is hosted in **Route 53**
  (moved off Namecheap). The `kiosk` record is an A-alias to the CloudFront
  distribution. If DNS ever breaks again, that alias record is the thing to
  check first.
- **CloudFront Function** `kiosk-index-rewrite` (viewer-request) rewrites
  folder URLs to `index.html` (S3 REST origins can't serve directory
  indexes). Its source of truth is versioned in this repo at
  [`cloudfront/kiosk-index-rewrite.js`](cloudfront/kiosk-index-rewrite.js),
  including the deploy commands in its header.
- **The `deploy-aws` job fails on every push** because the repo has no
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` Actions secrets (the
  `AWS_DEPLOY_ENABLED` variable is `true` and the bucket/distribution
  variables are set). Until someone runs `gh secret set` for both keys, the
  S3 mirror is a **manual step on every deploy** (commands below). GitHub
  Pages is unaffected either way — the fleet always gets updates.

---

## Mode 1 — Classic / GitHub Pages (the Android TV fleet)

**How it works.** TVs run a sideloaded APK (`dist/AOG-Kiosk-v1.4-release.apk`)
whose WebView loads the GitHub Pages URL and silently reloads it every 15
minutes and on app resume. `web/index.html` is the typed login page;
`web/kiosk.html` is the promo-carousel + QR home screen. If the TV is
offline, the WebView falls back to the bundled copy in
`android/app/src/main/assets/web/`.

**Deploy steps (content change):**

1. Edit files under `web/` (never only the Android copy).
2. Mirror to the offline fallback so both stay in sync:
   `./android/tools/sync-web-assets.sh` (or copy the changed files to
   `android/app/src/main/assets/web/` by hand).
3. Commit and push to `main`.
4. Watch the **Deploy kiosk page to GitHub Pages** workflow
   (`gh run list --workflow deploy-pages.yml`). The `deploy` job must
   succeed; ignore the expected `deploy-aws` failure (see above) — but that
   failure means you now owe the manual S3 sync for modes 2 and 3.
5. Verify: `curl -s https://developerbilions.github.io/AOG-Kiosk-App/kiosk.html | grep "<something you changed>"`
6. Fleet pickup: v1.4 APKs (`LOAD_NO_CACHE`) show the change on the next
   15-minute refresh; v1.3 lags ~10–15 min extra due to WebView caching.

**Take care:**

- **Never attach a custom domain to the GitHub Pages site.** It would 301 the
  fleet to a new origin and wipe every TV's localStorage session (that's why
  the subdomain is a *separate* S3/CloudFront mirror, not a Pages CNAME).
- Keep `android/app/src/main/assets/web/` in sync with `web/` — a TV that
  goes offline shows the bundled copy, and you don't want it weeks stale.
  (Only the pages the APK can load matter there; `autodist/` and the
  portrait/landscape variants are browser-only and are not bundled.)
- Native behaviour (WebView flags, refresh interval, kiosk URL) lives in the
  APK — content pushes can't change it; that's a new signed APK in `dist/`
  and a store visit per TV.
- When replacing referenced media (carousel images, QR), deploy the new files
  and references together but **delete old files only in a later commit** —
  v1.3 devices hold the old HTML for ~15 min and would 404 the images.
- A workflow run stuck in `waiting` (GitHub runner outages happen) blocks
  deployment silently: `gh run cancel <id>` then
  `gh workflow run deploy-pages.yml --ref main`.
- Rollback: hosted pages roll back the whole fleet automatically — see
  [ROLLBACK.md](ROLLBACK.md); tag `pre-promo-stable` marks a known-good state.

---

## Mode 2 — Auto links (`web/auto/`, credentials in the link)

**How it works.** The link itself carries the store account's credentials:
`base64("username:password")` in the `c` parameter. `index.html` decodes it,
signs in via `POST /auth/login-agent`, stores the token pair under
`aog_auto_*`, and forwards to `kiosk.html` which renders the live referral
QR. Three layouts, same session:

| Link | Layout |
|---|---|
| `https://kiosk.aogcoin.club/auto/#c=BASE64` | Promo carousel + QR column |
| `https://kiosk.aogcoin.club/auto/portrait/#c=BASE64` | QR-only, 1080×1920 |
| `https://kiosk.aogcoin.club/auto/landscape/#c=BASE64` | QR-only, 1920×1080 |

Generate the payload with `echo -n 'username:password' | base64`. Prefer the
`#c=` fragment form (fragments never reach server/CDN logs); `?c=` also works.

**Deploy steps (content change):**

1. Edit under `web/auto/` (portrait and landscape have their own copies of
   `kiosk.html` — a shared change usually means editing multiple files;
   `auto/config.js` is shared by all three auto pages).
2. Commit, push, confirm the Pages `deploy` job succeeded (the same `web/`
   folder is what gets mirrored).
3. **Manual S3 sync + cache invalidation** (until the CI secrets exist):
   ```bash
   aws s3 sync web s3://kiosk-aogcoin-club --delete --region us-east-2
   aws cloudfront create-invalidation --distribution-id E28CSTH4NONUBK --paths "/*"
   ```
4. Verify each changed page, busting cache:
   `curl -s "https://kiosk.aogcoin.club/auto/portrait/kiosk.html?cb=$RANDOM" | grep "<change>"`

**Take care:**

- **The link IS the password.** Base64 is encoding, not encryption. Share
  auto links like credentials; rotate the account password to revoke a
  leaked link.
- Signing in requires the account to be a **Creator (role 2) or Sub-Creator
  (role 5)** — `/auth/login-agent` refuses everything else.
- The origin `https://kiosk.aogcoin.club` must stay in the API's CORS
  allowlist or sign-in fails with opaque network errors.
- Sessions survive via `POST /users/refresh-token`; an unrecoverable 401
  bounces to `index.html`, which re-signs-in from the link credentials if
  the URL still has them ("reopen your link" otherwise).
- Extra link params (`?loc=…` etc.) are captured to `aog_auto_meta` for
  future backend use — don't repurpose the `c` key.

---

## Mode 3 — Autodist links (`web/autodist/`, dist/venue ID in the link)

**How it works.** No credentials anywhere in the link. The signage platform
(MDD) appends the venue ID at runtime; the page exchanges it for a session:

```
https://kiosk.aogcoin.club/autodist/portrait/?dist=_MDD_VENUEID
https://kiosk.aogcoin.club/autodist/landscape/?dist=_MDD_VENUEID
```

`index.html` reads `dist` (query, `#fragment`, or a `&dist=` mangled into the
path), calls `POST /auth/login-kiosk-dist { dist }`, and the backend resolves
the store account whose `tbl_registration.kiosk_dist_id` matches — minting
the same access + refresh token pair as `/login-agent`. Session lives under
`aog_dist_*`; the page **remembers the dist ID** (`aog_dist_id`) so an
expired session re-signs-in even if the platform reopens the page without
the param, and **reuses a matching session across reloads** instead of
logging in every time (signage players reload constantly).

**Backend dependency (aog-backend repo):** migration 186
(`kiosk_dist_id` column, unique), endpoint `POST /auth/login-kiosk-dist`
(PR #679), and the failure-only rate limiter (PR #688 —
`skipSuccessfulRequests`, 30 failures / 15 min / IP). All deployed on
production as of 2026-08-07.

**Onboarding a new store/venue:**

1. Map the venue ID to the store account (must be role 2/5 and active):
   ```sql
   UPDATE tbl_registration SET kiosk_dist_id = '<VENUEID>' WHERE member_id = '<store member id>';
   ```
   (or via the Kiosk Dist ID field in Creator Management.)
2. Smoke-test the exchange:
   ```bash
   curl -s -X POST https://aogclub.api.skynbliss.co/api/auth/login-kiosk-dist \
     -H "Content-Type: application/json" -d '{"dist":"<VENUEID>"}'
   ```
   Expect `statusCode: 200` with the account's `userData`. A generic 401
   means unmapped / inactive / wrong role.
3. Hand the platform the portrait or landscape URL with their venue-ID macro.

**Deploy steps (content change):** identical to Mode 2, but edit under
`web/autodist/` (own `config.js`, own portrait/landscape pages) and verify
the `/autodist/…` URLs.

**Take care:**

- **The dist ID is the access token to that store's kiosk session** — only
  IDs an admin has explicitly mapped work, but still treat them as
  link-secrets, not public identifiers.
- The endpoint never rate-limits successful sign-ins; only failures count.
  If stores ever report "Too many attempts", something is generating
  *failed* logins (wrong/unmapped IDs) from their IP.
- If the MDD platform appends `&dist=` to a base URL **without a `?`** (the
  param lands in the URL path), the updated CloudFront function in
  [`cloudfront/kiosk-index-rewrite.js`](cloudfront/kiosk-index-rewrite.js)
  must be deployed — it 302s `/autodist/portrait&dist=123` to
  `/autodist/portrait/?dist=123`. With the normal `?dist=` form, the
  currently-deployed function is enough.
- Remapping a screen to a different store = point its `dist` at the new ID
  (a different dist in the URL always forces a fresh sign-in); revoking a
  venue = `SET kiosk_dist_id = NULL`.

---

## Full deploy checklist (any content change)

```
[ ] 1. Edit under web/ (right subfolder for the mode; remember portrait +
       landscape usually both need the same edit)
[ ] 2. Fleet-relevant change? → sync android/app/src/main/assets/web/
[ ] 3. git commit && git push (main)
[ ] 4. gh run list --workflow deploy-pages.yml → 'deploy' job = success
       (stuck in 'waiting'? cancel + re-dispatch)
[ ] 5. aws s3 sync web s3://kiosk-aogcoin-club --delete --region us-east-2
[ ] 6. aws cloudfront create-invalidation --distribution-id E28CSTH4NONUBK --paths "/*"
[ ] 7. Verify github.io + kiosk.aogcoin.club URLs (curl with ?cb=$RANDOM)
[ ] 8. Removed/renamed media? → delete old files only after ~15 min, in a
       follow-up commit + sync
```

## Standing issues / one-time fixes worth doing

- **Add the AWS secrets to the repo** so `deploy-aws` works and steps 5–6
  disappear: `gh secret set AWS_ACCESS_KEY_ID` and
  `gh secret set AWS_SECRET_ACCESS_KEY` → then a push deploys everything.
  (Until then every push MUST be followed by the manual sync or the
  subdomain serves stale pages while github.io is current.)
- Old carousel banners (`Daily_Login.webp` etc.) are on disk but
  unreferenced; safe to delete in a cleanup commit.
- Legacy AWS leftovers from the stalled first CDN attempt (bucket
  `aog-kiosk-web`, distribution `EZ1ZFQNST1TI3`) are unused and pending
  deletion.
