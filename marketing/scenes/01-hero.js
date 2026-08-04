/* Hero compositions — the top-of-page, top-of-deck shots. */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const ic = (n) => window.icon(n);
  const D = () => window.DATA;

  const lockup = (light) => `
    <div class="lockup">
      <img src="${window.LOGO}" alt="">
      <div>
        <div class="wm">${window.BRAND.name}</div>
        <div class="tag-line">Business Suite</div>
      </div>
    </div>`;

  const metric = (n, k) => `<div class="metric"><div class="n">${n}</div><div class="k">${k}</div></div>`;

  /* ── 1. Primary hero — centred headline over the real dashboard ──────── */

  S['hero-primary'] = {
    w: 2400, h: 1350, scale: 1,
    html: () => `
    <div class="canvas bg-dark grid-lines noise" style="width:2400px;height:1350px">
      <div class="orb green" style="width:900px;height:900px;left:-180px;top:-320px;opacity:.5"></div>
      <div class="orb teal" style="width:820px;height:820px;right:-160px;top:-220px;opacity:.45"></div>
      <div class="orb blue" style="width:700px;height:700px;left:50%;bottom:-420px;transform:translateX(-50%);opacity:.3"></div>

      <div class="abs" style="top:64px;left:80px">${lockup()}</div>
      <div class="abs flexc g32" style="top:78px;right:80px;font-size:15px;font-weight:600;color:rgba(255,255,255,.5)">
        <span>Platform</span><span>Automation</span><span>Pricing</span>
        <span class="cta" style="padding:12px 22px;font-size:15px">Book a demo</span>
      </div>

      <div class="abs vstack" style="top:190px;left:50%;transform:translateX(-50%);align-items:center;text-align:center;width:1500px">
        <div class="eyebrow"><i class="dot"></i>AI-Powered WhatsApp Business Platform</div>
        <h1 class="display" style="margin-top:30px">
          Every customer conversation.<br><span class="accent">One intelligent workspace.</span>
        </h1>
        <p class="lead" style="margin-top:26px;max-width:900px">
          Shared WhatsApp inbox, AI that qualifies and replies, a full CRM pipeline and
          campaign analytics — running as one platform for your whole team.
        </p>
        <div class="flexc g16" style="margin-top:38px">
          <span class="cta">${ic('play')}Watch the product tour</span>
          <span class="cta ghost">${ic('arrow-right')}Start free trial</span>
        </div>
      </div>

      <!-- The product itself: real dashboard, real browser chrome, bleeding off the bottom -->
      <div class="abs" style="left:50%;top:706px;transform:translateX(-50%)">
        ${window.DEV.browser(window.UI.dashboard(true), 1560, window.DEV.DESKTOP, { dark: true })}
      </div>

      <!-- Floating proof points, lifted off the product plane -->
      <div class="glass abs" style="left:118px;top:754px;width:290px;padding:24px">
        <div class="flexc g12" style="margin-bottom:16px">
          <span style="display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:rgba(37,211,102,.14);color:#3FE07C">${ic('bot')}</span>
          <div style="font-size:14px;font-weight:700">AI Assistant</div>
        </div>
        ${metric('68%', 'of chats resolved without an agent')}
      </div>

      <div class="glass abs" style="left:64px;top:1020px;width:330px;padding:24px">
        <div style="font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.42);margin-bottom:14px">Response time</div>
        <div class="flexc between">
          ${metric('8s', 'AI first reply')}
          ${metric('2m 14s', 'team average')}
        </div>
      </div>

      <div class="glass abs" style="right:112px;top:778px;width:300px;padding:24px">
        <div class="flexc g12" style="margin-bottom:16px">
          <span style="display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:rgba(139,92,246,.16);color:#C4B5FD">${ic('target')}</span>
          <div style="font-size:14px;font-weight:700">Pipeline</div>
        </div>
        ${metric('$486,200', 'attributed to WhatsApp')}
      </div>

      <div class="glass abs" style="right:64px;top:1034px;width:340px;padding:22px 24px">
        <div class="flexc g12">
          <span class="cl-av" style="height:38px;width:38px;background:linear-gradient(135deg,#25D366,#128C7E)">AM</span>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700">Ahmed Al Mansoori</div>
            <div style="font-size:12.5px;color:rgba(255,255,255,.45);margin-top:2px">Qualified by AI · score 92</div>
          </div>
          <span style="color:#3FE07C">${ic('check-check')}</span>
        </div>
      </div>
    </div>`,
  };

  /* ── 2. Split hero — "One Inbox. Every Conversation." ────────────────── */

  S['hero-inbox'] = {
    w: 2400, h: 1350, scale: 1,
    html: () => `
    <div class="canvas bg-dark noise" style="width:2400px;height:1350px">
      <div class="orb green" style="width:1000px;height:1000px;right:-260px;top:-260px;opacity:.42"></div>
      <div class="orb teal" style="width:760px;height:760px;left:-240px;bottom:-300px;opacity:.4"></div>

      <div class="abs" style="top:66px;left:88px">${lockup()}</div>

      <div class="abs vstack" style="left:88px;top:330px;width:880px">
        <div class="eyebrow"><i class="dot"></i>Shared Team Inbox</div>
        <h1 class="display" style="margin-top:28px;font-size:82px">One inbox.<br><span class="accent">Every conversation.</span></h1>
        <p class="lead" style="margin-top:26px;max-width:720px">
          Your whole team works the same WhatsApp line — with assignment, internal notes,
          tags and a full customer history attached to every thread.
        </p>

        <div class="vstack g20" style="margin-top:46px">
          <div class="feat">
            <span class="bx">${ic('users-round')}</span>
            <div><div class="t">Multi-agent, zero collisions</div>
            <div class="d">Round-robin assignment with working hours and typing presence.</div></div>
          </div>
          <div class="feat">
            <span class="bx">${ic('sparkles')}</span>
            <div><div class="t">AI drafts the first reply</div>
            <div class="d">Answers from your knowledge base in 8 seconds, day or night.</div></div>
          </div>
          <div class="feat">
            <span class="bx">${ic('briefcase-business')}</span>
            <div><div class="t">CRM context in the thread</div>
            <div class="d">Deal stage, value, notes and timeline beside every message.</div></div>
          </div>
        </div>

        <div class="flexc g24" style="margin-top:52px">
          ${metric('38', 'open conversations')}
          <div style="width:1px;height:52px;background:rgba(255,255,255,.12)"></div>
          ${metric('94.6%', 'resolution rate')}
          <div style="width:1px;height:52px;background:rgba(255,255,255,.12)"></div>
          ${metric('5', 'agents online')}
        </div>
      </div>

      <!-- Real inbox, angled slightly so the depth reads without distorting the UI -->
      <div class="abs" style="right:-200px;top:236px;transform:perspective(2600px) rotateY(-13deg) rotateX(3deg) rotateZ(-1deg)">
        ${window.DEV.macbook(window.UI.inbox(true), 1460)}
      </div>
    </div>`,
  };

  /* ── 3. Light hero — Studio Display, for light-background contexts ───── */

  S['hero-light'] = {
    w: 2400, h: 1350, scale: 1,
    html: () => `
    <div class="canvas bg-light grid-lines" style="width:2400px;height:1350px">
      <div class="orb green" style="width:820px;height:820px;right:-200px;top:-280px;opacity:.35"></div>
      <div class="orb blue" style="width:640px;height:640px;left:-200px;bottom:-260px;opacity:.3"></div>

      <div class="abs" style="top:64px;left:80px">${lockup(true)}</div>

      <div class="abs vstack" style="top:142px;left:50%;transform:translateX(-50%);align-items:center;text-align:center;width:1400px">
        <div class="eyebrow"><i class="dot"></i>Built for teams that sell on WhatsApp</div>
        <h1 class="display" style="margin-top:26px;font-size:68px;color:#06281A">
          Turn conversations into <span class="accent">revenue.</span>
        </h1>
        <p class="lead" style="margin-top:22px;max-width:820px">
          Every chat becomes a contact, every contact a pipeline stage, every campaign a
          number you can act on.
        </p>
        <div class="flexc g12" style="margin-top:26px">
          <span class="tagpill">${ic('shield-check')}Role-based access</span>
          <span class="tagpill">${ic('globe')}English &amp; Arabic, RTL-native</span>
          <span class="tagpill">${ic('zap')}Real-time sync</span>
          <span class="tagpill">${ic('database')}Full audit log</span>
        </div>
      </div>

      <!-- Sized so the stand and foot stay inside the canvas: a monitor cropped
           at the neck reads as a floating rectangle, not a desk setup. -->
      <div class="abs" style="left:50%;top:508px;transform:translateX(-50%)">
        ${window.DEV.studioDisplay(window.UI.dashboard(false), 1060)}
      </div>
    </div>`,
  };
})();
