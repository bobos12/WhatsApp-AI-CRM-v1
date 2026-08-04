/* ═══════════════════════════════════════════════════════════════════════════
   ui.js — the product's screens, rebuilt from their own source.

   Each function returns the markup for one screen of the running application:
   same layout, same components, same icons, same strings. Nothing here invents
   a feature the app does not ship. When a screen changes in apps/frontend, the
   matching function here is what needs updating.

   Screens render at a fixed 1440×900 logical viewport (the size the desktop
   layout is designed against) and get scaled down by the compositions.
   ═══════════════════════════════════════════════════════════════════════════ */

const D = () => window.DATA;
const ic = (n, cls, w) => window.icon(n, cls || '', w || 2);

/** Gradient avatar, the same two-stop treatment the app uses for contacts. */
function av(initials, gIdx, cls) {
  const g = D().av[gIdx % D().av.length].split(',');
  return `<span class="${cls}" style="background:linear-gradient(135deg,${g[0]},${g[1]})">${initials}</span>`;
}

/* ─── Shell ─────────────────────────────────────────────────────────────── */

function sidebar(active) {
  const item = ([key, label, icon, badge]) => `
    <div class="sb-item${key === active ? ' active' : ''}">
      ${ic(icon)}
      <span class="lbl">${label}</span>
      ${badge ? `<span class="sb-badge">${badge}</span>` : ''}
    </div>`;

  return `
  <aside class="sidebar">
    <div class="sb-brand">
      <img src="${window.LOGO}" alt="">
      <div>
        <p class="name">${window.BRAND.name}</p>
        <p class="sub">${window.BRAND.sub}</p>
      </div>
    </div>
    <nav class="sb-nav">
      <div>
        <p class="sb-label">Menu</p>
        ${window.NAV.main.map(item).join('')}
      </div>
      <div>
        <div class="sb-label-row sales">${ic('target')}<span>Sales Intelligence</span></div>
        ${window.NAV.sales.map(item).join('')}
      </div>
      <div>
        <div class="sb-label-row admin">${ic('shield-check')}<span>Admin</span></div>
        ${window.NAV.admin.map(item).join('')}
      </div>
    </nav>
    <div class="sb-connect">
      <span class="dot"></span>
      <div class="grow">
        <p class="t1">WhatsApp connected</p>
        <p class="t2">${D().tenant.line}</p>
      </div>
      ${ic('check-check')}
    </div>
  </aside>`;
}

function header() {
  const t = D().tenant;
  return `
  <header class="hdr">
    <div class="hdr-search">
      ${ic('search')}
      <div class="field">Search contacts, chats, templates…</div>
      <kbd>⌘K</kbd>
    </div>
    <div class="hdr-right">
      <div class="hdr-btn">${ic('mail')}</div>
      <div class="hdr-btn">${ic('bell')}<span class="pip"></span></div>
      <div class="hdr-conn"><span class="dot"></span>Connected</div>
      <div class="hdr-btn">${ic('refresh-cw')}</div>
      <div class="hdr-btn">${ic('moon')}</div>
      <div class="hdr-user">
        <span class="avatar-g">S</span>
        <div>
          <p class="n">${t.agent}</p>
          <p class="e">${t.email}</p>
        </div>
        ${ic('chevron-down', '', 2)}
      </div>
    </div>
  </header>`;
}

/**
 * Wraps a screen body in the app frame.
 * `dark` toggles the product's own dark theme; `tint` puts the dashboard's
 * page background behind the content the way the real layout does.
 */
function shell(active, body, { dark = false, tint = true, chrome = true } = {}) {
  return `
  <div class="app${dark ? ' dark' : ''}${tint ? ' page-tint' : ''}" style="width:1440px;height:900px">
    ${sidebar(active)}
    <div class="main">
      ${chrome ? header() : ''}
      ${body}
    </div>
  </div>`;
}

/* ─── Dashboard ─────────────────────────────────────────────────────────── */

function kpiCards() {
  return `<div class="kpis">${D().kpi.map((k) => `
    <div class="kpi ${k.cls}">
      <div class="accent"></div><div class="glow"></div>
      <div class="top">
        <p class="lbl">${k.label}</p>
        <span class="arrow">${ic('arrow-up-right')}</span>
      </div>
      <div class="mid">
        <p class="val">${k.value}</p>
        <div class="badge">${ic(k.icon)}</div>
      </div>
      <div class="cap">${ic('trending-up')}<span>${k.cap}</span></div>
    </div>`).join('')}</div>`;
}

function messagesChart() {
  const w = D().week;
  // Bars are drawn side by side, so they scale against the tallest single bar,
  // not the tallest day total — otherwise the busiest day only reaches half the
  // panel and the peak label floats in empty space above it.
  const max = Math.max(...w.flatMap((d) => [d.in, d.out]));
  const peak = w.reduce((b, d, i) => (d.in + d.out > w[b].in + w[b].out ? i : b), 0);
  return `
  <section class="panel" style="height:340px">
    <div class="panel-h">
      <div>
        <h2>Message Activity</h2>
        <p class="sub" style="margin-top:2px">Messages sent and received over the last 7 days</p>
      </div>
      <div class="chart-legend">
        <span class="lg"><i class="sw" style="background:linear-gradient(180deg,#25D366,#1f9255)"></i>Received</span>
        <span class="lg"><i class="sw" style="background:rgba(22,163,74,.25)"></i>Sent</span>
      </div>
    </div>
    <div class="bars">
      ${w.map((d, i) => `
        <div class="bcol">
          <div class="stack">
            ${i === peak ? `<span class="peak">${(d.in + d.out).toLocaleString('en-US')}</span>` : ''}
            <i class="b in" style="height:${Math.round((d.in / max) * 100)}%"></i>
            <i class="b out" style="height:${Math.round((d.out / max) * 100)}%"></i>
          </div>
          <span class="day">${d.d}</span>
        </div>`).join('')}
    </div>
  </section>`;
}

function reminders() {
  return `
  <section class="panel" style="height:340px">
    <h2 style="font-size:15px;font-weight:700;margin:0">Reminders</h2>
    <div class="grow">
      <p class="rem-head">38 chats awaiting your reply</p>
      <p class="rem-sub">Jump back in and keep your customers moving.</p>
    </div>
    <a class="rem-cta">${ic('message-square-reply')}Open Inbox</a>
  </section>`;
}

function pipelineWidget() {
  const p = D().pipeline;
  return `
  <section class="panel" style="height:360px">
    <div class="pipe-head">
      <div class="row gap12">
        <span class="pipe-icon">${ic('target', '', 2)}</span>
        <div>
          <p class="pipe-title">Pipeline Analytics</p>
          <p class="pipe-sub">Deal funnel and conversion</p>
        </div>
      </div>
      <span class="kpi-arrow arrow" style="display:flex;height:32px;width:32px;align-items:center;justify-content:center;border-radius:999px;border:1px solid var(--g200);color:var(--g400)">${ic('arrow-up-right')}</span>
    </div>
    <div class="pipe-pair">
      <div class="pipe-box"><p class="k">Total Value</p><p class="v">${p.totalValue}</p></div>
      <div class="pipe-box accent"><p class="k">Conversion</p><p class="v">${p.conversion}${ic('trending-up')}</p></div>
    </div>
    <div class="stage">
      ${p.stages.map((s) => `
        <div class="stage-row">
          <i class="dot" style="background:${s.dot}"></i>
          <span class="nm">${s.name}</span>
          <span class="ct">${s.count}</span>
        </div>
        <div class="stage-track"><i class="stage-fill ${s.cls}" style="width:${s.pct}%"></i></div>`).join('')}
    </div>
  </section>`;
}

function teamPanel() {
  return `
  <section class="panel" style="height:360px">
    <div class="panel-h">
      <h2>Team Collaboration</h2>
      <span class="chip done" style="font-size:11px">${D().agents.length} agents</span>
    </div>
    <div class="mt8">
      ${D().agents.map((a) => `
        <div class="agent-row">
          <span class="agent-av ${a.av}">${a.i}</span>
          <div class="grow">
            <p class="nm trunc">${a.n}</p>
            <p class="mt">Working on <b>${a.open} open · ${a.res} resolved</b></p>
          </div>
          <span class="chip ${a.chip}">${a.st}</span>
        </div>`).join('')}
    </div>
  </section>`;
}

function recentConversations() {
  return `
  <section class="panel" style="height:360px">
    <div class="panel-h">
      <div>
        <h2>Recent Conversations</h2>
        <p class="sub" style="margin-top:2px">Latest activity in your inbox</p>
      </div>
      <span class="sub" style="color:var(--dz-accent);font-weight:700">View all</span>
    </div>
    <div class="mt8">
      ${D().threads.slice(0, 4).map((c) => `
        <div class="rc-row">
          ${av(c.i, c.g, 'rc-av')}
          <div class="grow">
            <p class="nm trunc">${c.n}</p>
            <p class="pv">${c.p}</p>
          </div>
          <div class="col-flex" style="align-items:flex-end;gap:4px">
            <span class="tm">${c.t}</span>
            ${c.un ? `<span class="rc-unread">${c.un}</span>` : ''}
          </div>
        </div>`).join('')}
    </div>
  </section>`;
}

function screenDashboard(dark) {
  const body = `
    <div class="dash">
      <div class="hero">
        <div class="glow-a"></div><div class="dots"></div>
        <div class="hero-row">
          <div>
            <span class="pill-live"><i class="dot"></i>Live</span>
            <h1>Dashboard</h1>
            <p class="tag">Plan, prioritize, and accomplish your work with ease.</p>
          </div>
          <div class="row gap8">
            <a class="btn-primary">${ic('plus')}New Broadcast</a>
            <a class="btn-ghost">${ic('upload')}Import Contacts</a>
          </div>
        </div>
      </div>
      ${kpiCards()}
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        ${messagesChart()}
        ${reminders()}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${pipelineWidget()}
        ${teamPanel()}
        ${recentConversations()}
      </div>
    </div>`;
  return shell('dashboard', body, { dark });
}

/* ─── Conversations / shared inbox ──────────────────────────────────────── */

function convList() {
  return `
  <div class="conv-list">
    <div class="cl-search">
      <div class="wrap">${ic('search')}<div class="field">Search or start a new chat</div></div>
      ${ic('bookmark-check', '', 2)}
    </div>
    <div class="cl-tabs">
      <div class="cl-tab on">${ic('inbox')}<span>All</span></div>
      <div class="cl-tab">${ic('message-circle')}<span>Unread</span></div>
      <div class="cl-tab">${ic('user-round')}<span>Mine</span></div>
      <div class="cl-tab">${ic('bot')}<span>AI</span></div>
    </div>
    <div class="cl-filters">
      <span class="cl-filter on">Open</span>
      <span class="cl-filter">Pending</span>
      <span class="cl-filter">Resolved</span>
    </div>
    <div class="cl-rows">
      ${D().threads.map((c) => `
        <div class="cl-row${c.sel ? ' sel' : ''}">
          ${av(c.i, c.g, 'cl-av')}
          <div class="grow">
            <div class="top">
              <span class="nm trunc">${c.pin ? ic('pin') : ''}${c.n}</span>
              <span class="tm">${c.t}</span>
            </div>
            <p class="pv">${c.p}</p>
            <div class="cl-tags">
              ${c.tags.map(([t, k]) => `<span class="tg ${k}">${t}</span>`).join('')}
              ${c.un ? `<span class="unread" style="margin-left:auto">${c.un}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function chatPane() {
  const t = D().threads[0];
  return `
  <div class="chat">
    <div class="chat-hdr">
      ${av(t.i, t.g, 'cl-av')}
      <div>
        <p class="nm">${t.n}</p>
        <p class="st"><i class="dot"></i>online · +971 50 123 4567</p>
      </div>
      <div class="acts">
        <span class="hdr-btn">${ic('sparkles')}</span>
        <span class="hdr-btn">${ic('phone')}</span>
        <span class="hdr-btn">${ic('search')}</span>
        <span class="hdr-btn">${ic('more-vertical')}</span>
      </div>
    </div>
    <div class="chat-body">
      <div class="day-sep"><span>Today</span></div>
      ${D().chat.map((m) => `
        <div class="msg ${m.s}">
          <div class="bub">
            ${m.ai ? `<div class="ai-tag">${ic('sparkles')}AI Assistant</div>` : ''}
            ${m.x}
            <div class="meta">${m.t}${m.s === 'out' ? ic('check-check') : ''}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="composer">
      <span class="ico">${ic('smile')}</span>
      <span class="ico">${ic('paperclip')}</span>
      <div class="field">Type a message…</div>
      <span class="ico">${ic('mic')}</span>
      <span class="send">${ic('send')}</span>
    </div>
  </div>`;
}

function contextRail() {
  const t = D().threads[0];
  return `
  <div class="rail">
    ${av(t.i, t.g, 'rail-av')}
    <div>
      <h3>${t.n}</h3>
      <p class="ph">+971 50 123 4567</p>
      <div class="row gap6" style="justify-content:center;margin-top:10px">
        <span class="tg tg-hot">Hot Lead</span>
        <span class="tg tg-vip">VIP</span>
      </div>
    </div>
    <div class="rail-sec">
      <p class="k">${ic('sparkles')}AI Summary</p>
      <p class="rail-note">Wants a full villa fit-out in Jumeirah, 5 bedrooms, starting next month. Budget signalled as high. Asked for a formal quote — awaiting response.</p>
    </div>
    <div class="rail-sec">
      <p class="k">${ic('briefcase-business')}Deal</p>
      <div class="rail-kv"><span class="a">Stage</span><span class="b">Interested</span></div>
      <div class="rail-kv"><span class="a">Value</span><span class="b">$86,000</span></div>
      <div class="rail-kv"><span class="a">Owner</span><span class="b">Sara Haddad</span></div>
      <div class="rail-kv"><span class="a">Lead score</span><span class="b">92 / 100</span></div>
    </div>
    <div class="rail-sec">
      <p class="k">${ic('activity')}Activity</p>
      <div class="tl"><div class="pin"><i></i><s></s></div><div><p class="t">Quote requested</p><p class="d">Today, 09:42</p></div></div>
      <div class="tl"><div class="pin"><i></i><s></s></div><div><p class="t">Qualified by AI</p><p class="d">Today, 09:13</p></div></div>
      <div class="tl"><div class="pin"><i></i></div><div><p class="t">First contact</p><p class="d">Today, 09:12</p></div></div>
    </div>
  </div>`;
}

function screenInbox(dark) {
  const body = `<div class="inbox">${convList()}${chatPane()}${contextRail()}</div>`;
  return shell('conversations', body, { dark, tint: false });
}

/* ─── Contacts ──────────────────────────────────────────────────────────── */

function screenContacts(dark) {
  const body = `
    <div class="pg">
      <div class="pg-h">
        <div>
          <h1>Contacts</h1>
          <p>2,847 people and companies across your WhatsApp audience</p>
        </div>
        <div class="row gap8">
          <a class="btn-ghost">${ic('upload')}Import</a>
          <a class="btn-primary">${ic('plus')}New Contact</a>
        </div>
      </div>
      <div class="row gap8">
        <div class="hdr-search" style="max-width:340px">${ic('search')}<div class="field">Search contacts…</div></div>
        <span class="cl-filter">${'All tags'}</span>
        <span class="cl-filter on">Hot Lead</span>
        <span class="cl-filter">Customer</span>
        <span class="cl-filter">B2B</span>
      </div>
      <div class="card-plain" style="overflow:hidden">
        <table class="tbl">
          <thead><tr><th>Name</th><th>Phone</th><th>Tag</th><th>Owner</th><th>Deal value</th><th>Last activity</th></tr></thead>
          <tbody>
            ${D().contacts.map((c) => `
              <tr>
                <td><div class="row gap10">${av(c.n.split(' ').map((w) => w[0]).slice(0, 2).join(''), c.g, 'tbl-av')}<span class="strong">${c.n}</span></div></td>
                <td>${c.ph}</td>
                <td><span class="tg ${c.tag[1]}">${c.tag[0]}</span></td>
                <td>${c.own}</td>
                <td class="strong">${c.deals}</td>
                <td>${c.last}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return shell('contacts', body, { dark });
}

/* ─── Deals board ───────────────────────────────────────────────────────── */

function screenDeals(dark) {
  const cols = Object.values(D().deals);
  const body = `
    <div class="pg">
      <div class="pg-h">
        <div>
          <h1>Deals</h1>
          <p>$486,200 across 107 open deals · 32% conversion</p>
        </div>
        <div class="row gap8">
          <a class="btn-ghost">${ic('filter')}Filter</a>
          <a class="btn-primary">${ic('plus')}New Deal</a>
        </div>
      </div>
      <div class="board">
        ${cols.map((c) => `
          <div class="bcol">
            <div class="col-h">
              <i class="dot" style="background:${c.dot}"></i>
              <span class="nm">${c.name}</span>
              <span class="ct">${c.items.length}</span>
            </div>
            <span class="val" style="font-size:11px;font-weight:600;color:var(--g400)">${c.total}</span>
            ${c.items.map((d) => `
              <div class="deal">
                <p class="t">${d.t}</p>
                <p class="c">${d.c}</p>
                <div class="f">
                  <span class="m">${d.m}</span>
                  ${av(d.a, d.g, 'deal-av')}
                </div>
              </div>`).join('')}
          </div>`).join('')}
      </div>
    </div>`;
  return shell('deals', body, { dark });
}

/* ─── Automation builder ────────────────────────────────────────────────── */

function screenAutomation(dark) {
  const n = D().flow;
  const node = (f) => `
    <div class="node${f.on ? ' on' : ''}" style="left:${f.x}px;top:${f.y}px">
      <div class="hd">
        <span class="sq" style="background:${f.bg}">${ic(f.icon)}</span>
        <div>
          <p class="kd">${f.kind}</p>
          <p class="ttl">${f.ttl}</p>
        </div>
      </div>
      <p class="bd">${f.body}</p>
    </div>`;

  // Connectors are drawn under the nodes; coordinates track the node boxes.
  const wires = `
    <svg style="position:absolute;inset:0;width:100%;height:100%" fill="none">
      <path d="M156 138 L156 178" stroke="#25D366" stroke-width="2"/>
      <path d="M156 282 L156 322" stroke="#8B5CF6" stroke-width="2"/>
      <path d="M272 366 C305 366 305 304 330 304" stroke="#F59E0B" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="M272 386 C305 386 305 448 330 448" stroke="#94A3B8" stroke-width="2" stroke-dasharray="5 4"/>
      <circle cx="156" cy="178" r="3.5" fill="#25D366"/>
      <circle cx="156" cy="322" r="3.5" fill="#8B5CF6"/>
    </svg>`;

  const body = `
    <div class="pg">
      <div class="pg-h">
        <div>
          <h1>Automations</h1>
          <p>Trigger-based workflows that route, reply and follow up without an agent</p>
        </div>
        <div class="row gap8">
          <a class="btn-ghost">${ic('play')}Test run</a>
          <a class="btn-primary">${ic('plus')}New Workflow</a>
        </div>
      </div>
      <div class="row gap12">
        <span class="status ok"><i class="dot"></i>Active</span>
        <span class="muted" style="font-size:13px">Lead Qualification &amp; Routing · 1,204 runs this month · 98.6% success</span>
      </div>
      <div class="flow">
        <div class="grid"></div>
        ${wires}
        ${n.map(node).join('')}
        <div class="card-plain" style="position:absolute;right:24px;top:24px;width:250px;padding:16px">
          <p class="k" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--g400)">Run history</p>
          <div class="mt12">
            ${[['Ahmed Al Mansoori', 'Assigned to Sara H.', 'ok'],
               ['Hassan Trading', 'Assigned to Omar K.', 'ok'],
               ['Noor Abdullah', 'Follow-up queued', 'run'],
               ['Bay Retail', 'Assigned to Layla N.', 'ok']].map(([a, b, s]) => `
              <div class="row gap8" style="padding:7px 0">
                <span class="status ${s}" style="padding:2px 7px"><i class="dot"></i></span>
                <div class="grow">
                  <p style="font-size:12px;font-weight:600;margin:0">${a}</p>
                  <p style="font-size:11px;margin:0" class="muted">${b}</p>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  return shell('automations', body, { dark });
}

/* ─── Broadcasts ────────────────────────────────────────────────────────── */

function screenBroadcasts(dark) {
  const body = `
    <div class="pg">
      <div class="pg-h">
        <div>
          <h1>Broadcasts</h1>
          <p>Bulk WhatsApp campaigns with delivery and engagement tracking</p>
        </div>
        <a class="btn-primary">${ic('plus')}New Broadcast</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
        ${[['Messages Sent', '18,420', '+24% vs last month'],
           ['Delivery Rate', '98.4%', 'across 5 campaigns'],
           ['Read Rate', '82.1%', '+6.2% vs last month'],
           ['Replies', '3,187', '17.3% reply rate']].map(([k, v, d]) => `
          <div class="stat-tile">
            <p class="k">${k}</p>
            <p class="v">${v}</p>
            <p class="d">${ic('trending-up')}${d}</p>
          </div>`).join('')}
      </div>
      <div class="card-plain" style="overflow:hidden">
        <table class="tbl">
          <thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Read</th><th style="width:180px">Progress</th></tr></thead>
          <tbody>
            ${D().campaigns.map((c) => `
              <tr>
                <td class="strong">${c.n}</td>
                <td>${c.a}</td>
                <td><span class="status ${c.st[1]}"><i class="dot"></i>${c.st[0]}</span></td>
                <td>${c.sent}</td>
                <td>${c.del}</td>
                <td>${c.read}</td>
                <td><div class="prog"><i style="width:${c.pct}%"></i></div></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return shell('broadcasts', body, { dark });
}

/* ─── Analytics ─────────────────────────────────────────────────────────── */

function screenAnalytics(dark) {
  const body = `
    <div class="pg">
      <div class="pg-h">
        <div>
          <h1>Analytics</h1>
          <p>Team performance, campaign results and AI impact</p>
        </div>
        <div class="row gap8">
          <a class="btn-ghost">${ic('calendar')}Last 30 days</a>
          <a class="btn-ghost">${ic('download')}Export</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
        ${[['Total Conversations', '9,412', '+18.2%'],
           ['Avg. First Response', '2m 14s', '−41%'],
           ['Resolution Rate', '94.6%', '+3.1%'],
           ['Revenue Attributed', '$486,200', '+27%']].map(([k, v, d]) => `
          <div class="stat-tile">
            <p class="k">${k}</p>
            <p class="v">${v}</p>
            <p class="d">${ic('trending-up')}${d} vs previous period</p>
          </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        ${messagesChart()}
        ${pipelineWidget()}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <section class="panel">
          <div class="panel-h"><h2>Agent Performance</h2><span class="sub">Response time and workload per agent</span></div>
          <table class="tbl mt12">
            <thead><tr><th>Agent</th><th>Open</th><th>Resolved</th><th>Avg. First Response</th></tr></thead>
            <tbody>
              ${D().agents.map((a) => `
                <tr>
                  <td><div class="row gap10"><span class="agent-av ${a.av}">${a.i}</span><span class="strong">${a.n}</span></div></td>
                  <td>${a.open}</td>
                  <td>${a.res}</td>
                  <td>${['1m 42s', '2m 08s', '4m 21s', '1m 56s', '6m 03s'][D().agents.indexOf(a)]}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>AI Performance</h2><span class="chip done">Live</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">
            ${D().aiMetrics.map((m) => `
              <div class="pipe-box">
                <p class="k">${m.k}</p>
                <p class="v">${m.v}</p>
                <p style="font-size:11px;margin-top:4px" class="muted">${m.d}</p>
              </div>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
  return shell('dashboard', body, { dark });
}

/* ─── AI configuration ──────────────────────────────────────────────────── */

function screenAI(dark) {
  const body = `
    <div class="pg">
      <div class="pg-h">
        <div>
          <h1>Customer AI Bot</h1>
          <p>How the assistant answers, qualifies and hands over to your team</p>
        </div>
        <div class="row gap8">
          <span class="status ok"><i class="dot"></i>Active on 6 of 6 lines</span>
          <a class="btn-primary">${ic('check')}Save changes</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;flex:1;min-height:0">
        <div class="col-flex gap16">
          <div class="ai-card glowing">
            <div class="row gap12">
              <span class="kb-ic" style="background:rgba(37,211,102,.12);color:var(--dz-accent)">${ic('bot')}</span>
              <div class="grow">
                <p style="font-size:14px;font-weight:700;margin:0">AI Customer Support</p>
                <p style="font-size:12px;margin:2px 0 0" class="muted">Replies automatically when no agent has responded within 60 seconds</p>
              </div>
              <span class="toggle on"><i></i></span>
            </div>
            <div class="mt16" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div>
                <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px" class="muted">Creativity</p>
                <div class="slider"><i style="width:35%"></i><b style="left:35%"></b></div>
                <p style="font-size:11px;margin-top:6px" class="muted">Precise — sticks to the knowledge base</p>
              </div>
              <div>
                <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px" class="muted">Handover threshold</p>
                <div class="slider"><i style="width:70%"></i><b style="left:70%"></b></div>
                <p style="font-size:11px;margin-top:6px" class="muted">Escalates to a human at lead score 70</p>
              </div>
            </div>
          </div>

          <div class="ai-card">
            <p style="font-size:14px;font-weight:700;margin:0 0 4px">System prompt</p>
            <p style="font-size:12px;margin:0 0 12px" class="muted">The persona every automated reply is written in</p>
            <div style="border-radius:12px;background:var(--g50);border:1px solid var(--g200);padding:14px;font-size:12.5px;line-height:1.6;color:var(--g600)">
              You are the assistant for Marina Interiors, a Dubai interior fit-out company. Answer in the customer's language (English or Arabic). Be concise and warm. Always capture villa size, location and target start date before quoting. Never invent prices — quote only from the pricing knowledge base. Hand over to a human for anything above AED 150,000.
            </div>
          </div>

          <div class="ai-card grow">
            <div class="row" style="justify-content:space-between">
              <p style="font-size:14px;font-weight:700;margin:0">Knowledge Base</p>
              <span class="chip done">294 entries indexed</span>
            </div>
            <div class="mt8">
              ${D().knowledge.map((k) => `
                <div class="kb-row">
                  <span class="kb-ic">${ic(k.ic)}</span>
                  <div class="grow">
                    <p style="font-size:13px;font-weight:600;margin:0">${k.t}</p>
                    <p style="font-size:11px;margin:2px 0 0" class="muted">${k.m}</p>
                  </div>
                  ${ic('check-check', '', 2)}
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="col-flex gap16">
          <div class="ai-card">
            <p style="font-size:14px;font-weight:700;margin:0 0 12px">This month</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              ${D().aiMetrics.map((m) => `
                <div class="pipe-box">
                  <p class="k">${m.k}</p>
                  <p class="v">${m.v}</p>
                  <p style="font-size:11px;margin-top:4px" class="muted">${m.d}</p>
                </div>`).join('')}
            </div>
          </div>
          <div class="ai-card grow" style="display:flex;flex-direction:column">
            <p style="font-size:14px;font-weight:700;margin:0 0 4px">Live preview</p>
            <p style="font-size:12px;margin:0 0 14px" class="muted">Test the assistant against your knowledge base</p>
            <div class="grow" style="display:flex;flex-direction:column;gap:8px;justify-content:flex-end">
              <div class="msg in" style="max-width:88%"><div class="bub">Do you deliver to Abu Dhabi?</div></div>
              <div class="msg out" style="max-width:88%"><div class="bub"><div class="ai-tag">${ic('sparkles')}AI Assistant</div>Yes — we deliver and install across Abu Dhabi. Standard lead time is 10 working days from order confirmation.<div class="meta">now${ic('check-check')}</div></div></div>
              <div class="msg in" style="max-width:88%"><div class="bub">What's the warranty?</div></div>
              <div class="msg out" style="max-width:88%"><div class="bub"><div class="ai-tag">${ic('sparkles')}AI Assistant</div>All joinery carries a 2-year workmanship warranty, and appliances keep their manufacturer warranty.<div class="meta">now${ic('check-check')}</div></div></div>
            </div>
            <div class="composer" style="border-radius:999px;border:1px solid var(--g200);background:var(--g50);margin-top:14px;padding:8px 10px 8px 16px">
              <div class="field" style="background:transparent;padding:0">Ask the assistant…</div>
              <span class="send" style="height:34px;width:34px">${ic('send')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  return shell('customer-ai', body, { dark });
}

/* ─── Team & permissions ────────────────────────────────────────────────── */

function screenTeam(dark) {
  const roles = [
    ['Sara Haddad', 'sara@marinainteriors.ae', 'Admin', 'av-1', 'SH', 'ok'],
    ['Omar Khalil', 'omar@marinainteriors.ae', 'Team Lead', 'av-2', 'OK', 'run'],
    ['Layla Nassar', 'layla@marinainteriors.ae', 'Agent', 'av-3', 'LN', 'draft'],
    ['Yusuf Rahman', 'yusuf@marinainteriors.ae', 'Agent', 'av-4', 'YR', 'draft'],
    ['Mariam Aziz', 'mariam@marinainteriors.ae', 'Agent', 'av-5', 'MA', 'draft'],
  ];
  const body = `
    <div class="pg">
      <div class="pg-h">
        <div><h1>Team</h1><p>Roles, permissions and assignment rules</p></div>
        <a class="btn-primary">${ic('plus')}Invite member</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${[['Members', '5', '2 admins · 3 agents'],
           ['Teams', '3', 'Sales · Support · Design'],
           ['Assignment', 'Round-robin', 'Respects working hours']].map(([k, v, d]) => `
          <div class="stat-tile"><p class="k">${k}</p><p class="v">${v}</p><p style="font-size:11px;margin-top:4px" class="muted">${d}</p></div>`).join('')}
      </div>
      <div class="card-plain" style="overflow:hidden">
        <table class="tbl">
          <thead><tr><th>Member</th><th>Email</th><th>Role</th><th>Teams</th><th>Status</th></tr></thead>
          <tbody>
            ${roles.map(([n, e, r, a, i, s]) => `
              <tr>
                <td><div class="row gap10"><span class="agent-av ${a}">${i}</span><span class="strong">${n}</span></div></td>
                <td>${e}</td>
                <td><span class="tg ${r === 'Admin' ? 'tg-vip' : r === 'Team Lead' ? 'tg-new' : 'tg-mut'}">${r}</span></td>
                <td>${r === 'Agent' ? 'Support' : 'Sales, Support'}</td>
                <td><span class="status ${s === 'draft' ? 'ok' : s}"><i class="dot"></i>Active</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return shell('users', body, { dark });
}

/* ─── Mobile screens (390×844, the PWA viewport) ────────────────────────── */

function mobileFrameCss() {
  return `width:390px;height:844px;display:flex;flex-direction:column;overflow:hidden;position:relative`;
}

function statusBar(dark) {
  const c = dark ? '#E9EDEF' : '#111827';
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 26px 6px;font-size:14px;font-weight:700;color:${c};flex:none">
    <span>9:41</span>
    <span style="display:flex;gap:5px;align-items:center">
      <svg width="17" height="11" viewBox="0 0 17 11" fill="${c}"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
      <svg width="24" height="11" viewBox="0 0 24 11" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="${c}" opacity=".4"/><rect x="2" y="2" width="16" height="7" rx="1.6" fill="${c}"/><path d="M22 4v3a2 2 0 0 0 0-3z" fill="${c}" opacity=".4"/></svg>
    </span>
  </div>`;
}

function mobileBottomNav(active, dark) {
  const items = [['Chats', 'message-square'], ['Contacts', 'users'], ['Deals', 'briefcase-business'], ['More', 'chevron-right']];
  return `
  <div style="flex:none;padding:8px 14px 22px">
    <div style="display:flex;justify-content:space-around;border-radius:999px;padding:10px 8px;background:${dark ? 'rgba(32,44,51,.94)' : 'rgba(255,255,255,.94)'};box-shadow:0 12px 32px rgba(0,0,0,${dark ? '.5' : '.12'});border:1px solid ${dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)'}">
      ${items.map(([l, i]) => {
        const on = l === active;
        const col = on ? (dark ? '#25D366' : '#16A34A') : (dark ? '#8696A0' : '#9CA3AF');
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;color:${col}">
          ${ic(i)}<span style="font-size:10px;font-weight:${on ? 700 : 500}">${l}</span></div>`;
      }).join('')}
    </div>
  </div>`;
}

function mobileInbox(dark) {
  return `
  <div class="app${dark ? ' dark' : ''}" style="${mobileFrameCss()};background:${dark ? '#0B141A' : '#fff'}">
    ${statusBar(dark)}
    <div style="display:flex;align-items:center;gap:10px;padding:6px 18px 12px;flex:none">
      <span class="avatar-g" style="height:34px;width:34px;font-size:13px">S</span>
      <div class="grow">
        <p style="font-size:14px;font-weight:700;margin:0;color:${dark ? '#fff' : '#111827'}">Inbox</p>
        <p style="font-size:11px;margin:0;color:${dark ? '#8696A0' : '#9CA3AF'}">38 open · 6 unread</p>
      </div>
      <span class="hdr-btn" style="height:34px;width:34px">${ic('search')}</span>
      <span class="hdr-btn" style="height:34px;width:34px">${ic('bell')}<span class="pip"></span></span>
    </div>
    <div class="cl-filters" style="border:0;padding:0 18px 10px">
      <span class="cl-filter on">Open</span><span class="cl-filter">Unread</span><span class="cl-filter">AI</span><span class="cl-filter">Mine</span>
    </div>
    <div class="grow" style="overflow:hidden">
      ${D().threads.slice(0, 7).map((c) => `
        <div class="cl-row" style="padding:12px 18px">
          ${av(c.i, c.g, 'cl-av')}
          <div class="grow">
            <div class="top"><span class="nm trunc">${c.n}</span><span class="tm">${c.t}</span></div>
            <p class="pv" style="max-width:225px">${c.p}</p>
            <div class="cl-tags">
              ${c.tags.slice(0, 1).map(([t, k]) => `<span class="tg ${k}">${t}</span>`).join('')}
              ${c.un ? `<span class="unread" style="margin-left:auto">${c.un}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>
    ${mobileBottomNav('Chats', dark)}
  </div>`;
}

function mobileChat(dark) {
  const t = D().threads[0];
  return `
  <div class="app${dark ? ' dark' : ''}" style="${mobileFrameCss()};background:${dark ? '#111B21' : '#f0f2f5'}">
    ${statusBar(dark)}
    <div class="chat-hdr" style="padding:8px 16px">
      ${ic('chevron-left')}
      ${av(t.i, t.g, 'cl-av')}
      <div><p class="nm" style="font-size:14px">${t.n}</p><p class="st" style="font-size:11px"><i class="dot"></i>online</p></div>
      <div class="acts"><span class="hdr-btn" style="height:34px;width:34px">${ic('phone')}</span><span class="hdr-btn" style="height:34px;width:34px">${ic('more-vertical')}</span></div>
    </div>
    <div class="chat-body" style="padding:14px 16px">
      <div class="day-sep"><span>Today</span></div>
      ${D().chat.map((m) => `
        <div class="msg ${m.s}" style="max-width:84%">
          <div class="bub" style="font-size:13.5px">
            ${m.ai ? `<div class="ai-tag">${ic('sparkles')}AI Assistant</div>` : ''}
            ${m.x}
            <div class="meta">${m.t}${m.s === 'out' ? ic('check-check') : ''}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="composer" style="padding:10px 16px 26px">
      <span class="ico">${ic('smile')}</span>
      <div class="field">Message</div>
      <span class="ico">${ic('paperclip')}</span>
      <span class="send" style="height:38px;width:38px">${ic('send')}</span>
    </div>
  </div>`;
}

function mobileDashboard(dark) {
  return `
  <div class="app${dark ? ' dark' : ''}" style="${mobileFrameCss()};background:${dark ? '#0B141A' : '#F4F5F7'}">
    ${statusBar(dark)}
    <div style="display:flex;align-items:center;gap:10px;padding:6px 18px 14px;flex:none">
      <img src="${window.LOGO}" style="width:32px;height:32px;border-radius:11px">
      <div class="grow">
        <p style="font-size:14px;font-weight:700;margin:0;color:${dark ? '#fff' : '#111827'}">Dashboard</p>
        <p style="font-size:11px;margin:0;color:${dark ? '#8696A0' : '#9CA3AF'}">Marina Interiors</p>
      </div>
      <span class="hdr-conn" style="font-size:10px;padding:4px 9px"><i class="dot"></i>Live</span>
    </div>
    <div class="grow" style="padding:0 16px;display:flex;flex-direction:column;gap:12px;overflow:hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${D().kpi.map((k) => `
          <div class="kpi ${k.cls}" style="padding:14px;border-radius:18px">
            <div class="accent"></div><div class="glow"></div>
            <div class="top"><p class="lbl" style="font-size:10px">${k.label}</p></div>
            <div class="mid" style="margin-top:8px">
              <p class="val" style="font-size:28px">${k.value}</p>
              <div class="badge" style="height:34px;width:34px">${ic(k.icon)}</div>
            </div>
          </div>`).join('')}
      </div>
      <section class="panel" style="padding:16px;flex:1">
        <div class="panel-h"><h2 style="font-size:14px">Message Activity</h2></div>
        <div class="bars" style="min-height:0;margin-top:14px">
          ${D().week.map((d, i) => {
            const max = Math.max(...D().week.flatMap((x) => [x.in, x.out]));
            return `<div class="bcol">
              <div class="stack">
                <i class="b in" style="height:${Math.round((d.in / max) * 100)}%;max-width:9px"></i>
                <i class="b out" style="height:${Math.round((d.out / max) * 100)}%;max-width:9px"></i>
              </div><span class="day">${d.d}</span></div>`;
          }).join('')}
        </div>
      </section>
      <section class="panel" style="padding:16px">
        <div class="panel-h"><h2 style="font-size:14px">Reminders</h2></div>
        <p class="rem-head" style="font-size:16px;margin-top:8px">38 chats awaiting your reply</p>
        <a class="rem-cta" style="margin-top:12px;padding:9px 14px;font-size:13px">${ic('message-square-reply')}Open Inbox</a>
      </section>
    </div>
    ${mobileBottomNav('More', dark)}
  </div>`;
}

window.UI = {
  shell, sidebar, header,
  dashboard: screenDashboard,
  inbox: screenInbox,
  contacts: screenContacts,
  deals: screenDeals,
  automation: screenAutomation,
  broadcasts: screenBroadcasts,
  analytics: screenAnalytics,
  ai: screenAI,
  team: screenTeam,
  mobileInbox, mobileChat, mobileDashboard,
  // Building blocks the compositions borrow for floating-card scenes.
  parts: { kpiCards, messagesChart, reminders, pipelineWidget, teamPanel, recentConversations, chatPane, convList, contextRail, av, ic },
};
