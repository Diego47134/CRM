import { api } from '../api.js';
import { $, esc } from '../ui.js';

export function renderLogin(root, onDone) {
  document.title = 'Iniciar sesión · NexoCRM';
  root.innerHTML = `
    <div class="auth">
      <div class="card auth-card"><div class="card-body">
        <div class="row" style="margin-bottom:18px"><span class="brand-logo">N</span><b style="font-size:17px">NexoCRM</b></div>
        <h1>Iniciar sesión</h1>
        <p class="muted" style="margin:4px 0 20px">Accede a tu CRM</p>
        <form class="stack" id="login-form">
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
          <label class="field"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" required></label>
          <div class="badge red hidden" id="login-err" style="height:auto;padding:8px 12px;white-space:normal"></div>
          <button class="btn primary" type="submit" style="height:40px">Entrar</button>
        </form>
        <p class="small muted" style="margin:18px 0 0">¿Has olvidado tu contraseña? Pide a un administrador que la restablezca.</p>
      </div></div>
    </div>`;
  const form = $('#login-form', root);
  setTimeout(() => form.email.focus(), 20);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-err', root);
    err.classList.add('hidden');
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const res = await api.post('/auth/login', { email: form.email.value, password: form.password.value });
      await onDone(res.token, res.user);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
}

export function renderSetup(root, onDone) {
  document.title = 'Configuración inicial · NexoCRM';
  root.innerHTML = `
    <div class="auth">
      <div class="card auth-card" style="max-width:500px"><div class="card-body">
        <div class="row" style="margin-bottom:18px"><span class="brand-logo">N</span><b style="font-size:17px">NexoCRM</b></div>
        <h1>Bienvenido 👋</h1>
        <p class="muted" style="margin:4px 0 20px">Configura tu CRM en menos de un minuto. Empiezas con ${esc('14')} días de prueba con todas las funciones.</p>
        <form class="stack" id="setup-form">
          <label class="field"><span>Nombre de tu empresa</span><input type="text" name="company_name" required placeholder="Mi Empresa SL"></label>
          <div class="form-grid">
            <label class="field"><span>Tu nombre</span><input type="text" name="name" required autocomplete="name"></label>
            <label class="field"><span>Moneda</span><select name="currency">
              ${['EUR', 'USD', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'GBP'].map((c) => `<option>${c}</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>Email (usuario administrador)</span><input type="email" name="email" required autocomplete="username"></label>
          <label class="field"><span>Contraseña</span><input type="password" name="password" required minlength="8" autocomplete="new-password"><span class="hint">Mínimo 8 caracteres</span></label>
          <label class="check"><input type="checkbox" name="demo" checked> Cargar datos de ejemplo para explorar el CRM</label>
          <div class="badge red hidden" id="setup-err" style="height:auto;padding:8px 12px;white-space:normal"></div>
          <button class="btn primary" type="submit" style="height:40px">Crear mi CRM</button>
        </form>
      </div></div>
    </div>`;
  const form = $('#setup-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#setup-err', root);
    err.classList.add('hidden');
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const res = await api.post('/setup', {
        company_name: form.company_name.value, name: form.name.value, email: form.email.value,
        password: form.password.value, currency: form.currency.value, demo: form.demo.checked,
      });
      await onDone(res.token, res.user);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
}
