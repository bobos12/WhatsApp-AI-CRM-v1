export function formatPhone(phone?: string | null): string {
  if (!phone) return 'Unknown number';

  // Group/broadcast JIDs should never reach here after backend filtering
  if (phone.includes('@g.us')) return 'Group Chat';
  if (phone.includes('@broadcast')) return 'Broadcast';

  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return phone;

  if (digits.length <= 4) return digits;

  // E.164 max is 15 digits. Anything longer is corrupted data — show truncated
  if (digits.length > 15) {
    return `+${digits.slice(0, 15)}…`;
  }

  const intl = `+${digits}`;

  // The countries this CRM's customers actually dial, grouped the way people
  // there write them. The generic split below put "+96 692 003 3077" on a
  // Saudi 9200 number.
  if (digits.startsWith('966') && digits.length === 12) {
    const n = digits.slice(3);
    if (n.startsWith('9200')) return `+966 ${n.slice(0, 4)} ${n.slice(4)}`;
    if (n.startsWith('800')) return `+966 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
    return `+966 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  }
  if (digits.startsWith('971') && digits.length === 12) {
    const n = digits.slice(3);
    return `+971 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  }
  if (digits.startsWith('20') && digits.length === 12) {
    const n = digits.slice(2);
    return `+20 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }

  if (digits.length === 10) {
    return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  if (digits.length === 11) {
    return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }

  if (digits.length >= 13) {
    return intl.slice(0, 4) + ' ' + intl.slice(4, 8) + ' ' + intl.slice(8);
  }

  return intl;
}
