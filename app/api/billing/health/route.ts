import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/auth/require-session';
import { dodoConfig, isDodoConfigured } from '../../../../lib/billing/dodo';
import { adminRest, hasServiceRole } from '../../../../lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Signed-in diagnostic for the payment setup. Reports only whether each piece works —
 * never any key, secret or customer data.
 */
export async function GET(request: Request) {
  const { response } = await requireSession(request);
  if (response) return response;

  const report: Record<string, unknown> = {
    environment: dodoConfig.environment,
    apiKeySet: Boolean(dodoConfig.apiKey),
    productIdSet: Boolean(dodoConfig.productId),
    productIdLooksRight: Boolean(dodoConfig.productId?.startsWith('pdt_')),
    webhookSecretSet: Boolean(dodoConfig.webhookSecret),
    webhookSecretLooksRight: Boolean(dodoConfig.webhookSecret?.startsWith('whsec_')),
    serviceRoleSet: hasServiceRole(),
  };

  if (hasServiceRole()) {
    try {
      await adminRest('billing_events?select=id&limit=1');
      report.serviceRoleWorks = true;
    } catch (error) {
      report.serviceRoleWorks = false;
      report.serviceRoleError = String(error instanceof Error ? error.message : error).replace(/[A-Za-z0-9_\-.]{30,}/g, '[redacted]').slice(0, 200);
    }
  }

  if (isDodoConfigured()) {
    const base = dodoConfig.environment === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
    const product = await fetch(`${base}/products/${encodeURIComponent(dodoConfig.productId!)}`, {
      headers: { authorization: `Bearer ${dodoConfig.apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    report.dodoProductLookup = product ? product.status : 'unreachable';
    if (product?.ok) {
      const body = await product.json().catch(() => ({})) as { is_recurring?: boolean; price?: { type?: string } };
      report.productIsSubscription = Boolean(body.is_recurring) || body.price?.type === 'recurring_price';
    }
  }

  return NextResponse.json(report);
}
