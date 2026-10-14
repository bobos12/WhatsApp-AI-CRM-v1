'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: '😊 Smileys',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','😲','😳','🥺','😢','😭','😤','😠','😡','🤬','😈','💀','☠️','💩','🤡','👹','👺','👻','👽','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  },
  {
    label: '👍 Gestures',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄','💋','🩸'],
  },
  {
    label: '❤️ Hearts',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🔯','☸️','✡️','🕉','☯️','♾','♻️','🔱','⚜️','🔰','💠'],
  },
  {
    label: '🎉 Fun',
    emojis: ['🎉','🎊','🎈','🎁','🎀','🎗','🎟','🎫','🎖','🏆','🥇','🥈','🥉','⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','🎽','🎿','🛷','🥌','🎯','🎲','🎮','🕹','🃏','🀄','🎴','🎭','🎨','🖼','🎰','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞'],
  },
  {
    label: '🌍 Nature',
    emojis: ['🌸','🌹','🌺','🌻','🌼','🌷','🌱','🌿','☘️','🍀','🎍','🎋','🍃','🍂','🍁','🍄','🌾','💐','🌊','🌬','🌀','🌈','☀️','🌤','⛅','🌥','☁️','🌦','🌧','⛈','🌩','🌨','❄️','☃️','⛄','🌬','💨','💧','💦','🌊','🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜'],
  },
  {
    label: '🍕 Food',
    emojis: ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🧉','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧊'],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export default function EmojiPicker({ onSelect, onClose, anchorRef }: EmojiPickerProps) {
  const { t } = useTranslation('chat');
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [fixedStyle, setFixedStyle] = useState<React.CSSProperties | null>(null);

  // Measure anchor position and switch to fixed/portal mode to escape overflow-hidden containers.
  useEffect(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const pickerWidth = 288; // w-72
    const margin = 8;
    let left: number;
    // When the button is on the right half of the screen (e.g. RTL input bar),
    // align the picker's right edge with the button's right edge so it opens leftward
    // and stays inside the chat area. Otherwise open rightward from the button's left edge.
    if (rect.right > window.innerWidth / 2) {
      left = Math.max(rect.right - pickerWidth, margin);
    } else {
      left = Math.min(rect.left, window.innerWidth - pickerWidth - margin);
    }
    setFixedStyle({ bottom: window.innerHeight - rect.top + margin, left });
  }, [anchorRef]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const filtered = search.trim()
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) => e.includes(search))
    : EMOJI_CATEGORIES[activeCategory].emojis;

  const pickerContent = (
    <div
      ref={containerRef}
      style={fixedStyle ? { position: 'fixed', zIndex: 9999, ...fixedStyle } : undefined}
      className={`${!fixedStyle ? 'absolute bottom-full mb-2 start-0 z-[9999]' : ''} w-72 rounded-xl border border-line bg-white dark:bg-raised shadow-xl overflow-hidden`}
    >
      {/* Search */}
      <div className="p-2 border-b border-line">
        <input
          autoFocus
          type="text"
          placeholder={t('composer.searchEmoji')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-line bg-gray-50 dark:bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-4 outline-none focus:border-brand"
        />
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex overflow-x-auto border-b border-line">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveCategory(i)}
              className={`shrink-0 px-3 py-2 text-base transition-colors ${
                activeCategory === i ? 'bg-brand/10' : 'hover:bg-raised'
              }`}
              title={cat.label}
            >
              {cat.emojis[0]}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="grid grid-cols-8 gap-0 p-2 max-h-48 overflow-y-auto">
        {filtered.map((emoji, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { onSelect(emoji); }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-raised transition-colors"
          >
            {emoji}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-8 py-4 text-center text-xs text-ink-4">{t('composer.noResults')}</p>
        )}
      </div>
    </div>
  );

  // Portal mode: render to document.body to escape any overflow-hidden ancestor.
  if (anchorRef) {
    if (fixedStyle === null) return null; // wait for measurement before showing
    return createPortal(pickerContent, document.body);
  }
  return pickerContent;
}
