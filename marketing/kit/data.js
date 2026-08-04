/* ═══════════════════════════════════════════════════════════════════════════
   data.js — the content the screens are populated with.

   One fictional tenant ("Marina Interiors", Dubai) used consistently across
   every asset, so the dashboard's 2,847 contacts, the inbox's threads and the
   pipeline's deal values all describe the same business. Marketing art that
   contradicts itself between two slides reads as a mockup; art that adds up
   reads as a product.

   Labels and captions are the real i18n strings from apps/frontend/locales/en.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Product branding shown inside the screenshots.
 *
 * The app's own sidebar string (locales/en/sidebar.json) is "WhatsApp CRM",
 * but the customer-facing brand on the landing page is NexusCRM. Screenshots
 * embedded in that page have to agree with the wordmark above them, so the
 * name lives here as one switch rather than being hard-coded per screen.
 */
window.BRAND = { name: 'NexusCRM', sub: 'Business Suite' };

window.DATA = {
  tenant: { name: 'Marina Interiors', line: '+971 4 555 0100', agent: 'Sara Haddad', email: 'sara@marinainteriors.ae' },

  kpi: [
    { cls: 'c-blue',   icon: 'users',           label: 'Total Contacts',      value: '2,847',  cap: 'Across your whole audience' },
    { cls: 'c-green',  icon: 'message-square',  label: 'Open Conversations',  value: '38',     cap: 'Awaiting your reply' },
    { cls: 'c-violet', icon: 'message-circle',  label: 'Messages Today',      value: '1,254',  cap: 'Sent & received today' },
    { cls: 'c-red',    icon: 'flame',           label: 'Hot Leads',           value: '64',     cap: 'Lead management customers' },
  ],

  // Seven days, incoming / outgoing — the shape /api/analytics/messages returns.
  week: [
    { d: 'M', in: 118, out: 96 },
    { d: 'T', in: 164, out: 131 },
    { d: 'W', in: 142, out: 118 },
    { d: 'T', in: 203, out: 168 },
    { d: 'F', in: 247, out: 194 },
    { d: 'S', in: 176, out: 140 },
    { d: 'S', in: 132, out: 104 },
  ],

  pipeline: {
    totalValue: '$486,200',
    conversion: '32%',
    stages: [
      { key: 'NEW',         name: 'New',         count: 46, cls: 's-new', dot: '#3B82F6', pct: 100 },
      { key: 'INTERESTED',  name: 'Interested',  count: 31, cls: 's-int', dot: '#8B5CF6', pct: 67 },
      { key: 'NEGOTIATION', name: 'Negotiation', count: 18, cls: 's-neg', dot: '#F59E0B', pct: 39 },
      { key: 'CLOSED',      name: 'Closed',      count: 12, cls: 's-cls', dot: '#25D366', pct: 26 },
    ],
  },

  agents: [
    { n: 'Sara Haddad',   i: 'SH', av: 'av-1', open: 7, res: 41, chip: 'done', st: 'Completed' },
    { n: 'Omar Khalil',   i: 'OK', av: 'av-2', open: 9, res: 33, chip: 'done', st: 'Completed' },
    { n: 'Layla Nassar',  i: 'LN', av: 'av-3', open: 12, res: 18, chip: 'prog', st: 'In Progress' },
    { n: 'Yusuf Rahman',  i: 'YR', av: 'av-4', open: 6, res: 24, chip: 'done', st: 'Completed' },
    { n: 'Mariam Aziz',   i: 'MA', av: 'av-5', open: 14, res: 9,  chip: 'pend', st: 'Pending' },
  ],

  // Avatar tints for chat/contact rows — the gradient set the product uses.
  av: ['#25D366,#128C7E', '#3B82F6,#1D4ED8', '#8B5CF6,#6D28D9', '#F59E0B,#D97706', '#EC4899,#BE185D', '#14B8A6,#0F766E'],

  threads: [
    { n: 'Ahmed Al Mansoori', i: 'AM', g: 0, t: '09:42', p: 'Perfect — can you send the quote for the villa?', un: 2, tags: [['Hot Lead', 'tg-hot'], ['VIP', 'tg-vip']], sel: true, pin: true },
    { n: 'Fatima Rashid',     i: 'FR', g: 1, t: '09:31', p: 'Thank you! The samples arrived this morning.', un: 0, tags: [['Customer', 'tg-mut']] },
    { n: 'Dubai Marine Ltd',  i: 'DM', g: 2, t: '09:18', p: 'AI: Shared the catalogue and booked a callback', un: 1, tags: [['AI Handled', 'tg-ai'], ['B2B', 'tg-mut']] },
    { n: 'Noor Abdullah',     i: 'NA', g: 3, t: '08:56', p: 'What are your working hours on Friday?', un: 0, tags: [['New', 'tg-new']] },
    { n: 'Khalid Sultan',     i: 'KS', g: 4, t: '08:40', p: 'Booked the site visit for Thursday 4 PM', un: 0, tags: [['Warm', 'tg-warm']] },
    { n: 'Aisha Ibrahim',     i: 'AI', g: 5, t: 'Yest.',  p: 'Invoice received, processing payment today', un: 0, tags: [['Customer', 'tg-mut']] },
    { n: 'Reem Al Suwaidi',   i: 'RS', g: 1, t: 'Yest.',  p: 'Could we reschedule to next week?', un: 0, tags: [['Follow-up', 'tg-warm']] },
    { n: 'Hassan Trading',    i: 'HT', g: 2, t: 'Yest.',  p: 'AI: Qualified — budget confirmed AED 180k', un: 0, tags: [['AI Handled', 'tg-ai']] },
  ],

  chat: [
    { s: 'in',  x: 'Hi, I saw your kitchen collection on Instagram. Do you handle full villa fit-outs?', t: '09:12' },
    { s: 'out', ai: true, x: "Yes — we do complete villa fit-outs across Dubai and Abu Dhabi. Typical projects run 8–12 weeks. Could you share the villa size and your target start date?", t: '09:13' },
    { s: 'in',  x: "It's a 5-bedroom villa in Jumeirah. We'd like to start next month.", t: '09:31' },
    { s: 'out', ai: true, x: 'Noted — 5-bedroom in Jumeirah, starting next month. I have flagged this as a priority lead and Sara from our design team will call you today.', t: '09:32' },
    { s: 'in',  x: 'Perfect — can you send the quote for the villa?', t: '09:42' },
  ],

  contacts: [
    { n: 'Ahmed Al Mansoori', ph: '+971 50 123 4567', g: 0, tag: ['Hot Lead', 'tg-hot'],  own: 'Sara H.',  last: '2 min ago',  deals: '$86,000' },
    { n: 'Fatima Rashid',     ph: '+971 55 987 6543', g: 1, tag: ['Customer', 'tg-mut'],  own: 'Omar K.',  last: '18 min ago', deals: '$42,500' },
    { n: 'Dubai Marine Ltd',  ph: '+971 4 332 1100',  g: 2, tag: ['B2B', 'tg-new'],       own: 'Layla N.', last: '31 min ago', deals: '$124,000' },
    { n: 'Noor Abdullah',     ph: '+971 52 445 8890', g: 3, tag: ['New', 'tg-new'],       own: 'Unassigned', last: '1 hr ago', deals: '—' },
    { n: 'Khalid Sultan',     ph: '+971 56 220 7734', g: 4, tag: ['Warm', 'tg-warm'],     own: 'Yusuf R.', last: '2 hrs ago',  deals: '$31,200' },
    { n: 'Aisha Ibrahim',     ph: '+971 50 778 2210', g: 5, tag: ['Customer', 'tg-mut'],  own: 'Sara H.',  last: '3 hrs ago',  deals: '$67,400' },
    { n: 'Reem Al Suwaidi',   ph: '+971 55 331 9087', g: 1, tag: ['Follow-up', 'tg-warm'], own: 'Mariam A.', last: '5 hrs ago', deals: '$18,900' },
    { n: 'Hassan Trading',    ph: '+971 4 887 6512',  g: 2, tag: ['Qualified', 'tg-ai'],  own: 'Omar K.',  last: 'Yesterday',  deals: '$180,000' },
  ],

  deals: {
    NEW: { name: 'New', dot: '#3B82F6', total: '$142,800', items: [
      { t: 'Villa fit-out — Jumeirah', c: 'Ahmed Al Mansoori', m: '$86,000', a: 'SH', g: 0 },
      { t: 'Office refresh', c: 'Noor Abdullah', m: '$24,300', a: 'LN', g: 3 },
      { t: 'Kitchen remodel', c: 'Reem Al Suwaidi', m: '$18,900', a: 'MA', g: 1 },
      { t: 'Showroom lighting', c: 'Bay Retail', m: '$13,600', a: 'OK', g: 4 },
    ] },
    INTERESTED: { name: 'Interested', dot: '#8B5CF6', total: '$118,400', items: [
      { t: 'Marina tower — 12 units', c: 'Dubai Marine Ltd', m: '$124,000', a: 'LN', g: 2 },
      { t: 'Restaurant interior', c: 'Aisha Ibrahim', m: '$67,400', a: 'SH', g: 5 },
      { t: 'Retail counter build', c: 'Khalid Sultan', m: '$31,200', a: 'YR', g: 4 },
    ] },
    NEGOTIATION: { name: 'Negotiation', dot: '#F59E0B', total: '$96,700', items: [
      { t: 'Warehouse partition', c: 'Hassan Trading', m: '$180,000', a: 'OK', g: 2 },
      { t: 'Clinic refurbishment', c: 'Fatima Rashid', m: '$42,500', a: 'OK', g: 1 },
    ] },
    CLOSED: { name: 'Closed', dot: '#25D366', total: '$128,300', items: [
      { t: 'Penthouse styling', c: 'Sky Living', m: '$74,800', a: 'SH', g: 0 },
      { t: 'Hotel lobby seating', c: 'Coast Hospitality', m: '$53,500', a: 'YR', g: 3 },
    ] },
  },

  campaigns: [
    { n: 'Ramadan Collection Launch', a: '2,140 recipients', st: ['Delivered', 'ok'],   sent: '2,140', del: '2,096', read: '1,742', pct: 98 },
    { n: 'Villa Fit-out — Warm Leads', a: '486 recipients',  st: ['Sending', 'run'],    sent: '312',   del: '298',   read: '164',   pct: 64 },
    { n: 'Showroom Open Day',          a: '1,320 recipients', st: ['Scheduled', 'sched'], sent: '—',   del: '—',     read: '—',     pct: 0 },
    { n: 'Post-project Survey',        a: '874 recipients',  st: ['Delivered', 'ok'],   sent: '874',   del: '861',   read: '693',   pct: 99 },
    { n: 'Q3 Trade Partners',          a: '208 recipients',  st: ['Draft', 'draft'],    sent: '—',     del: '—',     read: '—',     pct: 0 },
  ],

  flow: [
    { id: 'trigger', x: 40,  y: 34,  kind: 'Trigger',   ttl: 'New WhatsApp message', body: 'Fires when an unknown number messages the business line.', icon: 'message-square', bg: '#25D366', on: true },
    { id: 'ai',      x: 40,  y: 178, kind: 'AI Action', ttl: 'Qualify with AI',      body: 'Detects intent, budget and timeline, then scores the lead.', icon: 'sparkles', bg: '#8B5CF6', on: true },
    { id: 'branch',  x: 40,  y: 322, kind: 'Condition', ttl: 'Lead score ≥ 70',      body: 'Splits hot leads from everything else.', icon: 'git-branch', bg: '#F59E0B' },
    { id: 'assign',  x: 330, y: 250, kind: 'Action',    ttl: 'Assign to Sales team', body: 'Round-robin across available agents, respects working hours.', icon: 'users-round', bg: '#3B82F6' },
    { id: 'notify',  x: 330, y: 394, kind: 'Action',    ttl: 'Send follow-up in 24h', body: 'Template: “Still thinking it over?” — skipped if the customer replies.', icon: 'clock', bg: '#14B8A6' },
  ],

  knowledge: [
    { t: 'Product catalogue 2026', m: '148 entries · synced 2 h ago', ic: 'book-open' },
    { t: 'Pricing & payment terms', m: '36 entries · synced today', ic: 'circle-dollar-sign' },
    { t: 'Delivery & installation FAQ', m: '92 entries · synced today', ic: 'headphones' },
    { t: 'Warranty policy', m: '18 entries · synced yesterday', ic: 'shield-check' },
  ],

  aiMetrics: [
    { k: 'Handled by AI',      v: '68%',   d: '+12% vs last month' },
    { k: 'Avg. response time', v: '8s',    d: '−94% vs manual' },
    { k: 'Qualified leads',    v: '1,204', d: '+31% this quarter' },
    { k: 'CSAT',               v: '4.8',   d: 'across 942 ratings' },
  ],
};

/* Sidebar navigation — mirrors Sidebar.tsx mainNav / salesNav / adminNav. */
window.NAV = {
  main: [
    ['dashboard', 'Dashboard', 'bar-chart-3'],
    ['conversations', 'Conversations', 'message-square', '38'],
    ['contacts', 'Contacts', 'users'],
    ['tags', 'Tags', 'tags'],
    ['saved-replies', 'Saved Replies', 'message-square-reply'],
    ['templates', 'Templates', 'file-text'],
    ['deals', 'Deals', 'briefcase-business'],
    ['tasks', 'Tasks', 'check-square'],
    ['broadcasts', 'Broadcasts', 'send'],
    ['settings', 'Settings', 'settings'],
  ],
  sales: [['leads', 'Lead Management', 'target', '9']],
  admin: [
    ['users', 'Users', 'user-cog'],
    ['teams', 'Teams', 'users-round'],
    ['customer-ai', 'Customer AI Bot', 'bot'],
    ['chatbot', 'AI Tools', 'sparkles'],
  ],
};
