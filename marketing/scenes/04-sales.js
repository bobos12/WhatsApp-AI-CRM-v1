/*
 * Sales-statement visuals — 1920×1080, deck-native.
 *
 * One claim per slide, stated plainly, with the part of the product that makes
 * it true sitting right underneath. These are the slides a founder talks over,
 * so the copy carries the argument and the UI is the evidence, not decoration.
 */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const ic = (n) => window.icon(n);
  const UI = () => window.UI;
  const DEV = () => window.DEV;
  const D = () => window.DATA;

  const W = 1920, H = 1080;

  const mark = (light) => `
    <div class="abs flexc g10" style="left:72px;bottom:56px;opacity:.7">
      <img src="${window.LOGO}" style="width:26px;height:26px;border-radius:9px">
      <span style="font-size:14px;font-weight:700;letter-spacing:-.01em">${window.BRAND.name}</span>
    </div>`;

  const pageNo = (n) => `
    <div class="abs" style="right:72px;bottom:56px;font-size:14px;font-weight:600;opacity:.4">${n}</div>`;

  /**
   * Statement slide: headline block on the left, evidence on the right.
   * `split` is the x where the art column starts.
   */
  function statement({ kicker, head, sub, art, bullets = [], stat, light = false, split = 900, no }) {
    return `
    <div class="canvas ${light ? 'bg-light grid-lines' : 'bg-dark noise'}" style="width:${W}px;height:${H}px">
      <div class="orb green" style="width:760px;height:760px;right:-200px;top:-220px;opacity:${light ? '.28' : '.4'}"></div>
      <div class="orb teal" style="width:520px;height:520px;left:-160px;bottom:-200px;opacity:${light ? '.2' : '.3'}"></div>

      <div class="abs vstack" style="left:72px;top:236px;width:${split - 140}px">
        <div class="eyebrow"><i class="dot"></i>${kicker}</div>
        <h2 class="title" style="margin-top:26px;font-size:60px">${head}</h2>
        <p class="lead" style="margin-top:22px;font-size:20px">${sub}</p>
        ${bullets.length ? `
        <div class="vstack g14" style="margin-top:34px">
          ${bullets.map((b) => `
            <div class="flexc g12" style="font-size:16px;font-weight:600">
              <span style="color:#3FE07C;display:flex">${ic('check')}</span>${b}
            </div>`).join('')}
        </div>` : ''}
        ${stat ? `
        <div class="glass" style="margin-top:40px;padding:22px 26px;align-self:flex-start;min-width:300px">
          <div class="flexc g10" style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.5">
            ${ic(stat[2])}${stat[3]}
          </div>
          <div class="flexc g32" style="margin-top:14px">
            <div class="metric"><div class="n" style="font-size:38px">${stat[0][0]}</div><div class="k">${stat[0][1]}</div></div>
            <div class="metric"><div class="n" style="font-size:38px;opacity:.45">${stat[1][0]}</div><div class="k">${stat[1][1]}</div></div>
          </div>
        </div>` : ''}
      </div>

      <div class="abs" style="left:${split}px;top:0;width:${W - split}px;height:${H}px">${art}</div>
      ${mark(light)}${pageNo(no)}
    </div>`;
  }

  /* ── 1. One Inbox. Every Conversation. ───────────────────────────────── */

  S['sales-one-inbox'] = {
    w: W, h: H, scale: 1,
    html: () => statement({
      no: '01',
      kicker: 'Shared Inbox',
      head: 'One inbox.<br>Every <span class="accent">conversation.</span>',
      sub: 'Sales, support and design work the same WhatsApp number — without two people answering the same customer.',
      bullets: ['Round-robin assignment', 'Internal notes and mentions', 'Tags, filters, saved views'],
      art: `<div class="abs" style="left:-40px;top:150px;transform:perspective(2400px) rotateY(-14deg) rotateX(4deg)">
              ${DEV().browser(UI().inbox(true), 1360, DEV().DESKTOP, { dark: true, url: 'app.whatsapp-crm.io/conversations' })}
            </div>`,
    }),
  };

  /* ── 2. AI That Never Sleeps. ────────────────────────────────────────── */

  S['sales-ai-never-sleeps'] = {
    w: W, h: H, scale: 1,
    html: () => {
      // The evidence here is the conversation itself: a real exchange where the
      // assistant answers, qualifies and hands over.
      const bubbles = D().chat.map((m) => `
        <div class="msg ${m.s}" style="max-width:86%">
          <div class="bub" style="font-size:15px">
            ${m.ai ? `<div class="ai-tag">${ic('sparkles')}AI Assistant</div>` : ''}
            ${m.x}
            <div class="meta">${m.t}${m.s === 'out' ? ic('check-check') : ''}</div>
          </div>
        </div>`).join('');

      return statement({
        no: '02',
        kicker: 'AI Customer Support',
        head: 'AI that<br>never <span class="accent">sleeps.</span>',
        sub: 'Eight seconds to a useful answer, at any hour, in English or Arabic — then a clean handover the moment money is on the table.',
        bullets: ['Grounded in your knowledge base', 'Escalates at your score threshold', '68% of chats never reach an agent'],
        art: `
          <div class="float abs" style="left:20px;top:130px;width:880px;border-radius:22px">
            <div class="app dark" style="display:block;width:880px">
              <div class="chat" style="height:820px">
                <div class="chat-hdr">
                  <span class="cl-av" style="background:linear-gradient(135deg,#25D366,#128C7E)">AM</span>
                  <div><p class="nm">Ahmed Al Mansoori</p><p class="st"><i class="dot"></i>online · +971 50 123 4567</p></div>
                  <div class="acts"><span class="hdr-btn">${ic('sparkles')}</span><span class="hdr-btn">${ic('phone')}</span></div>
                </div>
                <div class="chat-body" style="padding:24px 28px">
                  <div class="day-sep"><span>Today</span></div>
                  ${bubbles}
                </div>
                <div class="composer">
                  <span class="ico">${ic('smile')}</span>
                  <div class="field">Type a message…</div>
                  <span class="send">${ic('send')}</span>
                </div>
              </div>
            </div>
          </div>`,
        stat: [['8s', 'AI first reply'], ['2m 14s', 'human average'], 'timer', 'Response time'],
        split: 880,
      });
    },
  };

  /* ── 3. Automate Sales. ──────────────────────────────────────────────── */

  S['sales-automate'] = {
    w: W, h: H, scale: 1,
    html: () => {
      // The workflow, drawn at slide scale rather than screenshotted, so each
      // step is legible from the back of a room. Steps mirror DATA.flow.
      const step = (n, icon, kind, title, body, tint) => `
        <div class="glass" style="width:560px;padding:22px 24px;display:flex;gap:16px;align-items:flex-start">
          <span style="display:grid;place-items:center;width:46px;height:46px;flex:none;border-radius:15px;background:${tint};color:#fff">${ic(icon)}</span>
          <div style="flex:1">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.42)">${kind}</div>
            <div style="font-size:18px;font-weight:700;margin-top:3px">${title}</div>
            <div style="font-size:14px;line-height:1.5;margin-top:5px;color:rgba(255,255,255,.52)">${body}</div>
          </div>
          <div style="font-size:13px;font-weight:800;color:rgba(255,255,255,.25)">${n}</div>
        </div>`;

      const connector = `
        <div style="width:2px;height:26px;margin-left:95px;background:linear-gradient(180deg,rgba(37,211,102,.6),rgba(37,211,102,.15))"></div>`;

      return statement({
        no: '03',
        kicker: 'Workflow Automation',
        head: 'Automate<br>the <span class="accent">sale.</span>',
        sub: 'A lead arrives, gets qualified, gets routed and gets chased — while your team is asleep or on another call.',
        bullets: ['1,204 runs this month', '98.6% completed without error', 'No engineer required to change it'],
        art: `
          <div class="abs vstack" style="left:60px;top:246px">
            ${step('01', 'message-square', 'Trigger', 'New WhatsApp message', 'An unknown number messages the business line.', 'linear-gradient(135deg,#25D366,#128C7E)')}
            ${connector}
            ${step('02', 'sparkles', 'AI Action', 'Qualify with AI', 'Intent, budget and timeline extracted; lead scored.', 'linear-gradient(135deg,#8B5CF6,#6D28D9)')}
            ${connector}
            ${step('03', 'git-branch', 'Condition', 'Lead score ≥ 70', 'Hot leads split from everything else.', 'linear-gradient(135deg,#F59E0B,#D97706)')}
            ${connector}
            ${step('04', 'users-round', 'Action', 'Assign to Sales', 'Round-robin, inside working hours.', 'linear-gradient(135deg,#3B82F6,#1D4ED8)')}
          </div>`,
        split: 900,
      });
    },
  };

  /* ── 4. Turn Conversations into Revenue. ─────────────────────────────── */

  S['sales-revenue'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const P = UI().parts;
      return statement({
        no: '04',
        kicker: 'Sales Pipeline',
        head: 'Turn conversations<br>into <span class="accent">revenue.</span>',
        sub: 'Every thread carries a deal, a stage and a value — so the pipeline is a by-product of talking to customers, not a second job.',
        bullets: ['$486,200 open pipeline', '32% conversion to closed', 'Attribution back to the first message'],
        art: `
          <div class="float abs" style="left:30px;top:120px;width:470px">
            <div class="app dark" style="display:block;width:470px">${P.pipelineWidget()}</div>
          </div>
          <div class="abs" style="left:100px;top:560px;transform:perspective(2200px) rotateY(-12deg) rotateX(4deg)">
            ${DEV().browser(UI().deals(true), 1120, DEV().DESKTOP, { dark: true, url: 'app.whatsapp-crm.io/deals' })}
          </div>`,
        stat: [['$486,200', 'open pipeline'], ['32%', 'closed rate'], 'circle-dollar-sign', 'Attributed to WhatsApp'],
        split: 880,
      });
    },
  };

  /* ── 5. Know Your Customers. ─────────────────────────────────────────── */

  S['sales-know-customers'] = {
    w: W, h: H, scale: 1,
    html: () => statement({
      no: '05',
      kicker: 'Customer Profiles',
      head: 'Know your<br><span class="accent">customers.</span>',
      sub: 'Summary, deal, tags, notes and a dated timeline — attached to the thread, so nobody starts a conversation from zero.',
      bullets: ['AI summary per conversation', 'Lead score computed, not guessed', 'Every touch, timestamped'],
      art: `
        <div class="float abs" style="left:120px;top:110px;box-shadow:0 50px 100px -34px rgba(0,0,0,.8)">
          ${DEV().crop(UI().inbox(true), { x: 1140, y: 62, w: 300, h: 838 }, 460)}
        </div>
        <div class="float abs" style="left:600px;top:290px;box-shadow:0 50px 100px -34px rgba(0,0,0,.8)">
          ${DEV().crop(UI().contacts(false), { x: 268, y: 300, w: 900, h: 470 }, 620)}
        </div>`,
      split: 880,
    }),
  };

  /* ── 6. Broadcast at Scale. ──────────────────────────────────────────── */

  S['sales-broadcast'] = {
    w: W, h: H, scale: 1,
    html: () => statement({
      no: '06',
      kicker: 'Broadcast Campaigns',
      head: 'Broadcast<br>at <span class="accent">scale.</span>',
      sub: 'Thousands of segmented messages with per-recipient delivery tracking — and warm-up limits that keep your number alive.',
      bullets: ['18,420 messages sent', '98.4% delivered · 82.1% read', 'Ban-safe send pacing built in'],
      art: `
        <div class="abs" style="left:-30px;top:170px;transform:perspective(2400px) rotateY(-13deg) rotateX(4deg)">
          ${DEV().browser(UI().broadcasts(true), 1340, DEV().DESKTOP, { dark: true, url: 'app.whatsapp-crm.io/broadcasts' })}
        </div>`,
      stat: [['98.4%', 'delivered'], ['82.1%', 'read'], 'send', 'Across 5 campaigns'],
      split: 880,
    }),
  };

  /* ── 7. Measure Everything. ──────────────────────────────────────────── */

  S['sales-measure'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const P = UI().parts;
      return statement({
        no: '07',
        kicker: 'Analytics',
        head: 'Measure<br><span class="accent">everything.</span>',
        sub: 'Response time, resolution rate, agent workload, campaign results and AI impact — one screen, board-ready.',
        bullets: ['−41% first-response time', '94.6% resolution rate', '+27% attributed revenue'],
        art: `
          <div class="float abs" style="left:40px;top:120px;width:600px">
            <div class="app dark" style="display:block;width:600px">${P.messagesChart()}</div>
          </div>
          <div class="float abs" style="left:480px;top:470px;width:470px">
            <div class="app dark" style="display:block;width:470px">${P.pipelineWidget()}</div>
          </div>
          <div class="float abs" style="left:30px;top:600px;width:420px">
            <div class="app dark" style="display:block;width:420px">${P.teamPanel()}</div>
          </div>`,
        split: 880,
      });
    },
  };
})();
