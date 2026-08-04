/* ═══════════════════════════════════════════════════════════════════════════
   devices.js — puts a rendered product screen inside a device.

   Screens are authored at their true logical size (1440×900 desktop, 390×844
   phone, 1112×834 tablet) and scaled with a CSS transform. Scaling rather than
   re-laying-out means the marketing art shows the same pixel relationships the
   real app has — a card that is 20px-round on screen stays proportionally
   20px-round in the mockup.
   ═══════════════════════════════════════════════════════════════════════════ */

const DESKTOP = { w: 1440, h: 900 };
const PHONE = { w: 390, h: 844 };
const TABLET = { w: 1112, h: 834 };

/** Clipped, scaled screen. `src` is a {w,h} authoring size. */
function viewport(html, width, src, radius = 0) {
  const s = width / src.w;
  return `
  <div class="viewport" style="width:${width}px;height:${Math.round(src.h * s)}px;border-radius:${radius}px">
    <div class="scaler" style="width:${src.w}px;height:${src.h}px;transform:scale(${s})">${html}</div>
  </div>`;
}

/** MacBook Pro 16". `width` is the screen area; the lid adds ~22px. */
function macbook(html, width = 1100, src = DESKTOP) {
  const baseW = Math.round(width * 1.16);
  // Notch tracks the lid width for the same reason the iPhone island does.
  const notch = `width:${(width * 0.128).toFixed(1)}px;height:${(width * 0.019).toFixed(1)}px`;
  return `
  <div class="macbook">
    <div class="lid" style="width:${width + 22}px">
      <div class="bezel">
        <div class="notch" style="${notch}"></div>
        ${viewport(html, width, src)}
        <div class="glare"></div>
      </div>
    </div>
    <div class="base" style="width:${baseW}px"></div>
  </div>`;
}

/** Apple Studio Display on its stand. */
function studioDisplay(html, width = 1180, src = DESKTOP) {
  return `
  <div class="monitor">
    <div class="mon-panel" style="width:${width + 28}px">
      <div class="bezel">
        ${viewport(html, width, src)}
        <div class="glare"></div>
      </div>
      <div class="chin"></div>
    </div>
    <div class="neck"></div>
    <div class="foot"></div>
  </div>`;
}

/** iPad Pro, landscape. */
function ipad(html, width = 820, src = TABLET) {
  return `
  <div class="ipad">
    <div class="body" style="width:${width + 28}px">
      <div class="bezel">
        <div class="cam"></div>
        ${viewport(html, width, src, 22)}
        <div class="glare"></div>
      </div>
    </div>
  </div>`;
}

/**
 * iPhone. `darkUi` only flips the home-indicator colour.
 *
 * The island and home indicator are sized as a fraction of the frame, not in
 * fixed pixels: the screen inside is scaled, so fixed chrome would swallow the
 * status bar on a small render and float free of it on a large one.
 */
function iphone(html, width = 300, darkUi = true) {
  const island = `width:${(width * 0.3).toFixed(1)}px;height:${(width * 0.082).toFixed(1)}px;top:${(width * 0.04).toFixed(1)}px`;
  const home = `width:${(width * 0.34).toFixed(1)}px;height:${Math.max(3, width * 0.013).toFixed(1)}px;bottom:${(width * 0.026).toFixed(1)}px`;
  return `
  <div class="phone${darkUi ? ' dark-ui' : ''}">
    <div class="body" style="width:${width + 22}px">
      <div class="bezel">
        <div class="island" style="${island}"></div>
        ${viewport(html, width, PHONE, 44)}
        <div class="home" style="${home}"></div>
        <div class="glare"></div>
      </div>
    </div>
  </div>`;
}

/** Premium browser chrome. */
function browser(html, width = 1200, src = DESKTOP, { dark = false, url = 'app.whatsapp-crm.io/dashboard' } = {}) {
  const lock = window.icon('lock');
  return `
  <div class="browser${dark ? ' night' : ''}" style="width:${width}px">
    <div class="bar">
      <span class="lights"><i></i><i></i><i></i></span>
      <span class="url">${lock}${url}</span>
      <span style="width:52px"></span>
    </div>
    ${viewport(html, width, src)}
  </div>`;
}

/**
 * A cropped window onto part of a screen — the "detail shot" used by feature
 * spotlights. `crop` is in authoring pixels: {x, y, w, h}.
 */
function crop(html, cropBox, outW, src = DESKTOP, radius = 18) {
  const s = outW / cropBox.w;
  return `
  <div class="viewport" style="width:${outW}px;height:${Math.round(cropBox.h * s)}px;border-radius:${radius}px">
    <div class="scaler" style="width:${src.w}px;height:${src.h}px;transform:scale(${s}) translate(${-cropBox.x}px, ${-cropBox.y}px)">${html}</div>
  </div>`;
}

window.DEV = { viewport, macbook, studioDisplay, ipad, iphone, browser, crop, DESKTOP, PHONE, TABLET };
