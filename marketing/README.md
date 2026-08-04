# Marketing assets

Premium marketing imagery for **WhatsApp CRM · Business Suite**, generated from
the application's own design system.

Everything in `out/` is produced by a build, not drawn by hand:

```bash
node marketing/tools/gen-icons.mjs    # refresh icon geometry from lucide-react
node marketing/tools/gen-fonts.mjs    # re-embed the product's webfonts
node marketing/tools/render.mjs       # render every asset  → marketing/out/
node marketing/tools/render.mjs hero  # render only names containing "hero"
```

Rendering needs Chrome or Edge (found automatically) and takes ~3 minutes for the
full set.

---

## How the screens are produced

**These are not photographs of a running server, and they are not invented UI.**

Each screen is rebuilt from the application's own source of truth and rendered in
headless Chrome:

| Input | Source |
| --- | --- |
| Colours, radii, shadows, spacing | `apps/frontend/tailwind.config.js` |
| CSS variables, chat wallpaper, dark theme | `apps/frontend/app/globals.css` |
| Component structure and geometry | the matching `.tsx` under `apps/frontend/components/` |
| Icons | `lucide-react` — the same package and version the app imports |
| Labels and captions | `apps/frontend/locales/en/*.json` |
| Logo | `apps/frontend/public/icons/logo-tight.png` |

The alternative — booting Postgres, Redis, the backend and a live WhatsApp
session purely to screenshot it — would have produced empty states, and would
have to be re-staged by hand every time an asset needed a tweak. Building from
source means the assets are reproducible, and any drift from the real app is a
fixable bug in `kit/product.css` rather than a lost afternoon.

**When the product changes,** update the matching function in `kit/ui.js` and the
matching rules in `kit/product.css`, then re-render. That is the whole
maintenance loop.

### The data on screen

All screens show one consistent fictional tenant — *Marina Interiors*, a Dubai
fit-out company — so the dashboard's 2,847 contacts, the inbox threads and the
pipeline's $486,200 all describe the same business across every asset. Edit
`kit/data.js` to swap in your own numbers, names, or a real customer's data.

---

## Asset index

All files are PNG in `marketing/out/`.

### Heroes — website and landing page

| File | Size | Use |
| --- | --- | --- |
| `hero-primary.png` | 2400×1350 | Main landing hero. Centred headline over the live dashboard. |
| `hero-inbox.png` | 2400×1350 | "One inbox. Every conversation." Split hero, MacBook. |
| `hero-light.png` | 2400×1350 | Light-background hero on a Studio Display. |

### Product showcases

| File | Size | Use |
| --- | --- | --- |
| `showcase-multidevice.png` | 2400×1350 | MacBook + iPad + iPhone together. |
| `showcase-desktop.png` | 2400×1500 | Full inbox in a browser frame, light. |
| `showcase-mobile.png` | 2400×1500 | Three phones — dashboard, inbox, chat. |
| `showcase-floating-glass.png` | 2400×1350 | Dashboard panels exploded in 3D space. |
| `showcase-workspace.png` | 2400×1500 | Executive desk setup, display + laptop + phone. |

### Feature spotlights

Same template throughout: claim, supporting detail, the real screen, and two
proof metrics. 2400×1500 each.

`feature-ai-support` · `feature-shared-inbox` · `feature-automation` ·
`feature-crm` · `feature-pipeline` · `feature-broadcasts` · `feature-analytics` ·
`feature-knowledge-base` · `feature-team` · `feature-customer-profile` ·
`feature-notifications` · `feature-templates` · `feature-settings`

### Sales visuals — 1920×1080, deck-native

One claim per slide with the product underneath.

| File | Statement |
| --- | --- |
| `sales-one-inbox.png` | One inbox. Every conversation. |
| `sales-ai-never-sleeps.png` | AI that never sleeps. |
| `sales-automate.png` | Automate the sale. |
| `sales-revenue.png` | Turn conversations into revenue. |
| `sales-know-customers.png` | Know your customers. |
| `sales-broadcast.png` | Broadcast at scale. |
| `sales-measure.png` | Measure everything. |

### Presentation slides — 1920×1080

`slide-title` · `slide-problem` · `slide-platform-map` (product overview) ·
`slide-comparison` (feature comparison) · `slide-metrics` · `slide-security` ·
`slide-cta`

Together with the seven sales visuals these form a complete 14-slide deck for
enterprise sales or an investor meeting.

### Covers and social

| File | Size | Platform |
| --- | --- | --- |
| `og-image.png` | 2400×1260 | OpenGraph / Twitter card (renders 1200×630 @2×) |
| `github-banner.png` | 2560×1280 | GitHub README header |
| `linkedin-cover.png` | 3168×792 | LinkedIn page banner — centre-left kept clear of the avatar |
| `behance-cover.png` | 2800×1536 | Behance project cover |
| `portfolio-cover.png` | 2400×1800 | Portfolio / case-study cover |
| `dribbble-shot.png` | 2400×1800 | Dribbble shot, light |

### Clean screens

The product on its own, no marketing frame — for documentation, app listings and
"here is the actual software" slides. Desktop at 2880×1800, mobile at 1170×2532.

`screen-dashboard` · `screen-dashboard-dark` · `screen-inbox` ·
`screen-inbox-light` · `screen-contacts` · `screen-deals` · `screen-automation` ·
`screen-broadcasts` · `screen-analytics` · `screen-ai-config` · `screen-team` ·
`screen-mobile-inbox` · `screen-mobile-chat` · `screen-mobile-dashboard`

---

## Layout of this directory

```
marketing/
  kit/          the design system, as standalone browser assets
    product.css   the app's own look, resolved from Tailwind
    scene.css     the marketing layer: backgrounds, type, device frames
    ui.js         each product screen, rebuilt from its .tsx source
    devices.js    MacBook / Studio Display / iPad / iPhone / browser frames
    data.js       the demo tenant shown on every screen
    icons.js      generated — lucide geometry
    fonts.css     generated — embedded webfonts
    logo.js       generated — the product logo, base64
  scenes/       one file per asset family; each registers on window.SCENES
  tools/        the generators and the renderer
  html/         intermediate pages (regenerated every run, safe to delete)
  out/          the PNGs
```

## Adding an asset

Register a scene in any `scenes/*.js` file:

```js
window.SCENES['my-asset'] = {
  w: 2400, h: 1350, scale: 1,
  html: () => `<div class="canvas bg-dark" style="width:2400px;height:1350px">…</div>`,
};
```

`scale` multiplies the export: a 1200×630 scene at `scale: 2` writes a
2400×1260 file. Use `scale: 1` for canvases already ≥ 2000px wide.

Inside `html()` you have `window.UI` (screens), `window.DEV` (device frames),
`window.DATA` (the demo tenant), `window.icon(name)` and `window.LOGO`.

### One thing to watch

`product.css` and `scene.css` share a global namespace, and the product's class
names win where they overlap — a `.dark` or `.panel` on a marketing element will
silently pick up product styling. The marketing side already renames around the
known collisions (`.canvas`, `.vstack`, `.monitor`, `.browser.night`); if a new
element renders with unexpected colours, check whether its class also exists in
`product.css`.
