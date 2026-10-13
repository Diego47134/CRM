/**
 * Cliente mínimo de la API REST de PayPal (suscripciones).
 * Documentación: https://developer.paypal.com/docs/api/subscriptions/v1/
 */
export function createPayPal({ clientId, clientSecret, mode = 'sandbox', baseUrl } = {}) {
  if (!clientId || !clientSecret) throw new Error('Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET');
  const base = baseUrl || (mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
  let token = null;
  let tokenExpires = 0;

  async function auth() {
    if (token && Date.now() < tokenExpires) return token;
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PayPal: no se pudo autenticar (${res.status} ${data.error_description || data.error || ''})`);
    token = data.access_token;
    tokenExpires = Date.now() + (Number(data.expires_in || 3000) - 60) * 1000;
    return token;
  }

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await auth()}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.details?.map((d) => d.description || d.issue).join('; ') || data.message || '';
      const err = new Error(`PayPal ${method} ${path}: ${res.status} ${detail}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    mode,
    createProduct: (name) => call('POST', '/v1/catalogs/products', { name, type: 'SERVICE', category: 'SOFTWARE' }),
    createPlan: ({ productId, name, intervalUnit, price, currency }) => call('POST', '/v1/billing/plans', {
      product_id: productId,
      name,
      status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: intervalUnit, interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: String(price), currency_code: currency } },
      }],
      payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 2 },
    }),
    createSubscription: ({ planId, customId, email, name, brandName, returnUrl, cancelUrl }) => call('POST', '/v1/billing/subscriptions', {
      plan_id: planId,
      custom_id: customId,
      subscriber: {
        ...(email ? { email_address: email } : {}),
        ...(name ? { name: { given_name: String(name).slice(0, 140) } } : {}),
      },
      application_context: {
        brand_name: brandName,
        locale: 'es-ES',
        user_action: 'SUBSCRIBE_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
    getSubscription: (id) => call('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`),
  };
}
