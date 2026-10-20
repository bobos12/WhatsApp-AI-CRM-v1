/**
 * Links into Meta's billing for the WhatsApp account. Meta documents no deep
 * link to a single WhatsApp account's payment page, so these open the billing
 * pages that exist — scoped to the owning business when we know it, so people
 * in several businesses land in the right one.
 */
const BASE = 'https://business.facebook.com/billing_hub';

function scoped(path: string, businessId?: string | null) {
  return businessId ? `${BASE}/${path}?business_id=${encodeURIComponent(businessId)}` : `${BASE}/${path}`;
}

/** Accounts list — where a balance is paid and the payment method is chosen. */
export const billingAccountsUrl = (businessId?: string | null) => scoped('accounts', businessId);
/** Cards and other payment methods on the business. */
export const paymentMethodsUrl = (businessId?: string | null) => scoped('payment_methods', businessId);

export interface SendingStatus {
  blocked: boolean;
  connected?: boolean;
  reason?: 'BILLING_OR_PERMISSION' | 'PAYMENT_FAILED';
  message?: string;
  wabaId?: string | null;
  businessId?: string | null;
  checkedAt?: string;
}
