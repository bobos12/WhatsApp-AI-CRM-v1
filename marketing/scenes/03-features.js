/*
 * Feature spotlights — one per capability.
 *
 * Each is the same template: a claim on the left, the actual screen that backs
 * the claim on the right, and numbered callouts pointing at the parts of the UI
 * that do the work. The crop is a real region of a real screen, so a reader who
 * later opens the app finds exactly what the spotlight showed them.
 */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const ic = (n) => window.icon(n);

  const W = 2400, H = 1500;

  const lockup = () => `
    <div class="lockup">
      <img src="${window.LOGO}" alt="">
      <div><div class="wm">${window.BRAND.name}</div><div class="tag-line">Business Suite</div></div>
    </div>`;

  /**
   * @param eyebrow section label
   * @param title   the claim (HTML — use <span class="accent"> for emphasis)
   * @param lead    one paragraph of support
   * @param feats   [icon, title, detail][]
   * @param art     right-hand visual
   * @param proof   [value, label][] — evidence cards under the copy column
   * @param light   render the marketing frame light instead of dark
   *
   * Proof cards sit in the empty band below the copy rather than on top of the
   * screenshot. Annotations laid over a UI hide the very thing they point at,
   * and they have to be re-tuned by hand every time the art moves.
   */
  function spotlight({ eyebrow, title, lead, feats, art, proof = [], light = false }) {
    return `
    <div class="canvas ${light ? 'bg-light' : 'bg-dark'} ${light ? 'grid-lines' : 'noise'}" style="width:${W}px;height:${H}px">
      <div class="orb green" style="width:900px;height:900px;right:-180px;top:-240px;opacity:${light ? '.3' : '.4'}"></div>
      <div class="orb teal" style="width:640px;height:640px;left:-200px;bottom:-240px;opacity:${light ? '.24' : '.34'}"></div>

      <div class="abs" style="top:64px;left:88px">${lockup()}</div>

      <div class="abs vstack" style="left:88px;top:300px;width:800px">
        <div class="eyebrow"><i class="dot"></i>${eyebrow}</div>
        <h2 class="title" style="margin-top:28px">${title}</h2>
        <p class="lead" style="margin-top:24px;max-width:680px">${lead}</p>
        <div class="vstack g24" style="margin-top:44px">
          ${feats.map(([i, t, d]) => `
            <div class="feat">
              <span class="bx">${ic(i)}</span>
              <div><div class="t">${t}</div><div class="d">${d}</div></div>
            </div>`).join('')}
        </div>
      </div>

      ${proof.length ? `
      <div class="abs flexc g16" style="left:88px;top:1180px">
        ${proof.map(([v, k]) => `
          <div class="glass metric" style="padding:22px 26px;min-width:250px">
            <div class="n" style="font-size:36px">${v}</div>
            <div class="k" style="margin-top:6px">${k}</div>
          </div>`).join('')}
      </div>` : ''}

      <div class="abs" style="left:990px;top:0;width:1410px;height:${H}px">${art}</div>
    </div>`;
  }

  /* Art helpers ──────────────────────────────────────────────────────────── */

  const UI = () => window.UI;
  const DEV = () => window.DEV;

  /** Full screen in a browser frame, angled into the right half. */
  const angled = (screen, { w = 1560, top = 300, left = 120, rot = -11 } = {}) => `
    <div class="abs" style="left:${left}px;top:${top}px;transform:perspective(2800px) rotateY(${rot}deg) rotateX(3deg)">
      ${DEV().browser(screen, w, DEV().DESKTOP, { dark: true })}
    </div>`;

  /** A straight-on crop of one region of a screen, floated. */
  const detail = (screen, box, { w = 900, left = 180, top = 420 } = {}) => `
    <div class="float abs" style="left:${left}px;top:${top}px">
      ${DEV().crop(screen, box, w)}
    </div>`;

  /* ── 1. AI customer support ─────────────────────────────────────────── */

  S['feature-ai-support'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'AI Customer Support',
      title: 'AI that never<br><span class="accent">sleeps.</span>',
      lead: 'The assistant answers from your own knowledge base in about eight seconds — at 2am, on a public holiday, in English or Arabic — and hands over the moment a human is needed.',
      feats: [
        ['bot', 'Answers grounded in your content', 'Product catalogue, pricing and policies — never invented.'],
        ['git-branch', 'Escalates on its own terms', 'Crosses your lead-score threshold and a human takes the thread.'],
        ['gauge', 'Tuned, not guessed', 'Creativity and handover thresholds are settings, not code changes.'],
      ],
      art: angled(UI().inbox(true), { w: 1620, top: 320, left: 90, rot: -12 }),
      proof: [['8s', 'average AI first reply'], ['68%', 'resolved without an agent']],
    }),
  };

  /* ── 2. Shared inbox ────────────────────────────────────────────────── */

  S['feature-shared-inbox'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'WhatsApp Shared Inbox',
      title: 'One line.<br>Your <span class="accent">whole team.</span>',
      lead: 'Every agent works the same WhatsApp number without stepping on each other — with assignment, presence, internal notes and a full history behind every thread.',
      feats: [
        ['users-round', 'Assignment that respects reality', 'Round-robin across available agents, inside working hours.'],
        ['tags', 'Tags, filters and saved views', 'Slice the queue by stage, owner, or anything you label.'],
        ['reply', 'Quick replies and templates', 'Approved answers a keystroke away.'],
      ],
      art: angled(UI().inbox(true), { w: 1600, top: 340, left: 110, rot: -10 }),
      proof: [['38', 'open conversations'], ['94.6%', 'resolution rate']],
    }),
  };

  /* ── 3. Automation builder ──────────────────────────────────────────── */

  S['feature-automation'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Workflow Automation',
      title: 'Automate the<br><span class="accent">follow-up.</span>',
      lead: 'Trigger-based workflows qualify a lead, route it to the right team and chase it later — without anyone remembering to.',
      feats: [
        ['zap', 'Triggers on real events', 'New message, tag applied, stage changed, deal won.'],
        ['git-branch', 'Branches on conditions', 'Lead score, language, working hours, customer type.'],
        ['clock', 'Delays and sequences', 'A 24-hour nudge that cancels itself if the customer replies.'],
      ],
      art: angled(UI().automation(true), { w: 1600, top: 340, left: 110, rot: -10 }),
      proof: [['1,204', 'workflow runs this month'], ['98.6%', 'success rate']],
    }),
  };

  /* ── 4. CRM ─────────────────────────────────────────────────────────── */

  S['feature-crm'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Contact & Customer Management',
      title: 'Know your<br><span class="accent">customers.</span>',
      lead: 'Every WhatsApp number becomes a real contact record: tags, owner, custom fields, notes, deal history and a full activity timeline.',
      feats: [
        ['user-round', 'A profile behind every chat', 'Built automatically from the first message.'],
        ['list-checks', 'Custom fields that stay clean', 'Typed and coerced on write, so reports actually add up.'],
        ['upload', 'Bulk import and export', 'CSV and XLSX in, mapped to your own fields.'],
      ],
      art: angled(UI().contacts(false), { w: 1600, top: 340, left: 110, rot: -10 }),
      light: true,
      proof: [['2,847', 'contacts under management'], ['100%', 'of chats become records']],
    }),
  };

  /* ── 5. Pipeline ────────────────────────────────────────────────────── */

  S['feature-pipeline'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Sales Pipeline',
      title: 'Turn chats into<br><span class="accent">deals.</span>',
      lead: 'A drag-and-drop board that tracks value by stage, so you can see where the money is stuck and who is sitting on it.',
      feats: [
        ['briefcase-business', 'Stages that match how you sell', 'New, Interested, Negotiation, Closed — or your own.'],
        ['circle-dollar-sign', 'Value and conversion per stage', 'Totals roll up to the dashboard automatically.'],
        ['target', 'Lead scoring built in', 'AI-qualified leads land in the pipeline already ranked.'],
      ],
      art: angled(UI().deals(true), { w: 1600, top: 340, left: 110, rot: -10 }),
      proof: [['$486,200', 'open pipeline value'], ['32%', 'conversion to closed']],
    }),
  };

  /* ── 6. Broadcasts ──────────────────────────────────────────────────── */

  S['feature-broadcasts'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Broadcast Campaigns',
      title: 'Broadcast<br>at <span class="accent">scale.</span>',
      lead: 'Send to thousands of segmented contacts with per-message delivery, read and reply tracking — and warm-up limits that protect your number.',
      feats: [
        ['send', 'Segment, schedule, send', 'Target by tag, stage or custom field; queue for a time zone.'],
        ['shield-check', 'Ban-safe by design', 'Warm-up ramps and per-minute caps enforced by the sender.'],
        ['activity', 'Live delivery telemetry', 'Delivered, read and replied, per campaign, as it happens.'],
      ],
      art: angled(UI().broadcasts(false), { w: 1600, top: 340, left: 110, rot: -10 }),
      light: true,
      proof: [['18,420', 'messages sent'], ['98.4%', 'delivery rate']],
    }),
  };

  /* ── 7. Analytics ───────────────────────────────────────────────────── */

  S['feature-analytics'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Analytics & Reporting',
      title: 'Measure<br><span class="accent">everything.</span>',
      lead: 'Response times, resolution rates, agent workload, campaign performance and AI impact — on one screen, exportable to your board deck.',
      feats: [
        ['gauge', 'Team and agent performance', 'First-response time and resolution rate, per person.'],
        ['trending-up', 'Revenue attribution', 'Pipeline value traced back to the conversation that started it.'],
        ['brain', 'AI effectiveness', 'What share of chats the assistant closed without a human.'],
      ],
      art: angled(UI().analytics(true), { w: 1600, top: 340, left: 110, rot: -10 }),
      proof: [['−41%', 'first-response time'], ['+27%', 'attributed revenue']],
    }),
  };

  /* ── 8. Knowledge base ──────────────────────────────────────────────── */

  S['feature-knowledge-base'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'AI Knowledge Base',
      title: 'Teach it once.<br>It <span class="accent">never forgets.</span>',
      lead: 'Upload your catalogue, pricing and policies. The assistant answers from that, and only that — with a live preview so you can test before customers do.',
      feats: [
        ['book-open', 'Indexed, not pasted', '294 entries kept in sync and searchable by the model.'],
        ['message-square', 'Test against real questions', 'The preview panel talks to the same engine customers hit.'],
        ['lock', 'No invented prices', 'Anything outside the knowledge base escalates to a human.'],
      ],
      art: angled(UI().ai(true), { w: 1600, top: 340, left: 110, rot: -10 }),
      proof: [['294', 'indexed entries'], ['8s', 'to an accurate answer']],
    }),
  };

  /* ── 9. Team collaboration ──────────────────────────────────────────── */

  S['feature-team'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Team & Permissions',
      title: 'Built for<br><span class="accent">teams.</span>',
      lead: 'Roles, teams and assignment rules — plus an audit log that records who changed what, so support and sales can share a line safely.',
      feats: [
        ['shield-check', 'Role-based access', 'Admin, team lead and agent, each scoped to what they need.'],
        ['users-round', 'Teams and routing rules', 'Sales, Support and Design with their own queues.'],
        ['database', 'Full audit trail', 'Every assignment, edit and send, attributable.'],
      ],
      art: angled(UI().team(false), { w: 1600, top: 340, left: 110, rot: -10 }),
      light: true,
      proof: [['3', 'teams, one shared line'], ['Full', 'audit trail']],
    }),
  };

  /* ── 10. Customer profile (detail crop, no device frame) ────────────── */

  S['feature-customer-profile'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Customer Profiles',
      title: 'The whole story,<br>beside the <span class="accent">message.</span>',
      lead: 'An AI summary, the open deal, the lead score and a dated activity timeline sit next to the thread — so nobody has to ask "what happened last time?"',
      feats: [
        ['sparkles', 'AI conversation summary', 'Regenerated as the thread moves.'],
        ['briefcase-business', 'Deal, value and owner', 'Straight from the pipeline, editable in place.'],
        ['activity', 'Dated activity timeline', 'Quote requested, qualified, first contact.'],
      ],
      // The context rail, cropped from the real inbox at its true position.
      art: `
        <div class="float abs" style="left:250px;top:330px;box-shadow:0 60px 120px -40px rgba(0,0,0,.8)">
          ${DEV().crop(UI().inbox(true), { x: 1140, y: 62, w: 300, h: 838 }, 620)}
        </div>
        <div class="float abs" style="left:76px;top:900px;width:760px">
          ${DEV().crop(UI().inbox(true), { x: 340, y: 480, w: 800, h: 420 }, 760)}
        </div>`,
      proof: [['92 / 100', 'lead score, computed'], ['1 view', 'summary, deal, timeline']],
    }),
  };

  /* ── 11. Smart notifications ────────────────────────────────────────── */

  S['feature-notifications'] = {
    w: W, h: H, scale: 1,
    html: () => {
      const note = (icon, title, body, time, tint) => `
        <div class="glass" style="width:520px;padding:20px 22px;display:flex;gap:16px;align-items:flex-start">
          <span style="display:grid;place-items:center;width:44px;height:44px;flex:none;border-radius:14px;background:${tint};color:#fff">${ic(icon)}</span>
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;gap:12px">
              <div style="font-size:16px;font-weight:700">${title}</div>
              <div style="font-size:12px;color:rgba(255,255,255,.4)">${time}</div>
            </div>
            <div style="margin-top:5px;font-size:14px;line-height:1.5;color:rgba(255,255,255,.55)">${body}</div>
          </div>
        </div>`;

      return spotlight({
        eyebrow: 'Smart Notifications',
        title: 'Told before<br>you are <span class="accent">asked.</span>',
        lead: 'Web push reaches agents on the phone they already carry — for hot leads, unanswered threads, campaign completion and SLA risk.',
        feats: [
          ['bell', 'Native web push', 'Delivered even with the tab closed.'],
          ['flame', 'Priority signals only', 'Hot leads and breached response times, not every message.'],
          ['bell-off', 'Quiet by default', 'Per-user and per-team notification rules.'],
        ],
        // The phone anchors the stack: cards read as alerts landing on the
        // device rather than floating loose in the composition.
        art: `
          <div class="abs" style="left:60px;top:330px">
            ${DEV().iphone(UI().mobileInbox(true), 340)}
          </div>
          <div class="abs vstack g20" style="left:520px;top:300px">
            ${note('flame', 'Hot lead detected', 'Ahmed Al Mansoori scored 92 — asked for a quote on a villa fit-out.', 'now', 'linear-gradient(135deg,#EF4444,#F97316)')}
            <div style="margin-left:48px">${note('message-square-reply', '6 chats awaiting reply', 'Oldest has been waiting 14 minutes — above your 10-minute SLA.', '2m', 'linear-gradient(135deg,#25D366,#128C7E)')}</div>
            ${note('send', 'Campaign finished', 'Ramadan Collection Launch — 2,096 delivered, 1,742 read.', '18m', 'linear-gradient(135deg,#3B82F6,#1D4ED8)')}
            <div style="margin-left:48px">${note('briefcase-business', 'Deal moved to Negotiation', 'Hassan Trading — $180,000, owned by Omar Khalil.', '41m', 'linear-gradient(135deg,#8B5CF6,#6D28D9)')}</div>
          </div>`,
        proof: [['&lt;10s', 'event to phone'], ['Per-team', 'notification rules']],
      });
    },
  };

  /* ── 12. Templates & rich media ─────────────────────────────────────── */

  S['feature-templates'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Templates & Quick Replies',
      title: 'Say it right,<br><span class="accent">every time.</span>',
      lead: 'One surface to build and send message templates — variables, buttons, rich media and the interactive wrapper WhatsApp actually needs.',
      feats: [
        ['layout-template', 'Create and send in one place', 'No separate composer to keep in sync.'],
        ['image', 'Rich media and buttons', 'Images, documents and interactive replies.'],
        ['globe', 'Bilingual by default', 'English and Arabic variants on the same template.'],
      ],
      art: angled(UI().broadcasts(true), { w: 1600, top: 340, left: 110, rot: -10 }),
      proof: [['2', 'languages per template'], ['1 surface', 'build and send']],
    }),
  };

  /* ── 13. Settings & administration ──────────────────────────────────── */

  S['feature-settings'] = {
    w: W, h: H, scale: 1,
    html: () => spotlight({
      eyebrow: 'Administration',
      title: 'Yours to<br><span class="accent">configure.</span>',
      lead: 'Connection health, AI behaviour, roles, working hours, notification rules and API access — all owner-editable, none of it a support ticket.',
      feats: [
        ['settings', 'Everything is a setting', 'Behaviour changes without a deploy.'],
        ['shield-check', 'Multi-tenant isolation', 'Each business gets its own data boundary and session.'],
        ['git-branch', 'API access and webhooks', 'Push events into the systems you already run.'],
      ],
      art: angled(UI().ai(false), { w: 1600, top: 340, left: 110, rot: -10 }),
      light: true,
      proof: [['0', 'tickets to reconfigure'], ['Per-tenant', 'data isolation']],
    }),
  };
})();
