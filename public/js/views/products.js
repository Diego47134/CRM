import {
  esc, icon, money, formModal, withCustomFields, toast, isManager, state, setTitle, hasFeature,
} from '../ui.js';
import { api } from '../api.js';
import { listView } from '../list.js';

const fields = () => [
  { key: 'name', label: 'Nombre', required: true, full: true },
  { key: 'sku', label: 'Referencia / SKU' },
  { key: 'category', label: 'Categoría' },
  { key: 'price', label: `Precio (${state.settings.currency || 'EUR'})`, type: 'number', min: 0, required: true, default: 0 },
  { key: 'tax_rate', label: 'IVA / impuesto %', type: 'number', min: 0, max: 100, default: state.settings.default_tax_rate || 21 },
  { key: 'cost', label: 'Coste', type: 'number', min: 0, hint: 'Para calcular el margen' },
  { key: 'unit', label: 'Unidad', default: 'ud', placeholder: 'ud, h, kg, mes…' },
  { key: 'active', label: 'Activo (disponible en presupuestos)', type: 'checkbox' },
  { key: 'description', label: 'Descripción', type: 'textarea' },
];

async function openForm(values = { active: 1 }) {
  const f = await withCustomFields('products', fields());
  return formModal({
    title: values.id ? 'Editar producto' : 'Nuevo producto', fields: f, values,
    onSubmit: async (data) => {
      const r = values.id ? await api.patch(`/products/${values.id}`, data) : await api.post('/products', data);
      toast('Producto guardado', 'success');
      return r;
    },
  });
}

export function render(root) {
  setTitle('Productos');
  listView(root, {
    title: 'Productos y servicios',
    endpoint: '/products',
    singular: 'producto',
    plural: 'productos',
    newLabel: 'Nuevo producto',
    defaultSort: 'name',
    defaultDir: 'asc',
    hasOwner: false,
    emptyIcon: 'box',
    emptyText: 'Crea tu catálogo para añadir productos a presupuestos y facturas en un clic.',
    headerActions: hasFeature('import_export') && isManager() ? `<a class="btn" href="#/settings/import">${icon('upload')}<span class="hide-sm">Importar</span></a>` : '',
    filters: [{ key: 'active', label: 'Estado', options: [['1', 'Activos'], ['0', 'Inactivos']], default: '1' }],
    bulkFields: [{ key: 'active', label: 'Estado', options: [['1', 'Activar'], ['0', 'Desactivar']] }],
    columns: [
      { label: 'Producto', sort: 'name', render: (p) => `<b>${esc(p.name)}</b><div class="small muted ellipsis" style="max-width:360px">${esc(p.description || '')}</div>` },
      { label: 'SKU', sort: 'sku', render: (p) => `<code>${esc(p.sku || '')}</code>` },
      { label: 'Categoría', sort: 'category', render: (p) => esc(p.category || '') },
      { label: 'Precio', sort: 'price', cls: 'num', render: (p) => `${money(p.price)}<span class="muted small"> /${esc(p.unit)}</span>` },
      { label: 'IVA', cls: 'num', render: (p) => `${p.tax_rate}%` },
      { label: 'Margen', cls: 'num', render: (p) => (p.cost != null && p.price > 0 ? `${Math.round(((p.price - p.cost) / p.price) * 100)}%` : '<span class="muted">—</span>') },
      { label: 'Estado', render: (p) => (p.active ? '<span class="badge green">Activo</span>' : '<span class="badge">Inactivo</span>') },
    ],
    onRowClick: (p) => openForm(p),
    onNew: () => openForm(),
  });
}
