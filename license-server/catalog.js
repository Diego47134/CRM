/**
 * Catálogo de planes y precios. Los precios se pueden cambiar con la variable de entorno
 * PRICES_JSON, por ejemplo: {"starter":{"month":15,"year":149},"pro":{"month":39,"year":390}}
 */
export const PLAN_CATALOG = {
  starter: { label: 'Starter', seats: 3, summary: 'Contactos, empresas, oportunidades, actividades, productos e importación' },
  pro: { label: 'Profesional', seats: 10, summary: 'Todo Starter + presupuestos y facturas, soporte, informes y campos personalizados' },
  business: { label: 'Business', seats: 50, summary: 'Todo Profesional + API REST, webhooks y auditoría' },
};

export const DEFAULT_PRICES = {
  starter: { month: 15, year: 149 },
  pro: { month: 39, year: 390 },
  business: { month: 89, year: 890 },
};

export const INTERVALS = { month: 'MONTH', year: 'YEAR' };

export function loadPrices(env = process.env) {
  if (!env.PRICES_JSON) return DEFAULT_PRICES;
  const custom = JSON.parse(env.PRICES_JSON);
  const out = {};
  for (const plan of Object.keys(PLAN_CATALOG)) {
    out[plan] = { ...DEFAULT_PRICES[plan], ...(custom[plan] || {}) };
  }
  return out;
}
