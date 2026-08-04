/*
 * Clean screen exports — the product on its own, no marketing frame.
 *
 * These are the working stock every other composition draws from, and they
 * double as deliverables: documentation screenshots, app-store shots, and the
 * "here is the actual software" slide that every deck eventually needs.
 * Exported at 2× so they stay sharp when placed at full width.
 */

(function () {
  const S = (window.SCENES = window.SCENES || {});

  const desktop = (name, render) => {
    S[`screen-${name}`] = {
      w: 1440, h: 900, scale: 2,
      html: () => render(),
    };
  };

  const phone = (name, render) => {
    S[`screen-mobile-${name}`] = {
      w: 390, h: 844, scale: 3,
      html: () => render(),
    };
  };

  desktop('dashboard', () => window.UI.dashboard(false));
  desktop('dashboard-dark', () => window.UI.dashboard(true));
  desktop('inbox', () => window.UI.inbox(true));
  desktop('inbox-light', () => window.UI.inbox(false));
  desktop('contacts', () => window.UI.contacts(false));
  desktop('deals', () => window.UI.deals(false));
  desktop('automation', () => window.UI.automation(false));
  desktop('broadcasts', () => window.UI.broadcasts(false));
  desktop('analytics', () => window.UI.analytics(false));
  desktop('ai-config', () => window.UI.ai(false));
  desktop('team', () => window.UI.team(false));

  phone('inbox', () => window.UI.mobileInbox(true));
  phone('chat', () => window.UI.mobileChat(true));
  phone('dashboard', () => window.UI.mobileDashboard(false));
})();
