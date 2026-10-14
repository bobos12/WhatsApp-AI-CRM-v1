'use client';

import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { api } from '@/lib/api';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  /** When provided, a failed avatar load silently clears the stale URL from the DB. */
  contactId?: string | null;
}

// Muted, evenly-spaced hues. A contact keeps the same colour everywhere (list,
// header, details) because it is derived from the name, not the list position.
const TONES = [
  'bg-[#DCEFE4] text-[#1F5E3D] dark:bg-[#1C3328] dark:text-[#9FD9B8]',
  'bg-[#DDE8F6] text-[#244E86] dark:bg-[#1B2A3D] dark:text-[#A5C3EC]',
  'bg-[#F3E3D3] text-[#7A4A1C] dark:bg-[#3A2A1C] dark:text-[#E7C29C]',
  'bg-[#EADFF3] text-[#5B3584] dark:bg-[#2D2238] dark:text-[#CDB4E8]',
  'bg-[#F5DEDE] text-[#8A3434] dark:bg-[#3A2121] dark:text-[#EDB0B0]',
  'bg-[#DCEEEE] text-[#1E5A5C] dark:bg-[#1A3233] dark:text-[#9ED6D8]',
  'bg-[#ECEBD6] text-[#5B5620] dark:bg-[#2F2E1C] dark:text-[#D8D39A]',
  'bg-[#E6E8EB] text-[#3D4651] dark:bg-[#262B31] dark:text-[#BAC3CD]',
];

export function avatarTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}

export default function Avatar({ src, name, size = 40, className = '', contactId }: AvatarProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) { setObjectUrl(null); return; }

    let revoked = false;
    let blobUrl: string | null = null;

    // Use fetch instead of <img src> so CDN 404s don't appear in the browser console.
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error('avatar_load_failed');
        return r.blob();
      })
      .then((blob) => {
        blobUrl = URL.createObjectURL(blob);
        if (!revoked) setObjectUrl(blobUrl);
      })
      .catch(() => {
        if (!revoked) setObjectUrl(null);
        // Clear the stale URL from DB so it's not retried next session.
        if (contactId) api.delete(`/api/contacts/${contactId}/avatar`).catch(() => {});
      });

    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [src, contactId]);

  const trimmed = name?.trim() ?? '';
  const isPhone = trimmed.startsWith('+') || /^\d/.test(trimmed) || !trimmed;
  const initial = isPhone ? null : (trimmed.charAt(0) || null);
  const tone = isPhone
    ? 'bg-raised text-ink-3 ring-1 ring-inset ring-line'
    : avatarTone(trimmed.toLowerCase());

  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold ${tone} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) }}
    >
      {initial
        ? <span aria-hidden={!!objectUrl}>{initial.toUpperCase()}</span>
        : <UserRound aria-hidden="true" style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />}
      {objectUrl && (
        <img
          src={objectUrl}
          alt={name || ''}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      )}
    </div>
  );
}
