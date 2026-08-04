/*
 * Covers and social cards.
 *
 * Each is built to its platform's real crop, not a generic rectangle: the
 * LinkedIn banner keeps its centre clear of the avatar cut-out, the OG card
 * survives being shown at 300px wide in a chat preview, and the GitHub banner
 * reads at README width.
 *
 * These export at 2× (small canvases), so the file sizes stay retina-sharp.
 */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const ic = (n) => window.icon(n);
  const UI = () => window.UI;
  const DEV = () => window.DEV;

  const lockup = (size = 1) => `
    <div class="lockup" style="gap:${14 * size}px">
      <img src="${window.LOGO}" alt="" style="width:${46 * size}px;height:${46 * size}px;border-radius:${15 * size}px">
      <div>
        <div class="wm" style="font-size:${20 * size}px">${window.BRAND.name}</div>
        <div class="tag-line" style="font-size:${11 * size}px">Business Suite</div>
      </div>
    </div>`;

  /* ── OpenGraph / Twitter card — 1200×630 ─────────────────────────────── */

  S['og-image'] = {
    w: 1200, h: 630, scale: 2,
    html: () => `
    <div class="canvas bg-dark noise" style="width:1200px;height:630px">
      <div class="orb green" style="width:560px;height:560px;right:-140px;top:-180px;opacity:.5"></div>
      <div class="orb teal" style="width:420px;height:420px;left:-140px;bottom:-160px;opacity:.4"></div>

      <div class="abs" style="top:52px;left:64px">${lockup(0.85)}</div>

      <div class="abs vstack" style="left:64px;top:186px;width:660px">
        <h1 class="display" style="font-size:52px;line-height:1.06">
          Every conversation.<br><span class="accent">One workspace.</span>
        </h1>
        <p class="body" style="margin-top:18px;font-size:18px;max-width:520px">
          AI-powered WhatsApp inbox, CRM, automation and analytics for teams that sell on chat.
        </p>
        <div class="flexc g10" style="margin-top:26px">
          <span class="tagpill" style="padding:7px 13px;font-size:12.5px">${ic('bot')}AI replies</span>
          <span class="tagpill" style="padding:7px 13px;font-size:12.5px">${ic('users-round')}Shared inbox</span>
          <span class="tagpill" style="padding:7px 13px;font-size:12.5px">${ic('target')}Pipeline</span>
        </div>
      </div>

      <div class="abs" style="right:-190px;top:150px;transform:perspective(1600px) rotateY(-16deg) rotateX(4deg)">
        ${DEV().browser(UI().dashboard(true), 720, DEV().DESKTOP, { dark: true })}
      </div>
    </div>`,
  };

  /* ── GitHub README banner — 1280×640 ─────────────────────────────────── */

  S['github-banner'] = {
    w: 1280, h: 640, scale: 2,
    html: () => `
    <div class="canvas bg-dark grid-lines noise" style="width:1280px;height:640px">
      <div class="orb green" style="width:620px;height:620px;left:50%;top:-200px;transform:translateX(-50%);opacity:.42"></div>

      <div class="abs vstack" style="left:50%;top:76px;transform:translateX(-50%);align-items:center;text-align:center;width:1080px">
        <img src="${window.LOGO}" style="width:70px;height:70px;border-radius:22px;box-shadow:0 16px 40px -12px rgba(13,77,46,.9)">
        <h1 class="display" style="margin-top:24px;font-size:50px">${window.BRAND.name}<span class="accent"> · Business Suite</span></h1>
        <p class="body" style="margin-top:14px;font-size:17px;max-width:760px">
          AI-powered WhatsApp automation &amp; CRM platform — shared inbox, lead qualification,
          workflow automation, broadcasts and analytics.
        </p>
        <div class="flexc g10" style="margin-top:22px">
          <span class="tagpill" style="padding:6px 13px;font-size:12.5px">${ic('zap')}Next.js 16</span>
          <span class="tagpill" style="padding:6px 13px;font-size:12.5px">${ic('database')}Prisma · PostgreSQL</span>
          <span class="tagpill" style="padding:6px 13px;font-size:12.5px">${ic('message-square')}Baileys</span>
          <span class="tagpill" style="padding:6px 13px;font-size:12.5px">${ic('globe')}EN / AR RTL</span>
        </div>
      </div>

      <div class="abs" style="left:50%;top:436px;transform:translateX(-50%)">
        ${DEV().browser(UI().dashboard(true), 980, DEV().DESKTOP, { dark: true })}
      </div>
    </div>`,
  };

  /* ── LinkedIn cover — 1584×396 ───────────────────────────────────────── */

  S['linkedin-cover'] = {
    w: 1584, h: 396, scale: 2,
    html: () => `
    <div class="canvas bg-exec noise" style="width:1584px;height:396px">
      <div class="orb green" style="width:520px;height:520px;right:-120px;top:-200px;opacity:.5"></div>
      <div class="orb teal" style="width:380px;height:380px;left:180px;bottom:-220px;opacity:.4"></div>

      <!-- The avatar punches a hole at roughly x 100–260 on the lower-left;
           nothing important goes there. -->
      <div class="abs vstack" style="left:432px;top:96px;width:720px">
        <div class="flexc g12">
          <img src="${window.LOGO}" style="width:38px;height:38px;border-radius:12px">
          <span style="font-size:17px;font-weight:800;letter-spacing:-.01em">${window.BRAND.name} · Business Suite</span>
        </div>
        <h2 class="title" style="margin-top:18px;font-size:36px">
          AI-powered WhatsApp automation <span class="accent">&amp; CRM</span>
        </h2>
        <p class="body" style="margin-top:12px;font-size:15px;max-width:640px">
          Shared inbox · AI assistant · Pipeline · Broadcasts · Analytics
        </p>
      </div>

      <div class="abs" style="right:-40px;top:56px;transform:perspective(1400px) rotateY(-15deg) rotateX(4deg)">
        ${DEV().browser(UI().inbox(true), 520, DEV().DESKTOP, { dark: true })}
      </div>
    </div>`,
  };

  /* ── Behance project cover — 1400×768 ────────────────────────────────── */

  S['behance-cover'] = {
    w: 1400, h: 768, scale: 2,
    html: () => `
    <div class="canvas bg-dark noise" style="width:1400px;height:768px">
      <div class="orb green" style="width:700px;height:700px;left:50%;top:120px;transform:translateX(-50%);opacity:.34"></div>

      <div class="abs vstack" style="left:50%;top:88px;transform:translateX(-50%);align-items:center;text-align:center;width:1100px">
        <div class="eyebrow" style="font-size:11px;padding:7px 14px 7px 11px">
          <i class="dot"></i>SaaS Product Design · Case Study
        </div>
        <h1 class="display" style="margin-top:22px;font-size:60px;line-height:1.04">
          ${window.BRAND.name}<br><span class="accent">Business Suite</span>
        </h1>
        <p class="body" style="margin-top:16px;font-size:17px;max-width:700px">
          Designing and building an AI-powered WhatsApp automation &amp; CRM platform —
          from shared inbox to revenue analytics.
        </p>
      </div>

      <!-- Three devices, overlapping, cropped by the bottom edge -->
      <div class="abs" style="left:96px;top:452px;transform:rotate(-4deg)">
        ${DEV().iphone(UI().mobileChat(true), 190)}
      </div>
      <div class="abs" style="left:50%;top:406px;transform:translateX(-50%)">
        ${DEV().macbook(UI().dashboard(true), 800)}
      </div>
      <div class="abs" style="right:80px;top:466px;transform:rotate(4deg)">
        ${DEV().iphone(UI().mobileInbox(true), 190)}
      </div>
    </div>`,
  };

  /* ── Portfolio / Dribbble square-ish cover — 1600×1200 ───────────────── */

  S['portfolio-cover'] = {
    w: 1600, h: 1200, scale: 1.5,
    html: () => `
    <div class="canvas bg-dark grid-lines noise" style="width:1600px;height:1200px">
      <div class="orb green" style="width:800px;height:800px;left:50%;top:-180px;transform:translateX(-50%);opacity:.4"></div>
      <div class="orb violet" style="width:520px;height:520px;right:-140px;bottom:-160px;opacity:.4"></div>

      <div class="abs vstack" style="left:50%;top:96px;transform:translateX(-50%);align-items:center;text-align:center;width:1200px">
        ${lockup(1.1)}
        <h1 class="display" style="margin-top:38px;font-size:64px;line-height:1.05">
          An AI-powered<br>WhatsApp <span class="accent">business platform.</span>
        </h1>
        <p class="lead" style="margin-top:22px;max-width:780px;font-size:19px">
          Shared team inbox, AI lead qualification, CRM pipeline, workflow automation,
          broadcast campaigns and executive analytics.
        </p>
      </div>

      <div class="abs" style="left:50%;top:566px;transform:translateX(-50%)">
        ${DEV().macbook(UI().dashboard(true), 1080)}
      </div>
      <div class="abs" style="left:120px;top:748px;transform:rotate(-6deg)">
        ${DEV().iphone(UI().mobileInbox(true), 230)}
      </div>
      <div class="abs" style="right:120px;top:748px;transform:rotate(6deg)">
        ${DEV().iphone(UI().mobileDashboard(false), 230)}
      </div>

      <div class="abs flexc g12" style="left:50%;bottom:56px;transform:translateX(-50%)">
        <span class="tagpill" style="padding:8px 15px;font-size:13px">${ic('bot')}AI</span>
        <span class="tagpill" style="padding:8px 15px;font-size:13px">${ic('message-square')}Inbox</span>
        <span class="tagpill" style="padding:8px 15px;font-size:13px">${ic('users')}CRM</span>
        <span class="tagpill" style="padding:8px 15px;font-size:13px">${ic('workflow')}Automation</span>
        <span class="tagpill" style="padding:8px 15px;font-size:13px">${ic('bar-chart-3')}Analytics</span>
      </div>
    </div>`,
  };

  /* ── Dribbble shot — 1600×1200, product-forward ──────────────────────── */

  S['dribbble-shot'] = {
    w: 1600, h: 1200, scale: 1.5,
    html: () => `
    <div class="canvas bg-light grid-lines" style="width:1600px;height:1200px">
      <div class="orb green" style="width:640px;height:640px;right:-160px;top:-180px;opacity:.32"></div>
      <div class="orb blue" style="width:520px;height:520px;left:-160px;bottom:-180px;opacity:.28"></div>

      <div class="abs flexc between" style="left:80px;right:80px;top:72px">
        ${lockup(0.95)}
        <span class="tagpill">${ic('sparkles')}AI Customer Support</span>
      </div>

      <div class="abs vstack" style="left:80px;top:210px;width:900px">
        <h2 class="title" style="font-size:52px">Shared inbox,<br><span class="accent">with a brain.</span></h2>
        <p class="lead" style="margin-top:20px;max-width:620px">
          Real conversations, real CRM context, and an assistant that answers before
          anyone opens the tab.
        </p>
      </div>

      <div class="float abs" style="left:80px;top:470px;box-shadow:0 50px 100px -34px rgba(6,40,26,.42)">
        ${DEV().crop(UI().inbox(false), { x: 248, y: 62, w: 1192, h: 838 }, 1120)}
      </div>

      <div class="glass abs" style="right:80px;top:428px;width:320px;padding:24px">
        <div class="flexc g12" style="margin-bottom:14px">
          <span style="display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:rgba(22,163,74,.12);color:#15803D">${ic('timer')}</span>
          <div style="font-size:14px;font-weight:700">First response</div>
        </div>
        <div class="metric"><div class="n" style="font-size:40px">8s</div><div class="k">AI · down from 2m 14s</div></div>
      </div>
    </div>`,
  };
})();
