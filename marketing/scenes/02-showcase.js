/* Product showcases — device mockups and the exploded-glass composition. */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const ic = (n) => window.icon(n);
  const DEV = () => window.DEV;
  const UI = () => window.UI;

  const lockup = () => `
    <div class="lockup">
      <img src="${window.LOGO}" alt="">
      <div><div class="wm">${window.BRAND.name}</div><div class="tag-line">Business Suite</div></div>
    </div>`;

  const caption = (t, d) => `
    <div class="abs vstack" style="left:50%;transform:translateX(-50%);top:118px;align-items:center;text-align:center;width:1200px">
      <h2 class="title">${t}</h2>
      <p class="lead" style="margin-top:18px;max-width:820px">${d}</p>
    </div>`;

  /* ── Multi-device: the same product, three form factors ──────────────── */

  S['showcase-multidevice'] = {
    w: 2400, h: 1350, scale: 1,
    html: () => `
    <div class="canvas bg-dark noise" style="width:2400px;height:1350px">
      <div class="orb green" style="width:1000px;height:1000px;left:50%;top:180px;transform:translateX(-50%);opacity:.3"></div>
      <div class="abs" style="top:60px;left:80px">${lockup()}</div>
      ${caption('One platform. Every screen.', 'Desktop, tablet and phone share the same real-time data — an agent can start a reply at their desk and finish it on the road.')}

      <!-- Tablet sits behind, laptop leads, phone in front: a clear depth order -->
      <div class="abs" style="left:1418px;top:472px;transform:rotate(4deg)">
        ${DEV().ipad(UI().inbox(false), 720)}
      </div>
      <div class="abs" style="left:262px;top:374px">
        ${DEV().macbook(UI().dashboard(true), 1180)}
      </div>
      <div class="abs" style="left:1160px;top:584px">
        ${DEV().iphone(UI().mobileChat(true), 296)}
      </div>
    </div>`,
  };

  /* ── Desktop mockup, light, browser-framed ───────────────────────────── */

  S['showcase-desktop'] = {
    w: 2400, h: 1500, scale: 1,
    html: () => `
    <div class="canvas bg-light grid-lines" style="width:2400px;height:1500px">
      <div class="orb green" style="width:900px;height:900px;right:-220px;top:-200px;opacity:.3"></div>
      <div class="abs" style="top:60px;left:80px">${lockup()}</div>
      ${caption('The workspace your team lives in', 'A shared WhatsApp inbox with CRM context, AI assistance and campaign analytics — in one browser tab.')}
      <div class="abs" style="left:50%;top:470px;transform:translateX(-50%)">
        ${DEV().browser(UI().inbox(false), 1900, DEV().DESKTOP, { dark: false, url: 'app.whatsapp-crm.io/conversations' })}
      </div>
    </div>`,
  };

  /* ── Mobile: three phones, three jobs ────────────────────────────────── */

  S['showcase-mobile'] = {
    w: 2400, h: 1500, scale: 1,
    html: () => `
    <div class="canvas bg-dark noise" style="width:2400px;height:1500px">
      <div class="orb green" style="width:900px;height:900px;left:50%;top:420px;transform:translateX(-50%);opacity:.32"></div>
      <div class="abs" style="top:60px;left:80px">${lockup()}</div>
      ${caption('Your inbox, in your pocket', 'The installable PWA ships the same inbox, the same CRM and the same push notifications as the desktop app.')}

      <div class="abs" style="left:326px;top:520px;transform:rotate(-7deg)">
        ${DEV().iphone(UI().mobileDashboard(false), 400)}
      </div>
      <div class="abs" style="left:975px;top:452px">
        ${DEV().iphone(UI().mobileInbox(true), 450)}
      </div>
      <div class="abs" style="left:1660px;top:520px;transform:rotate(7deg)">
        ${DEV().iphone(UI().mobileChat(true), 400)}
      </div>

      <div class="abs flexc g16" style="left:50%;top:322px;transform:translateX(-50%)">
        <span class="tagpill">${ic('bell')}Web push notifications</span>
        <span class="tagpill">${ic('zap')}Installable PWA</span>
        <span class="tagpill">${ic('globe')}Works offline-first</span>
      </div>
    </div>`,
  };

  /* ── Floating glass: the UI taken apart ──────────────────────────────── */

  S['showcase-floating-glass'] = {
    w: 2400, h: 1350, scale: 1,
    html: () => {
      const P = UI().parts;
      // Panels are lifted straight out of the dashboard, unchanged, and
      // re-staged in space. The pieces are real; only the arrangement is art.
      // `display:block` overrides .app's flex so the panel fills its wrapper
      // instead of shrink-wrapping and leaving a bare strip beside it.
      const piece = (inner, css, w) =>
        `<div class="float abs" style="${css};width:${w}px">
           <div class="app dark" style="display:block;width:${w}px">${inner}</div>
         </div>`;

      return `
      <div class="canvas bg-dark noise" style="width:2400px;height:1350px">
        <div class="orb green" style="width:1100px;height:1100px;left:44%;top:70px;transform:translateX(-50%);opacity:.34"></div>
        <div class="orb violet" style="width:700px;height:700px;right:60px;bottom:-180px;opacity:.5"></div>

        <div class="abs" style="top:60px;left:80px">${lockup()}</div>

        <div class="abs vstack" style="left:96px;top:356px;width:660px">
          <div class="eyebrow"><i class="dot"></i>Composable workspace</div>
          <h2 class="title" style="margin-top:26px">Every part of the<br>customer picture.</h2>
          <p class="lead" style="margin-top:22px;max-width:560px">
            Pipeline, team workload, message volume and live conversations — all reading
            from the same data, updated over websockets as your team works.
          </p>
        </div>

        <div style="transform:perspective(2400px) rotateY(-16deg) rotateX(6deg);transform-style:preserve-3d;position:absolute;inset:0">
          ${piece(P.pipelineWidget(), 'left:856px;top:196px', 470)}
          ${piece(P.messagesChart(), 'left:1394px;top:404px', 600)}
          ${piece(P.teamPanel(), 'left:790px;top:676px', 460)}
          ${piece(P.recentConversations(), 'left:1320px;top:924px', 500)}
        </div>

        <div class="abs flexc g16" style="left:96px;top:688px">
          <span class="tagpill">${ic('zap')}Real-time</span>
          <span class="tagpill">${ic('users-round')}Multi-agent</span>
          <span class="tagpill">${ic('shield-check')}Audited</span>
        </div>
      </div>`;
    },
  };

  /* ── Executive desk setup ────────────────────────────────────────────── */

  S['showcase-workspace'] = {
    w: 2400, h: 1500, scale: 1,
    html: () => `
    <!-- bg-dark is kept for its text colour; the inline background replaces its
         gradient with the desk's own horizon. -->
    <div class="canvas bg-dark noise" style="width:2400px;height:1500px;background:linear-gradient(180deg,#0B1512 0%,#0A1210 52%,#070D0B 100%)">
      <div class="orb green" style="width:1200px;height:800px;left:50%;top:80px;transform:translateX(-50%);opacity:.24"></div>

      <!-- Desk plane: a soft horizon plus a reflection under the hardware -->
      <div class="abs" style="left:0;right:0;top:1010px;height:490px;background:linear-gradient(180deg,#12201B 0%,#0C1613 40%,#080F0D 100%)"></div>
      <div class="abs" style="left:0;right:0;top:1006px;height:2px;background:linear-gradient(90deg,transparent,rgba(37,211,102,.35),transparent)"></div>

      <div class="abs" style="top:64px;left:88px">${lockup()}</div>
      <div class="abs vstack" style="left:50%;transform:translateX(-50%);top:130px;align-items:center;text-align:center;width:1100px">
        <h2 class="title" style="font-size:46px">Built for the desks that run the business</h2>
      </div>

      <div class="abs" style="left:50%;top:300px;transform:translateX(-50%)">
        ${window.DEV.studioDisplay(UI().analytics(true), 1180)}
      </div>

      <div class="abs" style="left:296px;top:918px;transform:rotate(-3deg)">
        ${DEV().macbook(UI().deals(true), 620)}
      </div>
      <div class="abs" style="right:330px;top:950px;transform:rotate(4deg)">
        ${DEV().iphone(UI().mobileInbox(true), 232)}
      </div>

      <!-- Reflection: the display's glow bleeding onto the desk -->
      <div class="abs" style="left:50%;top:1010px;transform:translateX(-50%);width:1100px;height:180px;background:radial-gradient(ellipse at top,rgba(37,211,102,.14),transparent 70%)"></div>
    </div>`,
  };
})();
