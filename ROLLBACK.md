# Rollback guide

The kiosk fleet (both v1.3 and v1.4 APKs) loads the **hosted** page from GitHub
Pages (`web/` → https://developerbilions.github.io/AOG-Kiosk-App/) and
auto-refreshes it. So **rolling back the hosted `web/` files rolls back the whole
fleet automatically** — no reinstall. v1.4 reverts on the next refresh
(LOAD_NO_CACHE); v1.3 within its ~15-min cache cycle (force-stop/clear-cache to
hurry it).

## Backup markers (git tags)

| Tag | What it is |
|-----|------------|
| `pre-promo-stable` | Known-good deployed state **before** the promo media carousel. Device registration + daily check-in + auto-forward all working; original 3 text promo scenes. |

Create a new marker before any risky change:
```bash
git tag -a <name> -m "why this is a safe point"
git push origin <name>
```

## Roll back the promo (or any hosted change)

**Option A — revert the merge commit (cleanest):**
```bash
git checkout main
git revert -m 1 <merge-commit-sha>   # the promo merge
git push origin main                  # Pages redeploys the previous page
```

**Option B — restore web/ from a known-good tag:**
```bash
git checkout main
git checkout pre-promo-stable -- web/
git commit -m "Roll back hosted page to pre-promo-stable"
git push origin main
```

After pushing, confirm the Pages deploy succeeded, then verify the live page:
```bash
curl -s "https://developerbilions.github.io/AOG-Kiosk-App/kiosk.html?cb=$(date +%s)" | grep -c "scene media"
# 0 = promo removed (rolled back); >0 = promo still present
```

## APK rollback (native changes only)

Hosted rollback can't undo native APK changes (WebView cache mode, bridge, etc.).
Signed release APKs are kept in `dist/` (`AOG-Kiosk-v1.x-release.apk`); sideload an
earlier one to roll a device's native layer back. versionCode must be ≥ installed,
so downgrading may require an uninstall first.
