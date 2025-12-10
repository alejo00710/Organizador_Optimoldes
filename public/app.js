// =================================================================================
// public/app.js - Planificador simplificado con molde typeahead, máquinas fijas y partes fijas
// Incluye render forzado de Plan y Calendario para evitar vistas vacías.
// =================================================================================

const API_URL = 'http://localhost:3000/api';
const SERVER_URL = API_URL.replace(/\/api\/?$/, '');
let authToken = null;
let currentUser = null;

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
let inactivityTimer = null;
const HEALTH_INTERVAL_MS = 30000;
let healthTimer = null;

// Máquinas fijas con disponibilidad
const FIXED_MACHINES = [
  { id: 'CNC',                name: 'CNC',                hoursAvailable: 30 },
  { id: 'TORNO_CNC',         name: 'Torno CNC',          hoursAvailable: 9.5 },
  { id: 'EROSIONADORA',      name: 'Erosionadora',       hoursAvailable: 14 },
  { id: 'FRESADORA',         name: 'Fresadora',          hoursAvailable: 28 },
  { id: 'RECTIFICADORA',     name: 'Rectificadora',      hoursAvailable: 14 },
  { id: 'TORNO',             name: 'Torno',              hoursAvailable: 14 },
  { id: 'TALADRO_RADIAL',    name: 'Taladro radial',     hoursAvailable: 14 },
  { id: 'PULIDA',            name: 'Pulida',             hoursAvailable: 9.5 }
];

// Partes fijas
const FIXED_PARTS = [
  "Anillo de Expulsion","Anillo de Registro","Boquilla Principal","Botador inclinado","Buje de Expulsion",
  "Buje Principal","Bujes de Rama","Correderas","Deflector de Refrigeración","Devolvedores","Electrodos",
  "Flanche actuador hidraulico","Guia actuadur hidraulico","Guia Principal","Guias de expulsion","Guias de Rama",
  "Haladores","Hembra","Hembra empotrada","Limitadores de Placa Flotante","Macho","Macho Central","Macho empotrado",
  "Molde completo","Nylon","Paralelas Porta Macho","Pilares Soporte","Placa anillos expulsores","Placa de Expulsion",
  "Placa Expulsion de Rama","Placa Portahembras","Placa Portamachos","placa respaldo anillos expulsores",
  "Placa Respaldo de Expulsion","Placa Respaldo Hembras","Placa Respaldo Inferior","Placa Respaldo Machos",
  "Placa respaldo portamachos","Placa Respaldo Superior","Placa Tope","Porta Fondo","Retenedores de Rama",
  "Soporte correderas","Soporte nylon","Tapones de Enfriamiento","Techos"
];

let cachedMolds = []; // strings

// Helpers
function displayResponse(id, data, success=true){ const el=document.getElementById(id); if(!el) return; el.className=`response-box ${success?'success':'error'}`; el.textContent = JSON.stringify(data,null,2); }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function capitalize(s){ return s ? (s.charAt(0).toUpperCase()+s.slice(1)) : ''; }
function hoursToPayload(v){ if (v==='') return ''; const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n/0.25)*0.25; }
async function isDateLaborable(dateStr){ try { const res=await fetch(`${API_URL}/working/check?date=${encodeURIComponent(dateStr)}`, { headers:{'Authorization':`Bearer ${authToken}`} }); if(!res.ok) return false; const data=await res.json(); return !!data.laborable; } catch { return false; } }

// Fecha util
function populateDayMonthYear(dayId, monthId, yearId, minYear=2016, maxYear=2027) {
  const daySel = document.getElementById(dayId);
  const monthSel = document.getElementById(monthId);
  const yearSel = document.getElementById(yearId);
  if (daySel) {
    let html = '';
    for (let i=1;i<=31;i++) html += `<option value="${i}">${i}</option>`;
    daySel.innerHTML = html;
    daySel.value = new Date().getDate();
  }
  if (monthSel) {
    monthSel.innerHTML = monthNames.map(m=>`<option value="${m}">${capitalize(m)}</option>`).join('');
    monthSel.value = monthNames[new Date().getMonth()];
  }
  if (yearSel) {
    let html = '';
    for (let y=minYear; y<=maxYear; y++) html += `<option value="${y}">${y}</option>`;
    yearSel.innerHTML = html;
    yearSel.value = new Date().getFullYear();
  }
}

// Session/connection
function updateConnectionStatus(connected) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = connected ? '● Conectado' : '● Desconectado';
  el.classList.toggle('disconnected', !connected);
}
function startHealthCheck() {
  stopHealthCheck();
  const check = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/health`, { cache: 'no-store' });
      updateConnectionStatus(res.ok);
    } catch {
      updateConnectionStatus(false);
    }
  };
  check();
  healthTimer = setInterval(check, HEALTH_INTERVAL_MS);
}
function stopHealthCheck() { if (healthTimer) clearInterval(healthTimer); healthTimer = null; }
function showLoginScreen(message='') {
  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.remove('hidden');
  if (mainApp) mainApp.classList.add('hidden');
  if (message) console.error(message);
  const pwd = document.getElementById('password'); if (pwd) pwd.value = 'admin';
  const opSel = document.getElementById('operatorSelectGroup'); if (opSel) opSel.classList.add('hidden');
  authToken=null; currentUser=null;
  localStorage.removeItem('authToken');
  updateConnectionStatus(false);
  stopHealthCheck();
  resetInactivityTimer();
}
function showMainApp(user) {
  currentUser = user; 
  authToken = localStorage.getItem('authToken');

  const usrEl = document.getElementById('displayUsername');
  const roleEl = document.getElementById('displayRole');
  const opEl = document.getElementById('displayOperator');
  if (usrEl) usrEl.textContent = user.username || '';
  if (roleEl) roleEl.textContent = (user.role || '').toUpperCase();
  if (opEl) opEl.textContent = user.operatorName || 'N/A';

  const configBtn = document.querySelector('button[data-tab="config"]');
  const planBtn = document.querySelector('button[data-tab="plan"]');
  const worklogBtn = document.querySelector('button[data-tab="worklog"]');
  if (configBtn) configBtn.classList.toggle('hidden', user.role !== 'admin');
  if (planBtn) planBtn.classList.toggle('hidden', user.role === 'operator');
  if (worklogBtn) worklogBtn.classList.toggle('hidden', user.role !== 'operator');

  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');

  updateConnectionStatus(true);
  startHealthCheck();
  startInactivityTimer();

  // Preload molds for search
  preloadMoldsForSearch();

  // AHORA SÍ renderizar - después de que todo esté listo
  const defaultTab = 'plan';
  openTab(defaultTab);
  
  // Forzar render inicial con manejo de errores visible
  setTimeout(() => {
    try { 
      renderFixedPlanningGrid(); 
      console.log('✅ Parrilla renderizada');
    } catch(e) { 
      console.error('❌ Error renderizando parrilla:', e); 
    }
  }, 100);
}

// Auth helpers
async function updateOperatorSelection(){
  const username=document.getElementById('username').value;
  const group=document.getElementById('operatorSelectGroup');
  const select=document.getElementById('operatorId');
  if (username==='operarios'){
    if (group) group.classList.remove('hidden');
    if (select) select.innerHTML='<option>Cargando...</option>';
    try{ const res=await fetch(`${API_URL}/auth/operators?username=${username}`); const ops=await res.json(); let html='<option value="">Selecciona...</option>'; ops.forEach(o=> html+=`<option value="${o.id}">${escapeHtml(o.name)}</option>` ); if (select) select.innerHTML=html; }
    catch(e){ console.error(e); if (select) select.innerHTML='<option value="">Error</option>'; }
  } else {
    if (group) group.classList.add('hidden');
    if (select) select.value='';
  }
}
async function login(e){
  if(e) e.preventDefault();
  const username=document.getElementById('username').value;
  const password=document.getElementById('password').value;
  const operatorId=document.getElementById('operatorId') ? document.getElementById('operatorId').value : null;
  const body={ username, password };
  if (username==='operarios'){
    if(!operatorId) return alert('Selecciona un operario');
    body.operatorId=operatorId;
  }
  try{
    const res=await fetch(`${API_URL}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data=await res.json();
    if(res.ok){ localStorage.setItem('authToken', data.token); verifySession(data.token); }
    else { alert(data.error || 'Error login'); updateConnectionStatus(false); }
  } catch(e){ alert('Error conexión'); updateConnectionStatus(false); }
}
async function verifySession(token){
  try{
    const res=await fetch(`${API_URL}/auth/verify`, { headers:{'Authorization':`Bearer ${token}`} });
    if(res.ok){
      const data=await res.json();
      authToken = token;
      showMainApp(data.user);
    } else {
      showLoginScreen('Sesión inválida');
    }
  } catch(e){ showLoginScreen('Error conexión'); }
}
function logout(){ showLoginScreen('Logout'); }

// Tabs
function openTab(tabName) {
  // Remover active de todos los tabs
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
  
  // Ocultar todos los contenidos
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
    content.classList.add('hidden');
  });

  // Activar tab seleccionado
  const tabBtn = document.querySelector(`button[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  
  // Mostrar contenido seleccionado
  const tabContent = document.getElementById(`tab-${tabName}`);
  if (tabContent) {
    tabContent.classList.add('active');
    tabContent.classList.remove('hidden'); // CRÍTICO: remover hidden
    console.log(`✅ Tab ${tabName} ahora visible`);
  }

  // Cargar datos específicos del tab
  if (tabName === 'calendar') {
    try { loadCalendar(); } catch(e){ console.warn('loadCalendar error', e); renderCalendar(currentYear, currentMonth, {}, {}); }
  }
  if (tabName === 'plan') {
    try { renderFixedPlanningGrid(); } catch(e){ console.warn('renderFixedPlanningGrid error', e); }
  }
  if (tabName === 'worklog') try { loadWorkLogData(); } catch(e){}
  if (tabName === 'tiempos') try { loadDatosMeta(); } catch(e){}
  if (tabName === 'datos') try { loadDatos(); } catch(e){}
}

// Planificador
async function preloadMoldsForSearch() {
  try {
    const res = await fetch(`${API_URL}/datos/meta`, { headers:{'Authorization':`Bearer ${authToken}`} });
    if (res.ok) {
      const meta = await res.json();
      const moldes = Array.isArray(meta.moldes) ? meta.moldes : [];
      cachedMolds = Array.from(new Set(moldes.map(m => String(m).trim()))).sort((a,b)=>a.localeCompare(b));
      const datalist = document.getElementById('planMoldDatalist');
      if (datalist) datalist.innerHTML = cachedMolds.slice(0, 1000).map(m => `<option value="${escapeHtml(m)}">`).join('');
      return;
    }
  } catch (_) {}
  cachedMolds = [];
}
function handleMoldTypeahead(e) {
  const q = (e.target.value || '').toLowerCase().trim();
  const datalist = document.getElementById('planMoldDatalist');
  if (!datalist) return;
  if (!q) {
    datalist.innerHTML = cachedMolds.slice(0, 1000).map(m => `<option value="${escapeHtml(m)}">`).join('');
    return;
  }
  const filtered = cachedMolds.filter(m => m.toLowerCase().includes(q)).slice(0, 1000);
  datalist.innerHTML = filtered.map(m => `<option value="${escapeHtml(m)}">`).join('');
}
async function loadPlannerData() {
  renderFixedPlanningGrid();
}
function renderFixedPlanningGrid() {
  const container = document.getElementById('planningGridContainer');
  console.log('🔍 Buscando contenedor:', container);
  
  if (!container) {
    console.error('❌ No se encontró planningGridContainer');
    return;
  }
  
  const machines = FIXED_MACHINES;
  const parts = FIXED_PARTS;
  
  console.log('📊 Renderizando con:', machines.length, 'máquinas y', parts.length, 'partes');

  let html = `
    <table id="planningGridFixed">
      <thead>
        <tr>
          <th>Parte</th>
          <th>Cantidad</th>
          ${machines.map(m => `<th>${escapeHtml(m.name)}<br><small>${m.hoursAvailable}h disp.</small></th>`).join('')}
          <th>Total Horas</th>
        </tr>
      </thead>
      <tbody>
        ${parts.map(p => `
          <tr data-part-name="${escapeHtml(p)}">
            <td class="part-name">${escapeHtml(p)}</td>
            <td><input type="number" class="qty-input" min="0" step="1" placeholder="0"></td>
            ${machines.map(m => `
              <td>
                <input type="number" class="hours-input" data-machine-id="${escapeHtml(m.id)}" min="0" step="0.5" placeholder="0">
              </td>`).join('')}
            <td class="total-hours-cell">0.00</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Totales</strong></td>
          <td></td>
          ${machines.map(m => `<td id="total-machine-${escapeHtml(m.id)}">0.00</td>`).join('')}
          <td id="grand-total">0.00</td>
        </tr>
      </tfoot>
    </table>
  `;
  
  container.innerHTML = html;
  console.log('✅ HTML insertado en contenedor');

  const inputs = container.querySelectorAll('.qty-input, .hours-input');
  console.log('🎯 Inputs encontrados:', inputs.length);
  
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      const row = input.closest('tr');
      updateFixedRowTotal(row);
      updateFixedColumnTotals();
      updateFixedGrandTotal();
    });
  });
  
  console.log('✅ Event listeners agregados');
}
function updateFixedRowTotal(row) {
  const qtyInput = row.querySelector('.qty-input');
  const qty = qtyInput ? (parseFloat(qtyInput.value)||0) : 0;
  let sumBase = 0;
  row.querySelectorAll('.hours-input').forEach(inp => {
    const v = parseFloat(inp.value);
    sumBase += isNaN(v) ? 0 : v;
  });
  const total = qty * sumBase;
  const cell = row.querySelector('.total-hours-cell');
  if (cell) cell.textContent = total.toFixed(2);
}
function updateFixedColumnTotals() {
  const grid = document.getElementById('planningGridFixed');
  if(!grid) return;
  FIXED_MACHINES.forEach(m => {
    let colSum = 0;
    grid.querySelectorAll(`tbody .hours-input[data-machine-id="${m.id}"]`).forEach(inp => {
      const v = parseFloat(inp.value);
      colSum += isNaN(v) ? 0 : v;
    });
    const cell = document.getElementById(`total-machine-${m.id}`);
    if (cell) cell.textContent = colSum.toFixed(2);
  });
}
function updateFixedGrandTotal() {
  const grid = document.getElementById('planningGridFixed');
  if(!grid) return;
  let grand = 0;
  grid.querySelectorAll('tbody .total-hours-cell').forEach(cell => {
    const v = parseFloat(cell.textContent);
    grand += isNaN(v) ? 0 : v;
  });
  const totalEl = document.getElementById('grand-total');
  if (totalEl) totalEl.textContent = grand.toFixed(2);
}

// Planificación
async function submitGridPlan(e) {
  if (e) e.preventDefault();
  const moldName = document.getElementById('planMoldInput') ? document.getElementById('planMoldInput').value.trim() : '';
  const startDateEl = document.getElementById('gridStartDate');
  const startDate = startDateEl ? startDateEl.value : '';
  if (!moldName || !startDate) return alert('Ingresa/selecciona un Molde y una Fecha de inicio.');

  const canStart = await isDateLaborable(startDate);
  if (!canStart) return alert('La fecha de inicio seleccionada no es laborable.');

  const tasksToPlan = [];
  const grid = document.getElementById('planningGridFixed');
  if (!grid) return alert('La parrilla no está lista.');

  grid.querySelectorAll('tbody tr').forEach(row => {
    const partName = row.getAttribute('data-part-name');
    const qty = parseFloat(row.querySelector('.qty-input').value) || 0;
    if (qty <= 0) return;
    row.querySelectorAll('.hours-input').forEach(inp => {
      const base = parseFloat(inp.value) || 0;
      if (base > 0) {
        const machineId = inp.getAttribute('data-machine-id');
        const totalHours = base * qty;
        tasksToPlan.push({ moldName, partName, machineId, startDate, totalHours });
      }
    });
  });

  if (!tasksToPlan.length) return alert('No hay datos para planificar.');
  const responseBox = document.getElementById('gridResponse');
  if (responseBox) responseBox.textContent = 'Enviando planificación...';

  let ok = 0, fail = 0;
  for (const task of tasksToPlan) {
    try {
      const res = await fetch(`${API_URL}/tasks/plan`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
        body: JSON.stringify(task)
      });
      if (res.ok) ok++; else fail++;
    } catch { fail++; }
  }
  displayResponse('gridResponse', { message:`Proceso finalizado. Éxitos: ${ok}, Errores: ${fail}` }, ok>0);
}

// Tiempos de Moldes
async function saveTiempoMolde(){
  const diaSel = document.getElementById('tmDia');
  const mesSel = document.getElementById('tmMes');
  const anioSel = document.getElementById('tmAnio');
  const dia = diaSel ? parseInt(diaSel.value, 10) : NaN;
  const mes = mesSel ? (mesSel.value || '').toLowerCase() : '';
  const anio = anioSel ? parseInt(anioSel.value, 10) : NaN;

  const operario = document.getElementById('tmOperario') ? document.getElementById('tmOperario').value : '';
  const proceso = document.getElementById('tmProceso') ? document.getElementById('tmProceso').value : '';

  const moldeSel = document.getElementById('tmMoldeSelect');
  const parteSel = document.getElementById('tmParteSelect');
  const molde = moldeSel && moldeSel.selectedOptions.length ? moldeSel.selectedOptions[0].value : '';
  const parte = parteSel && parteSel.selectedOptions.length ? parteSel.selectedOptions[0].value : '';

  const maquina = document.getElementById('tmMaquina') ? document.getElementById('tmMaquina').value : '';
  const operacion = document.getElementById('tmOperacion') ? document.getElementById('tmOperacion').value : '';
  const horasEl = document.getElementById('tmHoras');
  const horas = horasEl ? parseFloat(horasEl.value) : NaN;

  if (isNaN(dia) || !mes || isNaN(anio) || !operario || !proceso || !molde || !parte || !maquina || !operacion || isNaN(horas)) {
    return displayResponse('tmResponse', { error:'Completa todos los campos' }, false);
  }

  const payload = {
    dia, mes, anio,
    nombre_operario: operario,
    tipo_proceso: proceso,
    molde, parte, maquina, operacion,
    horas: Math.round(horas / 0.25) * 0.25
  };

  try{
    const res = await fetch(`${API_URL}/datos`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`}, body: JSON.stringify(payload) });
    const data = await res.json();
    displayResponse('tmResponse', data, res.ok);
    if (res.ok) loadDatosMeta();
  } catch(e){
    displayResponse('tmResponse', { error:'Error de conexión' }, false);
  }
}

// Datos Meta (Tiempos)
async function loadDatosMeta(){
  try{
    const res=await fetch(`${API_URL}/datos/meta`, { headers:{'Authorization':`Bearer ${authToken}`} });
    if (!res.ok) return;
    const meta=await res.json();

    fillDatalist('tmOperarios', meta.operarios);
    fillDatalist('tmProcesos', meta.procesos);
    fillDatalist('tmMaquinas', meta.maquinas);
    fillDatalist('tmOperaciones', meta.operaciones);

    populateSelectWithFilter('tmMoldeSelect', 'tmMoldeFilter', meta.moldes || []);
    populateSelectWithFilter('tmParteSelect', 'tmParteFilter', meta.partes || []);

    const tmAnioSel = document.getElementById('tmAnio');
    if (tmAnioSel) {
      const base = []; for (let y=2016; y<=2027; y++) base.push(y);
      const merged = Array.from(new Set([...(meta.years || []), ...base])).sort((a,b)=>b-a);
      tmAnioSel.innerHTML = merged.map(y => `<option value="${y}">${y}</option>`).join('');
      const currentY = new Date().getFullYear();
      tmAnioSel.value = merged.includes(currentY) ? currentY : String(merged[0]);
    }

    setupFilterListener('tmMoldeFilter', 'tmMoldeSelect');
    setupFilterListener('tmParteFilter', 'tmParteSelect');

  } catch(e){ console.error('loadDatosMeta', e); }
}
function fillDatalist(id, items){
  const dl=document.getElementById(id);
  if(!dl) return;
  dl.innerHTML=(items||[]).map(v=>`<option value="${escapeHtml(v)}">`).join('');
}
function populateSelectWithFilter(selectId, filterInputId, items){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.dataset.allItems = JSON.stringify(items || []);
  sel.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  sel.selectedIndex = -1;
  const filterInput = document.getElementById(filterInputId);
  if (filterInput) filterInput.value = '';
}
function setupFilterListener(filterInputId, selectId){
  const input = document.getElementById(filterInputId);
  const sel = document.getElementById(selectId);
  if (!input || !sel) return;
  if (input.dataset.bound === '1') return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const all = JSON.parse(sel.dataset.allItems || '[]');
    const filtered = q ? all.filter(v => String(v).toLowerCase().includes(q)) : all;
    sel.innerHTML = filtered.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.selectedIndex = -1;
  });
}

// Datos: historial (se mantiene como antes, con carga bajo demanda)
async function loadDatos(){
  const qs = new URLSearchParams();
  const operario = document.getElementById('datosOperario') ? document.getElementById('datosOperario').value : '';
  const molde = document.getElementById('datosMolde') ? document.getElementById('datosMolde').value : '';
  const parte = document.getElementById('datosParte') ? document.getElementById('datosParte').value : '';
  const maquina = document.getElementById('datosMaquina') ? document.getElementById('datosMaquina').value : '';
  const proceso = document.getElementById('datosProceso') ? document.getElementById('datosProceso').value : '';
  if (operario) qs.append('operario', operario);
  if (molde) qs.append('molde', molde);
  if (parte) qs.append('parte', parte);
  if (maquina) qs.append('maquina', maquina);
  if (proceso) qs.append('proceso', proceso);

  try{
    const res = await fetch(`${API_URL}/datos?${qs.toString()}`, { headers:{'Authorization':`Bearer ${authToken}`} });
    let data;
    try { data = await res.json(); } catch { return displayResponse('datosResponse', { error:'No se pudo parsear la respuesta', status:res.status }, false); }
    if (!res.ok || !Array.isArray(data)) {
      return displayResponse('datosResponse', { error:'Error cargando datos', status:res.status, body:data }, false);
    }
    const tbody = document.querySelector('#datosTable tbody'); if (!tbody) return;
    tbody.innerHTML = data.map(r => {
      const disabled = r.source === 'import' ? 'disabled' : '';
      const showSave = r.source !== 'import';
      const createdAt = r.created_at ? new Date(r.created_at).toLocaleString() : '';
      return `
        <tr data-id="${r.id}" data-source="${r.source || ''}">
          <td><input type="number" min="1" max="31" value="${r.dia ?? ''}" ${disabled}></td>
          <td><input type="text" value="${r.mes ? (capitalize(r.mes)) : ''}" ${disabled}></td>
          <td><input type="number" min="2016" max="2100" value="${r.anio ?? ''}" ${disabled}></td>
          <td><input type="text" value="${escapeHtml(r.nombre_operario ?? '')}" ${disabled}></td>
          <td><input type="text" value="${escapeHtml(r.tipo_proceso ?? '')}" ${disabled}></td>
          <td><input type="text" value="${escapeHtml(r.molde ?? '')}" ${disabled}></td>
          <td><input type="text" value="${escapeHtml(r.parte ?? '')}" ${disabled}></td>
          <td><input type="text" value="${escapeHtml(r.maquina ?? '')}" ${disabled}></td>
          <td><input type="text" value="${escapeHtml(r.operacion ?? '')}" ${disabled}></td>
          <td><input type="number" step="0.25" min="0" max="12" value="${r.horas != null ? Number(r.horas).toFixed(2) : ''}" ${disabled}></td>
          <td>${r.source === 'import' ? 'Importado' : 'Manual'}</td>
          <td>${createdAt}</td>
          <td>
            ${showSave ? `<button class="btn btn-primary btn-sm" onclick="saveDatoRow(${r.id})">Guardar</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="deleteDatoRow(${r.id})">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
    displayResponse('datosResponse', { count: data.length }, true);
  } catch(e){
    displayResponse('datosResponse', { error:'Error de conexión', details:String(e) }, false);
  }
}
async function createDatoManual(){
  const payload = {};
  const map = [
    ['datoDia','dia', v => parseInt(v,10)],
    ['datoMes','mes', v => String(v).toLowerCase()],
    ['datoAnio','anio', v => parseInt(v,10)],
    ['datoOperario','nombre_operario', v => v],
    ['datoProceso','tipo_proceso', v => v],
    ['datoMolde','molde', v => v],
    ['datoParte','parte', v => v],
    ['datoMaquina','maquina', v => v],
    ['datoOperacion','operacion', v => v],
    ['datoHoras','horas', v => Math.round(parseFloat(v)/0.25)*0.25]
  ];
  for (const [id, key, fmt] of map) {
    const el = document.getElementById(id);
    if (el && el.value !== '') payload[key] = fmt(el.value);
  }
  if (Object.keys(payload).length === 0) {
    return displayResponse('datoCrearResponse', { error:'Ingresa al menos un campo antes de guardar.' }, false);
  }
  try{
    const res = await fetch(`${API_URL}/datos`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    displayResponse('datoCrearResponse', data, res.ok);
    if (res.ok) {
      map.forEach(([id])=>{ const el=document.getElementById(id); if (el) el.value=''; });
      loadDatos();
      loadDatosMeta();
    }
  } catch(e){
    displayResponse('datoCrearResponse', { error:'Error de conexión' }, false);
  }
}
async function saveDatoRow(id){
  const row = document.querySelector(`#datosTable tbody tr[data-id="${id}"]`);
  if (!row) return;
  const inputs = row.querySelectorAll('input');
  const [diaEl, mesEl, anioEl, operarioEl, procesoEl, moldeEl, parteEl, maquinaEl, operacionEl, horasEl] = inputs;
  const payload = {
    dia: diaEl.value !== '' ? parseInt(diaEl.value, 10) : '',
    mes: mesEl.value !== '' ? mesEl.value.toLowerCase() : '',
    anio: anioEl.value !== '' ? parseInt(anioEl.value, 10) : '',
    nombre_operario: operarioEl.value,
    tipo_proceso: procesoEl.value,
    molde: moldeEl.value,
    parte: parteEl.value,
    maquina: maquinaEl.value,
    operacion: operacionEl.value,
    horas: hoursToPayload(horasEl.value)
  };

  try{
    const res = await fetch(`${API_URL}/datos/${id}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    displayResponse('datosResponse', data, res.ok);
    if (res.ok) loadDatosMeta();
  } catch(e){
    displayResponse('datosResponse', { error:'Error guardando fila' }, false);
  }
}
async function deleteDatoRow(id){
  if (!confirm('¿Eliminar este registro?')) return;
  try{
    const res = await fetch(`${API_URL}/datos/${id}`, { method:'DELETE', headers:{'Authorization':`Bearer ${authToken}`} });
    const data = await res.json();
    displayResponse('datosResponse', data, res.ok);
    if (res.ok) loadDatos();
  } catch(e){
    displayResponse('datosResponse', { error:'Error eliminando registro' }, false);
  }
}

// Importar
async function importDatosCSV(){
  const fileInput=document.getElementById('importFile'); const file=fileInput?.files?.[0];
  if(!file) return displayResponse('importResponse', { error:'Selecciona un archivo' }, false);
  const btn=document.getElementById('importBtn'); if(btn) btn.disabled=true;
  const form=new FormData(); form.append('file', file);
  try{
    const res=await fetch(`${API_URL}/import/datos`, { method:'POST', headers:{'Authorization':`Bearer ${authToken}`}, body:form });
    const data=await res.json();
    displayResponse('importResponse', data, res.ok);
  } catch(e){
    displayResponse('importResponse', { error:'Error de conexión' }, false);
  } finally{
    if(btn) btn.disabled=false;
  }
}
function renderImportDiagnostics(resp){}

// Calendario
function changeMonth(delta){ currentMonth+=delta; if(currentMonth>11){ currentMonth=0; currentYear++; } else if(currentMonth<0){ currentMonth=11; currentYear--; } loadCalendar(); }
async function loadCalendar(){ 
  if(!authToken) return;
  const display=document.getElementById('calendar-month-year');
  const grid=document.getElementById('calendar-grid');
  if(display) display.textContent=`${capitalize(monthNames[currentMonth])} ${currentYear}`;
  if(grid) grid.innerHTML='Cargando...';
  try {
    const res = await fetch(`${API_URL}/calendar/month-view?year=${currentYear}&month=${currentMonth+1}`, { headers:{'Authorization':`Bearer ${authToken}`} });
    const data = await res.json();
    if (res.ok) renderCalendar(currentYear,currentMonth,data.events || {}, data.holidays || {});
    else if (grid) grid.innerHTML = '<p>Error cargar calendario</p>';
  } catch(e){
    if(grid) grid.innerHTML='Error cargar calendario';
  }
}
function renderCalendar(year, month, events={}, holidays={}) {
  const grid=document.getElementById('calendar-grid');
  if(!grid) return;
  grid.innerHTML='';
  const todayStr=new Date().toISOString().split('T')[0];
  const firstDay=new Date(year, month, 1);
  const startDayIndex = firstDay.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();

  for(let i=0;i<startDayIndex;i++){ const d=document.createElement('div'); d.className='calendar-day other-month'; grid.appendChild(d); }

  for(let d=1; d<=daysInMonth; d++){
    const date=new Date(year, month, d);
    const dateStr=date.toISOString().split('T')[0];
    const cell=document.createElement('div'); cell.className='calendar-day';
    cell.innerHTML=`<div class="day-number">${d}</div>`;
    if(dateStr===todayStr) cell.classList.add('today');
    if(date.getDay()===0||date.getDay()===6) cell.classList.add('weekend');
    if(holidays[dateStr]){ cell.classList.add('holiday'); cell.innerHTML += `<div class="holiday-name">${escapeHtml(holidays[dateStr])}</div>`; }
    if(events && events[d]){ const total = Object.values(events[d].machineUsage || {}).reduce((a,b)=>a+(b||0),0); cell.classList.add('has-events'); cell.innerHTML += `<div class="events-indicator">${total.toFixed(1)}h</div>`; }
    cell.addEventListener('click', ()=> showDayDetails(date, events[d], holidays[dateStr]));
    grid.appendChild(cell);
  }
}
function showDayDetails(date, events, holiday){
  const modal=document.getElementById('day-details-modal');
  const body=document.getElementById('modal-body');
  const titleEl=document.getElementById('modal-title');
  const dateStr=date.toISOString().split('T')[0];
  if (titleEl) titleEl.textContent = date.toLocaleDateString();
  let html = '';
  if (holiday) html += `<p>🎉 ${escapeHtml(holiday)}</p>`;
  if (events && events.tasks && events.tasks.length) {
    html += '<ul>';
    events.tasks.forEach(t => html += `<li>${escapeHtml(t.machine)}: ${escapeHtml(t.mold)} (${escapeHtml(t.part)}) - ${t.hours}h</li>`);
    html += '</ul>';
  } else {
    html += '<p>No hay tareas planificadas para este día.</p>';
  }
  html += `<div style="margin-top:12px;"><button class="btn btn-secondary" id="toggleWorkingBtn">Cargando estado...</button><small style="display:block; margin-top:6px;">Esto crea una excepción para este día.</small></div>`;
  if (body) body.innerHTML = html;

  (async()=>{
    const laborable = await isDateLaborable(dateStr);
    const btn = document.getElementById('toggleWorkingBtn');
    if(!btn) return;
    btn.textContent = laborable ? 'Deshabilitar día' : 'Habilitar día';
    btn.onclick = async () => {
      const desired = !laborable;
      try {
        const res = await fetch(`${API_URL}/working/override`, {
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`},
          body: JSON.stringify({ date: dateStr, isWorking: desired })
        });
        if (res.ok) { alert(`Día ${desired ? 'habilitado' : 'deshabilitado'} correctamente.`); hideModal(); loadCalendar(); }
        else alert('No se pudo actualizar el estado del día.');
      } catch (e) { alert('Error de conexión al actualizar el estado del día.'); }
    };
  })();

  if (modal) modal.classList.remove('hidden');
}
function hideModal(){ const modal=document.getElementById('day-details-modal'); if (modal) modal.classList.add('hidden'); }

// Worklog (stubs)
async function loadWorkLogData(){ }
async function createWorkLogEntry(e){ if(e) e.preventDefault(); alert('Registro de trabajo enviado (demo).'); }

// Inactividad
function resetInactivityTimer(){ clearTimeout(inactivityTimer); if(authToken) inactivityTimer=setTimeout(logout, INACTIVITY_TIMEOUT); }
function startInactivityTimer(){ window.onclick=resetInactivityTimer; window.onkeypress=resetInactivityTimer; resetInactivityTimer(); }

// Entry
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();

  const dateInput = document.getElementById('gridStartDate');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  populateDayMonthYear('tmDia','tmMes','tmAnio');

  updateConnectionStatus(false);

  const savedToken = localStorage.getItem('authToken');
  if (savedToken) verifySession(savedToken);
  else showLoginScreen();
});

// Listeners
function setupEventListeners() {
  const loginBtn = document.getElementById('loginBtn'); 
  if (loginBtn) loginBtn.addEventListener('click', login);
  
  const usernameSel = document.getElementById('username'); 
  if (usernameSel) usernameSel.addEventListener('change', updateOperatorSelection);
  
  const logoutBtn = document.getElementById('logoutBtn'); 
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', (e) => openTab(e.target.getAttribute('data-tab')));
  });

  // Planificador
  const moldInput = document.getElementById('planMoldInput');
  const moldList = document.getElementById('planMoldDatalist');
  if (moldInput && moldList) moldInput.addEventListener('input', handleMoldTypeahead);
  
  const submitPlanBtn = document.getElementById('submitGridPlanBtn');
  if (submitPlanBtn) submitPlanBtn.addEventListener('click', (e)=> submitGridPlan(e));

  // Calendario
  const prevMonthBtn = document.getElementById('prev-month-btn'); 
  if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeMonth(-1));
  
  const nextMonthBtn = document.getElementById('next-month-btn'); 
  if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeMonth(1));
  
  const modalCloseBtn = document.getElementById('modal-close-btn'); 
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideModal);

  // Datos/Tiempos/Import
  const datosBuscarBtn = document.getElementById('datosBuscarBtn'); 
  if (datosBuscarBtn) datosBuscarBtn.addEventListener('click', loadDatos);
  
  const tmGuardarBtn = document.getElementById('tmGuardarBtn'); 
  if (tmGuardarBtn) tmGuardarBtn.addEventListener('click', (e)=>{ e.preventDefault(); saveTiempoMolde(); });
  
  const importBtn = document.getElementById('importBtn'); 
  if (importBtn) importBtn.addEventListener('click', importDatosCSV);
  
  const datoCrearBtn = document.getElementById('datoCrearBtn'); 
  if (datoCrearBtn) datoCrearBtn.addEventListener('click', createDatoManual);

}