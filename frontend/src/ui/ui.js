import { state } from '../core/state.js';

export function getOrCreateToastHost() {
  let host = document.getElementById('toastHost');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'toastHost';
  host.className = 'toast-host';
  document.body.appendChild(host);
  return host;
}

export function extractUserMessage(data, success) {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.note === 'string' && data.note.trim()) return data.note;
  }
  if (!success) return 'Ocurrió un error';
  return null;
}

export function showToast(message, success = true) {
  const msg = String(message ?? '').trim();
  if (!msg) return;
  const host = getOrCreateToastHost();
  host.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = `toast ${success ? 'success' : 'error'}`;
  toast.textContent = msg;
  host.appendChild(toast);

  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    host.innerHTML = '';
    state.toastTimer = null;
  }, 3000);
}

export function displayResponse(id, data, success = true) {
  const el = document.getElementById(id);
  const msg = extractUserMessage(data, success);
  if (msg) showToast(msg, success);

  try {
    if (!success) console.error('[UI]', id, data);
    else if (UI_VERBOSE_RESPONSES) console.log('[UI]', id, data);
  } catch (_) {}

  // Evitar que se acumulen mensajes largos al final.
  if (!el) return;
  if (!UI_VERBOSE_RESPONSES) {
    el.textContent = '';
    el.className = 'response-box hidden';
    return;
  }

  el.className = `response-box ${success ? 'success' : 'error'}`;
  try { el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2); }
  catch { el.textContent = String(data); }
}

export function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
export function capitalize(s) { return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : ''; }

export function parseLocaleNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let normalized = s;
  if (hasComma && hasDot) {
    // Asumimos formato miles con punto y decimales con coma: 1.234,56
    normalized = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (hasComma) {
    normalized = s.replace(/,/g, '.');
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function formatCurrencyCOP(raw) {
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return '$ 0';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch (_) {
    return `$ ${Math.round(n).toLocaleString('es-CO')}`;
  }
}

export function openTab(tabName) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
    content.classList.add('hidden');
  });
  const tabBtn = document.querySelector(`button[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const tabContent = document.getElementById(`tab-${tabName}`);
  if (tabContent) {
    tabContent.classList.add('active');
    tabContent.classList.remove('hidden');
  }

  if (tabName === 'calendar') try { loadCalendar(); } catch (e) {}
  if (tabName === 'terminados') {
    try { wireCompletedMoldsViewControls(); } catch (_) {}
    try { renderCompletedMoldList(); } catch (_) {}
  }
  if (tabName === 'plan') {
    try { initPlannerTab(); } catch (e) {}
  }
  if (tabName === 'tiempos') {
    try { loadHoursOptions(); } catch (e) {}
    try { loadTiemposMeta(); } catch (e) {}
  }
  if (tabName === 'registros') {
    try { ensureWorkLogsMeta(); } catch (e) {}
    try { loadWorkLogsHistory(true); } catch (e) {}
  }
  if (tabName === 'datos') try { loadDatos(true); } catch (e) {}
  if (tabName === 'config') {
    try { loadMachinesList(); } catch (e) {}
    try { loadConfigPartsChecklist(); } catch (e) {}
    try { loadOperatorsList(); } catch (e) {}
    try { loadHolidaysList(); } catch (e) {}
  }
  if (tabName === 'indicators') {
    try { defaultYearForIndicators(); } catch (e) {}
    try { loadOperatorsForIndicators(); } catch (e) {}
  }
  if (tabName === 'financial') {
    try { loadFinancialMachines(); } catch (e) {}
    try { loadCompletedCycles(); } catch (e) {}
  }
  if (tabName === 'sesiones') {
    try { loadSessionsHistory(); } catch (e) {}
  }
}

export function setupStickyTabsOffset() {
  if (window.__stickyTabsOffsetApi) {
    window.__stickyTabsOffsetApi.applyOffset();
    return;
  }

  const applyOffset = () => {
    const header = document.querySelector('.header');
    if (!header) return;
    const rect = header.getBoundingClientRect();
    const h = Math.max(0, Math.ceil(rect.height));
    if (h < 1) return; // header may be hidden (height 0) before login
    document.documentElement.style.setProperty('--tabs-sticky-top', `${h}px`);
  };

  // Initial measurement
  applyOffset();

  // Recompute on resize (layout changes, zoom, responsive)
  let rafId = 0;
  window.addEventListener('resize', () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      applyOffset();
    });
  });

  window.__stickyTabsOffsetApi = { applyOffset };
}

export function setupFixedTabsBar() {
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;

  if (tabs.__fixedTabsApi) {
    tabs.__fixedTabsApi.recomputeAnchor();
    tabs.__fixedTabsApi.applyState();
    return;
  }

  const existingPlaceholder = tabs.previousElementSibling && tabs.previousElementSibling.classList?.contains('tabs-placeholder')
    ? tabs.previousElementSibling
    : null;
  const placeholder = existingPlaceholder || document.createElement('div');
  if (!existingPlaceholder) {
    placeholder.className = 'tabs-placeholder';
    tabs.parentNode?.insertBefore(placeholder, tabs);
  }

  let tabsOriginalTop = 0;

  const headerHeight = () => {
    const header = document.querySelector('.header');
    return header ? Math.ceil(header.getBoundingClientRect().height) : 0;
  };

  const setFixedGeometryVars = () => {
    const card = tabs.closest('.card') || document.body;
    const rect = card.getBoundingClientRect();
    document.documentElement.style.setProperty('--tabs-fixed-left', `${Math.max(0, Math.round(rect.left))}px`);
    document.documentElement.style.setProperty('--tabs-fixed-width', `${Math.max(0, Math.round(rect.width))}px`);
  };

  const recomputeAnchor = () => {
    // If the app is still hidden (before login), measurements are 0 and would hide the tabs.
    if (tabs.offsetParent === null || tabs.getBoundingClientRect().width < 1) return false;
    tabs.classList.remove('is-fixed');
    placeholder.style.display = 'none';
    placeholder.style.height = '0px';
    setFixedGeometryVars();
    tabsOriginalTop = tabs.getBoundingClientRect().top + window.scrollY;
    return true;
  };

  const applyState = () => {
    const shouldFix = window.scrollY >= (tabsOriginalTop - headerHeight());
    if (shouldFix) {
      if (!tabs.classList.contains('is-fixed')) {
        setFixedGeometryVars();
        const h = Math.ceil(tabs.getBoundingClientRect().height);
        placeholder.style.height = `${h}px`;
        placeholder.style.display = 'block';
        tabs.classList.add('is-fixed');
      } else {
        setFixedGeometryVars();
      }
    } else {
      if (tabs.classList.contains('is-fixed')) {
        tabs.classList.remove('is-fixed');
        placeholder.style.display = 'none';
        placeholder.style.height = '0px';
      }
    }
  };

  const tryInit = () => {
    if (!recomputeAnchor()) {
      requestAnimationFrame(tryInit);
      return;
    }
    applyState();
  };
  tryInit();

  let rafId = 0;
  window.addEventListener('scroll', () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      applyState();
    });
  }, { passive: true });

  window.addEventListener('resize', () => {
    recomputeAnchor();
    applyState();
  });

  tabs.__fixedTabsApi = { recomputeAnchor, applyState };
}

export function setupLegalFooter() {
  const footer = document.getElementById('appFooter');
  if (!footer) return;

  const modal = document.getElementById('legal-modal');
  const titleEl = document.getElementById('legal-modal-title');
  const bodyEl = document.getElementById('legal-modal-body');
  const closeBtn = document.getElementById('legal-modal-close-btn');

  if (!modal || !titleEl || !bodyEl || !closeBtn) return;

  const contentByKey = {
    aviso: {
      title: 'Aviso Legal de Uso del Sistema',
      bodyHtml: `
        <p>Este sistema es propiedad y de uso exclusivo de Optimoldes S.A.S.</p>
        <p>
          Su acceso y utilización están permitidos únicamente a personal autorizado de la empresa
          para realizar labores operativas, administrativas y de gestión interna.
        </p>
        <p>
          La información registrada en este aplicativo es confidencial y está destinada exclusivamente
          a fines laborales y de mejora de procesos internos.
        </p>
        <p>
          Queda estrictamente prohibida la reproducción, distribución, modificación o uso no autorizado
          de este sistema o su contenido fuera del ámbito de Optimoldes S.A.S.
        </p>
      `.trim()
    },
    datos: {
      title: 'Política de Tratamiento de Datos Personales',
      bodyHtml: `
        <p>
          Optimoldes S.A.S., identificado con NIT 900069620, con domicilio principal en Cra. 41c #50-16(Itagüi, Antioquia),
          es el responsable del tratamiento de los datos personales que sean registrados en este sistema.
        </p>

        <h4>1. Finalidad del Tratamiento</h4>
        <p>
          Los datos personales que se recolectan y procesan en este aplicativo, tales como nombre, cargo,
          área de trabajo, información de tareas, tiempos y producción, serán utilizados exclusivamente para:
        </p>
        <ul>
          <li>Control operativo interno.</li>
          <li>Generación de indicadores de eficiencia y mejora de procesos.</li>
          <li>Gestión y seguimiento administrativo y operativo de trabajo dentro de la empresa.</li>
        </ul>

        <h4>2. Principios Aplicables</h4>
        <p>
          El tratamiento de los datos personales se realiza observando los principios de legalidad, finalidad,
          acceso y circulación restringida, veracidad, transparencia y seguridad, conforme a lo dispuesto en la
          Ley 1581 de 2012 y normas reglamentarias.
        </p>

        <h4>3. Derechos de los Titulares</h4>
        <p>Los titulares de los datos tienen derecho a:</p>
        <ul>
          <li>Conocer, actualizar y rectificar sus datos personales frente a Optimoldes S.A.S.</li>
          <li>Solicitar prueba de la autorización otorgada para su tratamiento (en los casos que se requiera).</li>
          <li>Ser informado sobre el uso dado a sus datos.</li>
          <li>Presentar quejas ante la Superintendencia de Industria y Comercio por infracciones a la ley.</li>
          <li>
            Revocar la autorización y/o solicitar la supresión de los datos cuando no se respeten los principios,
            derechos y garantías legales.
          </li>
        </ul>

        <h4>4. Medios de Atención</h4>
        <p>
          Las solicitudes de acceso, consulta, corrección o eliminación pueden dirigirse a través de los canales
          internos de atención dispuestos por Optimoldes S.A.S., o según los procesos internos establecidos por
          la empresa para estos efectos.
        </p>
      `.trim()
    },
    propiedad: {
      title: 'Información Legal',
      bodyHtml: `
        <p><strong>© 2026 Optimoldes S.A.S. Todos los derechos reservados.</strong></p>
        <p>
          Este software y su código fuente son propiedad exclusiva de Optimoldes S.A.S.
        </p>
        <p>
          Queda prohibida la reproducción, distribución, modificación, publicación o uso no autorizado de este sistema
          o cualquier parte del mismo sin el consentimiento expreso de Optimoldes S.A.S.
        </p>
      `.trim()
    }
  };

  let lastActiveEl = null;

  const open = (key) => {
    const entry = contentByKey[key];
    if (!entry) return;

    lastActiveEl = document.activeElement;
    titleEl.textContent = entry.title;
    bodyEl.innerHTML = entry.bodyHtml;
    modal.classList.remove('hidden');
    closeBtn.focus();
  };

  const close = () => {
    modal.classList.add('hidden');
    bodyEl.scrollTop = 0;
    if (lastActiveEl && typeof lastActiveEl.focus === 'function') {
      try { lastActiveEl.focus(); } catch (_) {}
    }
    lastActiveEl = null;
  };

  footer.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[data-legal]');
    if (!a) return;
    e.preventDefault();
    open(String(a.getAttribute('data-legal') || '').trim());
  });

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    close();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal.classList.contains('hidden')) return;
    close();
  });
}

export function hideModal() { const modal = document.getElementById('day-details-modal'); if (modal) modal.classList.add('hidden'); }

export function fmtDateTime(v) {
  if (!v) return '';
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}

export function parseISODateOnlyLocal(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const out = new Date(y, m - 1, d);
  if (Number.isNaN(out.getTime())) return null;
  return out;
}

export function fmtDateOnly(v) {
  if (!v) return '';
  try {
    const s = String(v).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch { return String(v); }
}

export function formatDateDisplay(v) {
  const iso = fmtDateOnly(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function parseUiDateToISO(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return '';
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return '';
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = parseISODateOnlyLocal(iso);
  return check ? iso : '';
}

export function formatTimeHM(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}




export function initNavigationEvents() {
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = el.getAttribute('data-tab');
      if (tabName) openTab(tabName);
    });
  });
  initErrorHandlers();
  initGlobalDelegation();
}

export function initErrorHandlers() {
  window.addEventListener('error', (ev) => {
    const msg = ev?.message || 'Error inesperado en la aplicación';
    showToast(msg, false);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev?.reason;
    const msg = (reason && reason.message) ? reason.message : (reason ? String(reason) : 'Error inesperado (promesa)');
    showToast(msg, false);
  });
}

export function initGlobalDelegation() {
  document.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('button[data-action]');
    if (!btn) return;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    // La mayoría de las acciones ahora se manejan en sus propios listeners de tabla/form.
  });
}
