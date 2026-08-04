/*
 * Assets for the landing page (apps/frontend/components/landing).
 *
 * Every scene here renders on a transparent background so the page's own
 * aurora shows through around the device. A pre-baked dark rectangle would
 * punch a visible box out of that gradient no matter how carefully it was
 * colour-matched.
 *
 * Sizes are ~2× the largest CSS width each image is displayed at; next/image
 * handles the responsive variants and WebP conversion from there.
 */

(function () {
  const S = (window.SCENES = window.SCENES || {});
  const UI = () => window.UI;
  const DEV = () => window.DEV;

  /** A browser-framed screen with room around it for the frame's own shadow. */
  const framed = (name, screen, { w = 1800, url = 'app.nexuscrm.io/dashboard' } = {}) => {
    const pad = 90;
    const h = Math.round((w / 1440) * 900) + 46 + pad * 2;
    S[`landing-${name}`] = {
      w: w + pad * 2, h, scale: 1, transparent: true,
      html: () => `
      <div class="canvas" style="width:${w + pad * 2}px;height:${h}px">
        <div class="abs" style="left:${pad}px;top:${pad}px">
          ${DEV().browser(screen(), w, DEV().DESKTOP, { dark: true, url })}
        </div>
      </div>`,
    };
  };

  framed('dashboard', () => UI().dashboard(true), { url: 'app.nexuscrm.io/dashboard' });
  framed('inbox', () => UI().inbox(true), { url: 'app.nexuscrm.io/conversations' });
  framed('automation', () => UI().automation(true), { url: 'app.nexuscrm.io/automations' });
  framed('analytics', () => UI().analytics(true), { url: 'app.nexuscrm.io/analytics' });
  framed('deals', () => UI().deals(true), { url: 'app.nexuscrm.io/deals' });
  framed('broadcasts', () => UI().broadcasts(true), { url: 'app.nexuscrm.io/broadcasts' });

  /** Phones, transparent, for the mobile section and hero float. */
  const phone = (name, screen, w = 520) => {
    const pad = 70;
    const h = Math.round((w / 390) * 844) + pad * 2;
    S[`landing-phone-${name}`] = {
      w: w + pad * 2, h, scale: 1, transparent: true,
      html: () => `
      <div class="canvas" style="width:${w + pad * 2}px;height:${h}px">
        <div class="abs" style="left:${pad}px;top:${pad}px">${DEV().iphone(screen(), w)}</div>
      </div>`,
    };
  };

  phone('chat', () => UI().mobileChat(true));
  phone('inbox', () => UI().mobileInbox(true));
  phone('dashboard', () => UI().mobileDashboard(false));

  /*
   * Detail crops — a single region of a real screen, no device frame, used
   * where a full screenshot would be unreadable at the size it is shown.
   */
  const detail = (name, screen, box, w) => {
    S[`landing-detail-${name}`] = {
      w, h: Math.round((box.h / box.w) * w), scale: 2, transparent: true,
      html: () => DEV().crop(screen(), box, w, DEV().DESKTOP, 0),
    };
  };

  // The AI conversation: header + thread, cropped out of the live inbox.
  detail('ai-thread', () => UI().inbox(true), { x: 588, y: 62, w: 552, h: 838 }, 620);
  // The customer context rail: AI summary, deal, timeline. Cropped to where the
  // timeline ends — the rail's full height leaves dead space under it.
  detail('context-rail', () => UI().inbox(true), { x: 1140, y: 62, w: 300, h: 664 }, 400);
  // The pipeline widget on its own.
  detail('pipeline', () => UI().dashboard(true), { x: 292, y: 690, w: 380, h: 360 }, 520);
})();
