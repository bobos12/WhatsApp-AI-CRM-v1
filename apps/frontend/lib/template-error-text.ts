import i18n from './i18n';
import { templateErrorKey } from './friendly-error';

/** WhatsApp's stored wording for a template problem, in the user's language with what to do. */
export function templateErrorText(raw: string | null | undefined): string {
  const key = templateErrorKey(raw);
  return key ? i18n.t(`errors:template.${key}`, { example: '{{name}}' }) : (raw ?? '');
}
