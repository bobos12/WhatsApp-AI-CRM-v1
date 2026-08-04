/*
 * Enterprise presentation slides — 1920×1080.
 *
 * The structural slides of a deck: title, the problem, the platform map, a
 * comparison, the numbers, security, and a close. They pair with the
 * sales-statement slides in 04-sales.js to make one continuous deck.
 */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const ic = (n) => window.icon(n);
  const UI = () => window.UI;
  const DEV = () => window.DEV;

  const W = 1920, H = 1080;

  const mark = () => `
    <div class="abs flexc g10" style="left:72px;bottom:56px;opacity:.7">
      <img src="${window.LOGO}" style="width:26px;height:26px;border-radius:9px">
      <span style="font-size:14px;font-weight:700;letter-spacing:-.01em">${window.BRAND.name}</span>
    </div>`;

  const pageNo = (n) => `
    <div class="abs" style="right:72px;bottom:56px;font-size:14px;font-weight:600;opacity:.4">${n}</div>`;

  /* ── Title slide ─────────────────────────────────────────────────────── */

  S['slide-title'] = {
    w: W, h: H, scale: 1,
    html: () => `
    <div class="canvas bg-exec noise" style="width:${W}px;height:${H}px">
      <div class="orb green" style="width:900px;height:900px;right:-220px;top:-260px;opacity:.5"></div>
      <div class="orb teal" style="width:700px;height:700px;left:-220px;bottom:-260px;opacity:.4"></div>

      <div class="abs vstack" style="left:120px;top:300px;width:880px">
        <div class="lockup" style="margin-bottom:56px">
          <img src="${window.LOGO}" alt="" style="width:64px;height:64px;border-radius:20px">
          <div>
            <div class="wm" style="font-size:26px">${window.BRAND.name}</div>
            <div class="tag-line" style="font-size:12px">Business Suite</div>
          </div>
        </div>
        <h1 class="display" style="font-size:70px">
          The AI-powered<br>WhatsApp platform<br>for <span class="accent">revenue teams.</span>
        </h1>
        <p class="lead" style="margin-top:30px;max-width:700px;font-size:20px">
          Shared inbox · AI assistant · CRM · Automation · Broadcasts · Analytics
        </p>
      </div>

      <div class="abs" style="right:-320px;top:170px;transform:perspective(2600px) rotateY(-18deg) rotateX(4deg)">
        ${DEV().macbook(UI().dashboard(true), 1240)}
      </div>

      <div class="abs flexc g24" style="left:124px;bottom:130px">
        <div class="metric"><div class="n" style="font-size:34px">2,847</div><div class="k">contacts</div></div>
        <div style="width:1px;height:46px;background:rgba(255,255,255,.14)"></div>
        <div class="metric"><div class="n" style="font-size:34px">18,420</div><div class="k">messages / month</div></div>
        <div style="width:1px;height:46px;background:rgba(255,255,255,.14)"></div>
        <div class="metric"><div class="n" style="font-size:34px">$486K</div><div class="k">pipeline</div></div>
      </div>
      ${mark()}
    </div>`,
  };

  /* ── The problem ─────────────────────────────────────────────────────── */

  S['slide-problem'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const pain = (icon, t, d) => `
        <div class="glass" style="width:392px;padding:28px;display:flex;flex-direction:column;gap:16px">
          <span style="display:grid;place-items:center;width:48px;height:48px;border-radius:15px;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.24);color:#FCA5A5">${ic(icon)}</span>
          <div>
            <div style="font-size:19px;font-weight:700;letter-spacing:-.01em">${t}</div>
            <div style="margin-top:8px;font-size:15px;line-height:1.6;color:rgba(255,255,255,.52)">${d}</div>
          </div>
        </div>`;

      return `
      <div class="canvas bg-dark noise" style="width:${W}px;height:${H}px">
        <div class="orb green" style="width:700px;height:700px;right:-200px;bottom:-260px;opacity:.3"></div>

        <div class="abs vstack" style="left:120px;top:150px;width:1200px">
          <div class="eyebrow"><i class="dot"></i>The problem</div>
          <h2 class="title" style="margin-top:26px;font-size:56px">
            WhatsApp runs the business.<br>Nothing runs <span class="accent">WhatsApp.</span>
          </h2>
          <p class="lead" style="margin-top:22px;max-width:900px;font-size:19px">
            Most teams sell on a phone that lives in one person's pocket. The moment
            volume arrives, everything that matters becomes invisible.
          </p>
        </div>

        <div class="abs flexc g24" style="left:120px;top:560px">
          ${pain('phone', 'One phone, one person', 'The number is tied to a device and a human. Holidays and turnover become outages.')}
          ${pain('eye', 'No record of anything', 'Quotes, promises and objections live in a chat log nobody else can search.')}
          ${pain('clock', 'Answers arrive too late', 'Nights and weekends are dead air, and the customer has already asked a competitor.')}
        </div>

        <div class="abs flexc g16" style="left:120px;bottom:150px">
          <span class="tagpill">${ic('alert-triangle')}No assignment</span>
          <span class="tagpill">${ic('alert-triangle')}No pipeline</span>
          <span class="tagpill">${ic('alert-triangle')}No analytics</span>
          <span class="tagpill">${ic('alert-triangle')}No audit trail</span>
        </div>
        ${mark()}${pageNo('02')}
      </div>`;
    },
  };

  /* ── Platform map (product overview graphic) ─────────────────────────── */

  S['slide-platform-map'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const module = (icon, name, items, tint) => `
        <div class="glass" style="width:340px;padding:24px">
          <div class="flexc g12">
            <span style="display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:${tint};color:#fff">${ic(icon)}</span>
            <div style="font-size:18px;font-weight:700;letter-spacing:-.01em">${name}</div>
          </div>
          <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
            ${items.map((i) => `
              <div class="flexc g8" style="font-size:13.5px;color:rgba(255,255,255,.6)">
                <span style="width:4px;height:4px;border-radius:999px;background:rgba(37,211,102,.7);flex:none"></span>${i}
              </div>`).join('')}
          </div>
        </div>`;

      return `
      <div class="canvas bg-dark grid-lines noise" style="width:${W}px;height:${H}px">
        <div class="orb green" style="width:900px;height:900px;left:50%;top:120px;transform:translateX(-50%);opacity:.26"></div>

        <div class="abs vstack" style="left:50%;transform:translateX(-50%);top:96px;align-items:center;text-align:center;width:1200px">
          <div class="eyebrow"><i class="dot"></i>Platform overview</div>
          <h2 class="title" style="margin-top:22px;font-size:52px">Six systems. One platform.</h2>
        </div>

        <div class="abs" style="left:50%;transform:translateX(-50%);top:300px;display:grid;grid-template-columns:repeat(3,340px);gap:28px">
          ${module('message-square', 'Shared Inbox', ['Multi-agent assignment', 'Rich media & templates', 'Internal notes', 'Real-time presence'], 'linear-gradient(135deg,#25D366,#128C7E)')}
          ${module('sparkles', 'AI Layer', ['Customer support bot', 'Lead qualification', 'Conversation summaries', 'Knowledge base'], 'linear-gradient(135deg,#8B5CF6,#6D28D9)')}
          ${module('users', 'CRM', ['Contacts & custom fields', 'Deals & pipeline', 'Tags & segments', 'Activity timeline'], 'linear-gradient(135deg,#3B82F6,#1D4ED8)')}
          ${module('workflow', 'Automation', ['Trigger-based workflows', 'Follow-up sequences', 'Lead routing rules', 'Auto-replies'], 'linear-gradient(135deg,#F59E0B,#D97706)')}
          ${module('megaphone', 'Campaigns', ['Bulk broadcasts', 'Scheduled sends', 'Segment targeting', 'Delivery tracking'], 'linear-gradient(135deg,#EC4899,#BE185D)')}
          ${module('bar-chart-3', 'Analytics', ['Team performance', 'Campaign results', 'Conversion & revenue', 'AI effectiveness'], 'linear-gradient(135deg,#14B8A6,#0F766E)')}
        </div>

        <div class="abs flexc g16" style="left:50%;transform:translateX(-50%);bottom:120px">
          <span class="tagpill">${ic('shield-check')}Role-based access</span>
          <span class="tagpill">${ic('building-2')}Multi-tenant</span>
          <span class="tagpill">${ic('globe')}EN / AR, RTL-native</span>
          <span class="tagpill">${ic('database')}Audit log</span>
          <span class="tagpill">${ic('git-branch')}API access</span>
        </div>
        ${mark()}${pageNo('03')}
      </div>`;
    },
  };

  /* ── Comparison ──────────────────────────────────────────────────────── */

  S['slide-comparison'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const rows = [
        ['Shared team inbox', false, true, true],
        ['Multi-agent assignment', false, true, true],
        ['AI replies from your content', false, false, true],
        ['AI lead qualification & scoring', false, false, true],
        ['Built-in CRM & pipeline', false, true, true],
        ['Workflow automation', false, 'part', true],
        ['Bulk broadcasts with analytics', false, true, true],
        ['Arabic / RTL native', false, 'part', true],
        ['Self-hosted, per-tenant isolation', false, false, true],
      ];

      const cell = (v) => {
        if (v === true) return `<span style="color:#3FE07C;display:flex;justify-content:center">${ic('check')}</span>`;
        if (v === 'part') return `<span style="color:#FBBF24;display:flex;justify-content:center">${ic('minus') || ic('clock')}</span>`;
        return `<span style="color:rgba(255,255,255,.22);display:flex;justify-content:center">${ic('x')}</span>`;
      };

      return `
      <div class="canvas bg-dark noise" style="width:${W}px;height:${H}px">
        <div class="orb green" style="width:800px;height:800px;right:-240px;top:-200px;opacity:.3"></div>

        <div class="abs vstack" style="left:120px;top:110px;width:1200px">
          <div class="eyebrow"><i class="dot"></i>Where it sits</div>
          <h2 class="title" style="margin-top:22px;font-size:50px">What you get, versus what you have</h2>
        </div>

        <div class="glass abs" style="left:120px;top:290px;width:1680px;padding:8px 36px 28px">
          <div style="display:grid;grid-template-columns:1fr 260px 260px 300px;align-items:center;padding:22px 0 18px;border-bottom:1px solid rgba(255,255,255,.12)">
            <div style="font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4)">Capability</div>
            <div style="font-size:15px;font-weight:600;text-align:center;color:rgba(255,255,255,.5)">WhatsApp Business app</div>
            <div style="font-size:15px;font-weight:600;text-align:center;color:rgba(255,255,255,.5)">Generic CRM + plugin</div>
            <div style="font-size:16px;font-weight:800;text-align:center;color:#3FE07C">${window.BRAND.name}</div>
          </div>
          ${rows.map(([label, a, b, c], i) => `
            <div style="display:grid;grid-template-columns:1fr 260px 260px 300px;align-items:center;padding:17px 0;${i < rows.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,.055)' : ''}">
              <div style="font-size:16.5px;font-weight:600">${label}</div>
              ${cell(a)}${cell(b)}
              <div style="background:rgba(37,211,102,.07);border-radius:10px;padding:8px 0">${cell(c)}</div>
            </div>`).join('')}
        </div>
        ${mark()}${pageNo('04')}
      </div>`;
    },
  };

  /* ── Metrics ─────────────────────────────────────────────────────────── */

  S['slide-metrics'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const big = (n, k, d) => `
        <div class="glass" style="width:404px;padding:34px">
          <div class="metric"><div class="n" style="font-size:64px">${n}</div><div class="k" style="font-size:15px;margin-top:12px">${k}</div></div>
          <div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.1);font-size:14px;color:rgba(255,255,255,.45)">${d}</div>
        </div>`;

      return `
      <div class="canvas bg-exec noise" style="width:${W}px;height:${H}px">
        <div class="orb green" style="width:820px;height:820px;left:50%;top:60px;transform:translateX(-50%);opacity:.3"></div>

        <div class="abs vstack" style="left:50%;transform:translateX(-50%);top:120px;align-items:center;text-align:center;width:1200px">
          <div class="eyebrow"><i class="dot"></i>Results</div>
          <h2 class="title" style="margin-top:22px;font-size:54px">What changes in the first quarter</h2>
        </div>

        <div class="abs flexc g24" style="left:50%;transform:translateX(-50%);top:340px">
          ${big('68%', 'of chats resolved by AI', 'Agents keep the conversations where judgement matters.')}
          ${big('8s', 'average first response', 'Down from 2m 14s, measured across the same queue.')}
          ${big('+27%', 'attributed revenue', 'Pipeline traced back to the conversation that opened it.')}
        </div>
        <div class="abs flexc g24" style="left:50%;transform:translateX(-50%);top:660px">
          ${big('94.6%', 'resolution rate', 'Threads closed rather than abandoned in the queue.')}
          ${big('98.4%', 'broadcast delivery', 'Across 18,420 messages, with warm-up pacing on.')}
          ${big('5 → 1', 'tools consolidated', 'Inbox, CRM, automation, campaigns and reporting in one.')}
        </div>
        ${mark()}${pageNo('05')}
      </div>`;
    },
  };

  /* ── Security & architecture ─────────────────────────────────────────── */

  S['slide-security'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const item = (icon, t, d) => `
        <div class="feat" style="width:520px">
          <span class="bx">${ic(icon)}</span>
          <div><div class="t">${t}</div><div class="d">${d}</div></div>
        </div>`;

      return `
      <div class="canvas bg-dark grid-lines noise" style="width:${W}px;height:${H}px">
        <div class="orb teal" style="width:760px;height:760px;right:-220px;top:-180px;opacity:.34"></div>

        <div class="abs vstack" style="left:120px;top:130px;width:1200px">
          <div class="eyebrow"><i class="dot"></i>Architecture &amp; governance</div>
          <h2 class="title" style="margin-top:22px;font-size:52px">Enterprise-ready underneath</h2>
          <p class="lead" style="margin-top:20px;max-width:900px;font-size:19px">
            Multi-tenant from the data layer up, with role-based access and a complete
            audit trail — deployed once, isolated per client.
          </p>
        </div>

        <div class="abs" style="left:120px;top:470px;display:grid;grid-template-columns:520px 520px;gap:36px 80px">
          ${item('building-2', 'True multi-tenancy', 'Every query is tenant-scoped at the ORM layer, not by convention.')}
          ${item('shield-check', 'Role-based access control', 'Admin, team lead and agent scopes, enforced server-side.')}
          ${item('database', 'Full audit log', 'Assignments, edits, sends and permission changes, attributable.')}
          ${item('zap', 'Real-time by default', 'WebSocket delivery for messages, presence and counters.')}
          ${item('globe', 'Bilingual, RTL-native', 'English and Arabic across every screen, not a translation layer.')}
          ${item('git-branch', 'API access &amp; webhooks', 'Push events into the systems you already run.')}
        </div>
        ${mark()}${pageNo('06')}
      </div>`;
    },
  };

  /* ── Close ───────────────────────────────────────────────────────────── */

  S['slide-cta'] = {
    w: W, h: H, scale: 1,
    html: () => `
    <div class="canvas bg-exec noise" style="width:${W}px;height:${H}px">
      <div class="orb green" style="width:1000px;height:1000px;left:50%;top:50%;transform:translate(-50%,-50%);opacity:.34"></div>

      <div class="abs vstack" style="left:50%;top:50%;transform:translate(-50%,-50%);align-items:center;text-align:center;width:1300px">
        <img src="${window.LOGO}" style="width:88px;height:88px;border-radius:28px;box-shadow:0 20px 50px -14px rgba(13,77,46,.9)">
        <h2 class="title" style="margin-top:44px;font-size:66px">
          Every conversation.<br><span class="accent">Every customer. One platform.</span>
        </h2>
        <p class="lead" style="margin-top:28px;max-width:800px;font-size:21px">
          See it running against your own WhatsApp line in under an hour.
        </p>
        <div class="flexc g16" style="margin-top:48px">
          <span class="cta">${ic('play')}Book a live demo</span>
          <span class="cta ghost">${ic('mail')}hello@whatsapp-crm.io</span>
        </div>
      </div>
      ${mark()}${pageNo('07')}
    </div>`,
  };
})();
