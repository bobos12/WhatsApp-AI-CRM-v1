'use client';

/**
 * A phone number with its country, never one without.
 *
 * The country is chosen beside the number (Saudi Arabia first), or taken from
 * the number itself when it is written with + / 00 — pasting "+20 101…" switches
 * the picker to Egypt. Below the field the number is shown exactly as it will be
 * stored and messaged, or why it can't be, so a wrong country is visible before
 * anything is saved. The server applies the same rules.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { cn } from '../../lib/utils';

/** Pinned to the top of the list: where nearly all customers are. */
export const PINNED_COUNTRIES: CountryCode[] = ['SA', 'AE', 'EG', 'KW', 'QA', 'BH', 'OM', 'JO'];
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'SA';

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
function westernize(text: string): string {
  return text.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10)).replace(/＋/g, '+');
}

function flagOf(country: string): string {
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export type PhoneCheck =
  | { ok: true; e164: string; country: CountryCode | undefined; display: string }
  | { ok: false; reason: 'EMPTY' | 'INVALID' };

/** Same rules as the server's readPhoneStrict: + / 00 wins, else the chosen country. */
export function checkPhone(input: string, country: CountryCode): PhoneCheck {
  const raw = westernize(input.trim());
  if (!raw) return { ok: false, reason: 'EMPTY' };
  const compact = raw.replace(/[\s()\-.]/g, '');
  const digits = compact.replace(/\D/g, '');
  const international = compact.startsWith('+') || digits.startsWith('00');
  const parsed = international
    ? parsePhoneNumberFromString('+' + (compact.startsWith('+') ? digits : digits.slice(2)))
    : parsePhoneNumberFromString(digits, country);
  if (!parsed?.isValid()) return { ok: false, reason: 'INVALID' };
  return { ok: true, e164: parsed.number, country: parsed.country, display: parsed.formatInternational() };
}

/** Country options, localized, pinned ones first. */
export function useCountryOptions() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([i18n.language], { type: 'region' }); } catch { /* very old browser */ }
    const label = (c: CountryCode) => `${flagOf(c)} ${names?.of(c) ?? c} +${getCountryCallingCode(c)}`;
    const rest = getCountries()
      .filter((c) => !PINNED_COUNTRIES.includes(c))
      .map((c) => ({ code: c, label: label(c), name: names?.of(c) ?? c }))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language));
    return {
      pinned: PINNED_COUNTRIES.map((c) => ({ code: c, label: label(c) })),
      rest,
      nameOf: (c: string) => names?.of(c) ?? c,
    };
  }, [i18n.language]);
}

export function CountrySelect({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: CountryCode;
  onChange: (c: CountryCode) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const { pinned, rest } = useCountryOptions();
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as CountryCode)}
      className={className}
      dir="ltr"
    >
      {pinned.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      <option disabled>──────────</option>
      {rest.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  );
}

export default function PhoneInput({
  value,
  onChange,
  required,
  autoFocus,
  inputClassName,
}: {
  /** Stored value — E.164 ("+9665…") or empty. */
  value: string;
  /** Called with the full international number when valid, null otherwise. */
  onChange: (e164: string | null) => void;
  required?: boolean;
  autoFocus?: boolean;
  inputClassName?: string;
}) {
  const { t } = useTranslation('common');
  const id = useId();
  const { nameOf } = useCountryOptions();

  // Seed from the stored number: its country, and the national digits.
  const initial = useMemo(() => {
    const parsed = value ? parsePhoneNumberFromString(value) : undefined;
    return parsed?.country
      ? { country: parsed.country, text: parsed.formatNational() }
      : { country: DEFAULT_PHONE_COUNTRY, text: value ?? '' };
  // Only the first value seeds the field; later updates come from typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [text, setText] = useState(initial.text);
  const [touched, setTouched] = useState(false);

  const check = checkPhone(text, country);

  // A number written with + / 00 names its own country: follow it.
  useEffect(() => {
    if (check.ok && check.country && check.country !== country && /^\s*(\+|00|＋)/.test(westernize(text))) {
      setCountry(check.country);
    }
  }, [check, country, text]);

  useEffect(() => {
    onChange(check.ok ? check.e164 : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.ok ? check.e164 : null]);

  const showError = !check.ok && (touched || text.length > 0) && !(check.reason === 'EMPTY' && !required);

  return (
    <div>
      <div className="mt-1 flex gap-2" dir="ltr">
        <CountrySelect
          value={country}
          onChange={setCountry}
          ariaLabel={t('phone.country', { defaultValue: 'Country' })}
          className={cn(inputClassName, 'mt-0 w-[7.5rem] shrink-0 truncate pe-6 sm:w-44')}
        />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required={required}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={country === 'SA' ? '05X XXX XXXX' : t('phone.placeholder', { defaultValue: 'Phone number' })}
          aria-invalid={showError}
          aria-describedby={`${id}-status`}
          className={cn(inputClassName, 'mt-0 min-w-0 flex-1', showError && 'border-red-400 focus:border-red-400 focus:ring-red-400/30')}
        />
      </div>
      <p id={`${id}-status`} className="mt-1.5 flex min-h-[1rem] items-center gap-1.5 text-[11px]" aria-live="polite">
        {check.ok ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand" />
            <span dir="ltr" className="font-medium text-ink-2">{check.display}</span>
            <span className="text-ink-4">· {nameOf(check.country ?? country)}</span>
          </>
        ) : showError ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
            <span className="text-red-500">
              {check.reason === 'EMPTY'
                ? t('phone.required', { defaultValue: 'Enter a phone number.' })
                : t('phone.invalidFor', { country: nameOf(country), defaultValue: 'Not a valid number for {{country}}. Check the digits or the country.' })}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}
