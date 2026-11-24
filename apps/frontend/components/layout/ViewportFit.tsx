'use client';

import { useEffect } from 'react';

/**
 * Keeps the app exactly as tall as the part of the screen the user can see.
 *
 * iOS Safari doesn't shrink the page when the keyboard opens — it scrolls the
 * whole document up to reveal the focused field, which pushes the chat header
 * off the top of the screen and leaves the app half-scrolled after the keyboard
 * closes. Sizing the shell to the visual viewport (`--app-h`) and pinning the
 * document at the top makes the keyboard shrink the app instead, the way a
 * native app behaves: header stays put, composer sits on the keyboard.
 */
export default function ViewportFit() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Undo iOS's "scroll the page to the input" — the shell already fits.
        if (window.scrollY !== 0 && vv.height < window.innerHeight) window.scrollTo(0, 0);
        root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
        // iOS also pans the visible area down by the keyboard's height without
        // scrolling the page, which left the (shrunken, top-pinned) shell above
        // the screen — a blank view. Follow the pan so the shell stays on screen.
        root.style.setProperty('--app-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
        // Keyboard up: the home-indicator inset no longer applies under the composer.
        root.classList.toggle('kb-open', window.innerHeight - vv.height > 120);
      });
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      root.style.removeProperty('--app-h');
      root.style.removeProperty('--app-top');
      root.classList.remove('kb-open');
    };
  }, []);

  return null;
}
