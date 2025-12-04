// =================================================================================
// 1. CONSTANTES Y VARIABLES GLOBALES
// =================================================================================
const API_URL = 'http://localhost:3000/api';
const SERVER_URL = API_URL.replace(/\/api\/?$/, '');
let authToken = null;
let currentUser = null;

let cachedMachines = [];
let cachedParts = [];

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
let inactivityTimer = null;
const HEALTH_INTERVAL_MS = 30000;
let healthTimer = null;

// =================================================================================
// 2. PUNTO DE ENTRADA
// =================================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();

  const dateInput = document.getElementById('gridStartDate');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  // Tiempos de Moldes: selects elegibles (Día/Mes/Año)
  populateDayMonthYear('tmDia','tmMes','tmAnio');

  updateConnectionStatus(false);

  const savedToken = localStorage.getItem('authToken');
  if (savedToken) verifySession(savedToken);
  else showLoginScreen();
});

// =================================================================================
// 3. SESIÓN Y PANTALLAS
// =================================================================================
function updateConnectionStatus(connected) {
  const el = document.getElementById('status');
  if (!el) return;
  if (connected) {
    el.classList.remove('disconnected');
    el.textContent = '● Conectado';
  } else {
    el.classList.add('disconnected');
    el.textContent = '● Desconectado';
  }
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
  currentUser = user; authToken = localStorage.getItem('authToken');

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

  const defaultTab = user.role === 'operator' ? 'worklog' : 'plan';
  openTab(defaultTab);

  const loginContainer = document.getElementById('loginContainer');
  const mainApp = document.getElementById('mainApp');
  if (loginContainer) loginContainer.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');

  updateConnectionStatus(true);
  startHealthCheck();
  startInactivityTimer();
}
function openTab(tabName) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  const tabBtn = document.querySelector(`button[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const tabContent = document.getElementById(`tab-${tabName}`);
  if (tabContent) tabContent.classList.add('active');

  if (tabName === 'calendar') loadCalendar();
  if (tabName === 'plan') loadPlannerData();
  if (tabName === 'worklog') loadWorkLogData();
  if (tabName === 'tiempos') loadDatosMeta();
  if (tabName === 'datos') loadDatos();
}

// =================================================================================
// 4. EVENTOS
// =================================================================================
function setupEventListeners() {
  const loginBtn = document.getElementById('loginBtn'); if (loginBtn) loginBtn.addEventListener('click', login);
  const usernameSel = document.getElementById('username'); if (usernameSel) usernameSel.addEventListener('change', updateOperatorSelection);
  const logoutBtn = document.getElementById('logoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', logout);

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', (e) => openTab(e.target.getAttribute('data-tab')));
  });

  const planSel = document.getElementById('planMoldSelector'); if (planSel) planSel.addEventListener('change', loadPlanningGrid);
  const startDateEl = document.getElementById('gridStartDate'); if (startDateEl) startDateEl.addEventListener('change', loadPlanningGrid);

  // IMPORTANTE: enlazar de forma segura para evitar ReferenceError si la función no existe aún
  const submitPlanBtn = document.getElementById('submitGridPlanBtn');
  if (submitPlanBtn) submitPlanBtn.addEventListener('click', (e) => {
    if (typeof window.submitGridPlan === 'function') return window.submitGridPlan(e);
    alert('Acción no disponible: submitGridPlan no está definida.');
  });

  const prevMonthBtn = document.getElementById('prev-month-btn'); if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeMonth(-1));
  const nextMonthBtn = document.getElementById('next-month-btn'); if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeMonth(1));
  const modalCloseBtn = document.getElementById('modal-close-btn'); if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideModal);

  const createMachineBtn = document.getElementById('createMachineBtn'); if (createMachineBtn) createMachineBtn.addEventListener('click', () => createMasterData('machine'));
  const createMoldBtn = document.getElementById('createMoldBtn'); if (createMoldBtn) createMoldBtn.addEventListener('click', () => createMasterData('mold'));
  const createPartBtn = document.getElementById('createPartBtn'); if (createPartBtn) createPartBtn.addEventListener('click', () => createMasterData('part'));
  const createHolidayBtn = document.getElementById('createHolidayBtn'); if (createHolidayBtn) createHolidayBtn.addEventListener('click', createHoliday);
  const deleteHolidayBtn = document.getElementById('deleteHolidayBtn'); if (deleteHolidayBtn) deleteHolidayBtn.addEventListener('click', () => alert('Selecciona un festivo de la lista para eliminar'));

  const createWorkLogBtn = document.getElementById('createWorkLogBtn');
  if (createWorkLogBtn) createWorkLogBtn.addEventListener('click', (e) => {
    if (typeof window.createWorkLogEntry === 'function') return window.createWorkLogEntry(e);
    alert('Acción no disponible: createWorkLogEntry no está definida.');
  });

  const loadReportBtn = document.getElementById('loadReportBtn'); if (loadReportBtn) loadReportBtn.addEventListener('click', loadReport);

  const datosBuscarBtn = document.getElementById('datosBuscarBtn'); if (datosBuscarBtn) datosBuscarBtn.addEventListener('click', loadDatos);
  const tmGuardarBtn = document.getElementById('tmGuardarBtn'); if (tmGuardarBtn) tmGuardarBtn.addEventListener('click', saveTiempoMolde);
  const importBtn = document.getElementById('importBtn'); if (importBtn) importBtn.addEventListener('click', importDatosCSV);
  const datoCrearBtn = document.getElementById('datoCrearBtn'); if (datoCrearBtn) datoCrearBtn.addEventListener('click', createDatoManual);
}

// =================================================================================
// 5. UTIL: Día/Mes/Año (solo para Tiempos de Moldes)
// =================================================================================
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
function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

// =================================================================================
// 6. PLANIFICADOR (igual)
// =================================================================================
async function loadPlannerData() { if (!authToken) return; await populateSelect('planMoldSelector', 'molds', 'name', 'id', 'Selecciona un Molde'); }

async function loadPlanningGrid() {
  const moldIdEl = document.getElementById('planMoldSelector');
  const startDateEl = document.getElementById('gridStartDate');
  const moldId = moldIdEl ? moldIdEl.value : '';
  const startDate = startDateEl ? startDateEl.value : '';
  const container = document.getElementById('planningGridContainer');
  if (!moldId || !startDate) { if (container) container.innerHTML = '<p class="text-muted">Selecciona un molde y una fecha para comenzar.</p>'; return; }
  const ok = await isDateLaborable(startDate);
  if (!ok) { if (container) container.innerHTML = `<p class="error">La fecha de inicio seleccionada (${startDate}) no es laborable. Habilítala desde el calendario si necesitas usarla.</p>`; return; }
  if (container) container.innerHTML = '<p>Cargando datos...</p>';
  try {
    const machinesRes = await fetch(`${API_URL}/machines`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    let machines = await machinesRes.json(); machines = Array.isArray(machines) ? machines.sort((a, b) => a.id - b.id) : []; cachedMachines = machines;
    const partsRes = await fetch(`${API_URL}/molds/parts`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const parts = await partsRes.json(); cachedParts = Array.isArray(parts) ? parts : [];
    renderPlanningGrid(cachedMachines, cachedParts);
  } catch (error) { console.error(error); if (container) container.innerHTML = '<p class="error">Error al cargar datos para la parrilla.</p>'; }
}

function renderPlanningGrid(machines, parts) {
  const container = document.getElementById('planningGridContainer');
  if (!parts.length) { if (container) container.innerHTML = '<p>No hay partes registradas.</p>'; return; }
  if (!machines.length) { if (container) container.innerHTML = '<p>No hay máquinas registradas.</p>'; return; }
  let html = `
    <table id="planningGrid">
      <thead>
        <tr>
          <th>Parte</th><th>Cantidad de Partes</th>
          ${machines.map(m => `<th data-machine-id="${m.id}">${m.name}</th>`).join('')}
          <th>Total Horas por Parte</th>
        </tr>
      </thead>
      <tbody>
        ${parts.map(p => `
          <tr data-part-id="${p.id}">
            <td class="part-name">${p.name}</td>
            <td><input type="number" class="qty-input" min="0" step="1" placeholder="0" inputmode="numeric"></td>
            ${machines.map(m => `<td><input type="number" class="hours-input" data-machine-id="${m.id}" min="0" step="0.5" placeholder="0" inputmode="decimal"></td>`).join('')}
            <td class="total-hours-cell">0.00</td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr><td><strong>Totales</strong></td><td></td>${machines.map(m => `<td id="total-machine-${m.id}">0.00</td>`).join('')}<td id="grand-total">0.00</td></tr></tfoot>
    </table>`;
  if (container) container.innerHTML = html;
  const inputs = container ? container.querySelectorAll('.qty-input, .hours-input') : [];
  inputs.forEach(input => {
    input.addEventListener('focus', () => { if (input.value === '0') input.value=''; try{ input.select(); } catch(_){} });
    input.addEventListener('input', () => { const val=input.value.trim(); if (val!=='' && Number(val)<0) input.value='0'; const row=input.closest('tr'); updateRowTotal(row); updateColumnTotals(); updateGrandTotal(); });
    input.addEventListener('blur', () => { const val=input.value.trim(); if (val==='') return; const num=parseFloat(val); input.value=isNaN(num)?'':String(num); });
  });
}
function updateRowTotal(row){ const qtyInput=row.querySelector('.qty-input'); const qty=qtyInput ? (parseFloat(qtyInput.value)||0) : 0; let sumBase=0; row.querySelectorAll('.hours-input').forEach(inp=>{const v=parseFloat(inp.value); sumBase+=isNaN(v)?0:v;}); const total=qty*sumBase; const cell=row.querySelector('.total-hours-cell'); if (cell) cell.textContent=total.toFixed(2); }
function updateColumnTotals(){ const grid=document.getElementById('planningGrid'); if(!grid) return; cachedMachines.forEach(m=>{ let colSum=0; grid.querySelectorAll(`tbody .hours-input[data-machine-id="${m.id}"]`).forEach(inp=>{const v=parseFloat(inp.value); colSum+=isNaN(v)?0:v;}); const cell=document.getElementById(`total-machine-${m.id}`); if (cell) cell.textContent=colSum.toFixed(2); }); }
function updateGrandTotal(){ const grid=document.getElementById('planningGrid'); if(!grid) return; let grand=0; grid.querySelectorAll('tbody .total-hours-cell').forEach(cell=>{const v=parseFloat(cell.textContent); grand+=isNaN(v)?0:v;}); const totalEl=document.getElementById('grand-total'); if (totalEl) totalEl.textContent=grand.toFixed(2); }

async function isDateLaborable(dateStr){ try { const res=await fetch(`${API_URL}/working/check?date=${encodeURIComponent(dateStr)}`, { headers:{'Authorization':`Bearer ${authToken}`} }); if(!res.ok) return false; const data=await res.json(); return !!data.laborable; } catch { return false; } }

async function submitGridPlan() {
  const moldIdEl = document.getElementById('planMoldSelector');
  const startDateEl = document.getElementById('gridStartDate');
  const moldId = moldIdEl ? moldIdEl.value : '';
  const startDate = startDateEl ? startDateEl.value : '';
  if (!moldId || !startDate) return alert('Faltan datos de configuración.');
  const canStart = await isDateLaborable(startDate);
  if (!canStart) return alert('La fecha de inicio seleccionada no es laborable. Habilítala desde el calendario o selecciona otra fecha.');
  const rows = document.querySelectorAll('#planningGrid tbody tr'); const tasksToPlan=[];
  rows.forEach(row => {
    const partId = parseInt(row.getAttribute('data-part-id'));
    const qtyInput = row.querySelector('.qty-input');
    const qty = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;
    if (qty <= 0) return;
    row.querySelectorAll('.hours-input').forEach(inp => {
      const base = parseFloat(inp.value);
      if (!isNaN(base) && base > 0) {
        const machineId = parseInt(inp.getAttribute('data-machine-id'));
        const totalHours = base * qty;
        tasksToPlan.push({ moldId:parseInt(moldId), partId, machineId, startDate, totalHours });
      }
    });
  });
  if (!tasksToPlan.length) return alert('No hay datos para planificar.');
  const responseBox=document.getElementById('gridResponse'); if (responseBox) responseBox.innerHTML='Enviando planificación...';
  let ok=0, fail=0;
  for (const task of tasksToPlan) {
    try { const res=await fetch(`${API_URL}/tasks/plan`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`}, body:JSON.stringify(task) }); if (res.ok) ok++; else fail++; }
    catch { fail++; }
  }
  displayResponse('gridResponse', { message:`Proceso finalizado. Éxitos: ${ok}, Errores: ${fail}` }, ok>0);
}

// =================================================================================
// 7. CALENDARIO
// =================================================================================
function changeMonth(delta){ currentMonth+=delta; if(currentMonth>11){ currentMonth=0; currentYear++; } else if(currentMonth<0){ currentMonth=11; currentYear--; } loadCalendar(); }
async function loadCalendar(){ if(!authToken) return; const display=document.getElementById('calendar-month-year'); const grid=document.getElementById('calendar-grid'); if(display) display.textContent=`${capitalize(monthNames[currentMonth])} ${currentYear}`; if(grid) grid.innerHTML='Cargando...';
  try { const res=await fetch(`${API_URL}/calendar/month-view?year=${currentYear}&month=${currentMonth+1}`, { headers:{'Authorization':`Bearer ${authToken}`} }); const data=await res.json(); if(res.ok) renderCalendar(currentYear,currentMonth,data.events,data.holidays); }
  catch(e){ if(grid) grid.innerHTML='Error cargar calendario'; }
}
function renderCalendar(year, month, events, holidays){ const grid=document.getElementById('calendar-grid'); if(!grid) return; grid.innerHTML=''; const todayStr=new Date().toISOString().split('T')[0]; const firstDay=new Date(year, month, 1); const startDayIndex=firstDay.getDay(); const daysInMonth=new Date(year, month+1, 0).getDate();
  for(let i=0;i<startDayIndex;i++){ const d=document.createElement('div'); d.className='calendar-day other-month'; grid.appendChild(d); }
  for(let d=1; d<=daysInMonth; d++){ const date=new Date(year, month, d); const dateStr=date.toISOString().split('T')[0]; const cell=document.createElement('div'); cell.className='calendar-day'; cell.innerHTML=`<div class="day-number">${d}</div>`;
    if(dateStr===todayStr) cell.classList.add('today'); if(date.getDay()===0||date.getDay()===6) cell.classList.add('weekend');
    if(holidays[dateStr]){ cell.classList.add('holiday'); cell.innerHTML += `<div class="holiday-name">${holidays[dateStr]}</div>`; }
    if(events[d]){ const total=Object.values(events[d].machineUsage).reduce((a,b)=>a+b,0); cell.classList.add('has-events'); cell.innerHTML += `<div class="events-indicator">${total.toFixed(1)}h</div>`; }
    cell.addEventListener('click', ()=> showDayDetails(date, events[d], holidays[dateStr]));
    grid.appendChild(cell);
  }
}
function showDayDetails(date, events, holiday){ const modal=document.getElementById('day-details-modal'); const body=document.getElementById('modal-body'); const titleEl=document.getElementById('modal-title'); const dateStr=date.toISOString().split('T')[0]; if (titleEl) titleEl.textContent=date.toLocaleDateString();
  let html=''; if(holiday) html+=`<p>🎉 ${holiday}</p>`; if(events){ html+='<ul>'; events.tasks.forEach(t=> html+=`<li>${t.machine}: ${t.mold} (${t.part}) - ${t.hours}h</li>` ); html+='</ul>'; } else { html+='<p>No hay tareas planificadas para este día.</p>'; }
  html+=`<div style="margin-top:12px;"><button class="btn btn-secondary" id="toggleWorkingBtn">Cargando estado...</button><small style="display:block; margin-top:6px;">Esto crea una excepción para este día.</small></div>`;
  if (body) body.innerHTML=html;
  (async()=>{ const laborable=await isDateLaborable(dateStr); const btn=document.getElementById('toggleWorkingBtn'); if(!btn) return; btn.textContent=laborable?'Deshabilitar día':'Habilitar día'; btn.onclick=async()=>{ const desired=laborable?false:true;
      try{ const res=await fetch(`${API_URL}/working/override`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`}, body:JSON.stringify({ date:dateStr, isWorking:desired }) }); if(res.ok){ alert(`Día ${desired?'habilitado':'deshabilitado'} correctamente.`); hideModal(); loadCalendar(); } else { alert('No se pudo actualizar el estado del día.'); } }
      catch(e){ alert('Error de conexión al actualizar el estado del día.'); }
    };
  })();
  if (modal) modal.classList.remove('hidden');
}
function hideModal(){ const modal=document.getElementById('day-details-modal'); if (modal) modal.classList.add('hidden'); }

// =================================================================================
// 8. LOGIN / UTILIDADES
// =================================================================================
async function updateOperatorSelection(){
  const username=document.getElementById('username').value;
  const group=document.getElementById('operatorSelectGroup');
  const select=document.getElementById('operatorId');
  if (username==='operarios'){
    if (group) group.classList.remove('hidden');
    if (select) select.innerHTML='<option>Cargando...</option>';
    try{ const res=await fetch(`${API_URL}/auth/operators?username=${username}`); const ops=await res.json(); let html='<option value="">Selecciona...</option>'; ops.forEach(o=> html+=`<option value="${o.id}">${o.name}</option>` ); if (select) select.innerHTML=html; }
    catch(e){ console.error(e); }
  } else {
    if (group) group.classList.add('hidden');
    if (select) select.value='';
  }
}
async function login(e){
  if(e) e.preventDefault();
  const username=document.getElementById('username').value;
  const password=document.getElementById('password').value;
  const operatorId=document.getElementById('operatorId').value;
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
  try{ const res=await fetch(`${API_URL}/auth/verify`, { headers:{'Authorization':`Bearer ${token}`} }); if(res.ok){ const data=await res.json(); showMainApp(data.user); } else { showLoginScreen('Sesión inválida'); } }
  catch(e){ showLoginScreen('Error conexión'); }
}
function logout(){ showLoginScreen('Logout'); }
async function populateSelect(id, endpoint, label, val, ph){
  const sel=document.getElementById(id); if(!sel) return;
  sel.innerHTML=`<option value="">${ph}</option>`;
  try{
    const res=await fetch(`${API_URL}/${endpoint}`, { headers:{'Authorization':`Bearer ${authToken}`} });
    const data=await res.json();
    const sorted=endpoint==='machines' ? data.sort((a,b)=>a.id-b.id) : data;
    let html=`<option value="">${ph}</option>`;
    sorted.forEach(x=> html+=`<option value="${x[val]}">${x[label]}</option>` );
    sel.innerHTML=html;
  } catch(e){}
}
async function createMasterData(type){
  let endpoint='', body={};
  const nameInputId = `new${type.charAt(0).toUpperCase()+type.slice(1)}Name`;
  const nameEl = document.getElementById(nameInputId);
  const nameVal = nameEl ? nameEl.value : '';
  if(type==='machine'){ endpoint='machines'; const opsEl=document.getElementById('newMachineOpCount'); const ops=opsEl?opsEl.value:1; body={ name:nameVal, operarios_count:ops }; }
  else if(type==='mold'){ endpoint='molds'; body={ name:nameVal }; }
  else if(type==='part'){ endpoint='molds/parts'; body={ name:nameVal }; }
  if(!body.name) return alert('Nombre requerido');
  try{
    const res=await fetch(`${API_URL}/${endpoint}`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`}, body:JSON.stringify(body) });
    if(res.ok){ alert('Creado con éxito'); if (nameEl) nameEl.value=''; } else { alert('Error al crear'); }
  } catch(e){ alert('Error conexión'); }
}
async function createHoliday(){
  const dEl=document.getElementById('newHolidayDate'); const nEl=document.getElementById('newHolidayName');
  const d=dEl?dEl.value:''; const n=nEl?nEl.value:'';
  if(!d||!n) return alert('Datos incompletos');
  try{
    const res=await fetch(`${API_URL}/holidays`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${authToken}`}, body:JSON.stringify({date:d, name:n}) });
    if(res.ok){ alert('Festivo creado'); if (nEl) nEl.value=''; } else alert('Error');
  } catch(e){}
}
async function createWorkLogEntry(e){ if(e) e.preventDefault(); alert('Función de registro de trabajo simulada.'); }
async function loadWorkLogData(){ await populateSelect('workMoldId','molds','name','id','Molde'); await populateSelect('workPartId','molds/parts','name','id','Parte'); await populateSelect('workMachineId','machines','name','id','Máquina'); }
function loadReport(){ displayResponse('reportResponse', { msg:'Reportes pendientes' }, true); }
function resetInactivityTimer(){ clearTimeout(inactivityTimer); if(authToken) inactivityTimer=setTimeout(logout, INACTIVITY_TIMEOUT); }
function startInactivityTimer(){ window.onclick=resetInactivityTimer; window.onkeypress=resetInactivityTimer; resetInactivityTimer(); }
function displayResponse(id, data, success){ const el=document.getElementById(id); if(el){ el.className=`response-box ${success?'success':'error'}`; el.textContent=JSON.stringify(data,null,2); } }

// =================================================================================
// 9. DATOS: Historial (listar/crear/editar/eliminar)
// =================================================================================
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
          <td><input type="text" value="${r.mes ? (r.mes.charAt(0).toUpperCase() + r.mes.slice(1)) : ''}" ${disabled}></td>
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
    horas: horasEl.value !== '' ? Math.round(parseFloat(horasEl.value) / 0.25) * 0.25 : ''
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

// =================================================================================
// 10. Meta (Tiempos de Moldes) y guardado
// =================================================================================
async function loadDatosMeta(){
  try{
    const res=await fetch(`${API_URL}/datos/meta`, { headers:{'Authorization':`Bearer ${authToken}`} });
    const meta=await res.json();

    fillDatalist('tmOperarios', meta.operarios);
    fillDatalist('tmProcesos', meta.procesos);
    fillDatalist('tmMaquinas', meta.maquinas);
    fillDatalist('tmOperaciones', meta.operaciones);

    // Select con filtro para Molde y Parte
    populateSelectWithFilter('tmMoldeSelect', 'tmMoldeFilter', meta.moldes || []);
    populateSelectWithFilter('tmParteSelect', 'tmParteFilter', meta.partes || []);

    // Año dinámico
    const tmAnioSel = document.getElementById('tmAnio');
    if (tmAnioSel) {
      const base = []; for (let y=2016; y<=2027; y++) base.push(y);
      const merged = Array.from(new Set([...(meta.years || []), ...base])).sort((a,b)=>b-a);
      tmAnioSel.innerHTML = merged.map(y => `<option value="${y}">${y}</option>`).join('');
      const currentY = new Date().getFullYear();
      tmAnioSel.value = merged.includes(currentY) ? currentY : String(merged[0]);
    }

    // Vincular filtros (evitar doble binding)
    setupFilterListener('tmMoldeFilter', 'tmMoldeSelect');
    setupFilterListener('tmParteFilter', 'tmParteSelect');

  } catch(e){}
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

// =================================================================================
// 11. Importar CSV
// =================================================================================
async function importDatosCSV(){
  const fileInput=document.getElementById('importFile'); const file=fileInput?.files?.[0];
  if(!file) return displayResponse('importResponse', { error:'Selecciona un archivo' }, false);
  const btn=document.getElementById('importBtn'); if(btn) btn.disabled=true;
  const form=new FormData(); form.append('file', file);
  try{
    const res=await fetch(`${API_URL}/import/datos`, { method:'POST', headers:{'Authorization':`Bearer ${authToken}`}, body:form });
    const data=await res.json();
    displayResponse('importResponse', data, res.ok);

    if (res.ok) {
      // Resumen y tabla de primeras fallas
      renderImportDiagnostics(data);
      loadDatos();
      loadDatosMeta();
    }
  } catch(e){
    displayResponse('importResponse', { error:'Error de conexión' }, false);
  } finally{
    if(btn) btn.disabled=false;
  }
}

function renderImportDiagnostics(resp){
  const sumEl = document.getElementById('importDiagSummary');
  const tbody = document.querySelector('#importDiagTable tbody');
  const dlBtn = document.getElementById('importDiagDownloadBtn');

  if (sumEl) {
    sumEl.textContent = `Hoja: ${resp.sheet} | Batch: ${resp.batchId} | Total: ${resp.total} | OK: ${resp.ok} | Fallas: ${resp.fail}`;
  }
  if (tbody) {
    const samples = resp.fail_samples || [];
    tbody.innerHTML = samples.map(s => `
      <tr>
        <td>${s.row}</td>
        <td>${escapeHtml(s.nombre_operario || '')}</td>
        <td>${escapeHtml(s.tipo_proceso || '')}</td>
        <td>${escapeHtml(s.molde || '')}</td>
        <td>${escapeHtml(s.parte || '')}</td>
        <td>${escapeHtml(s.maquina || '')}</td>
        <td>${escapeHtml(s.operacion || '')}</td>
        <td>${escapeHtml(s.horas != null ? String(s.horas) : '')}</td>
        <td>${escapeHtml(s.reason || '')}</td>
      </tr>
    `).join('');
  }
  if (dlBtn) {
    dlBtn.disabled = !resp.batchId;
    dlBtn.onclick = async () => {
      if (!resp.batchId) return;
      try{
        const er = await fetch(`${API_URL}/import/datos/${resp.batchId}/errors`, { headers:{'Authorization':`Bearer ${authToken}`} });
        const rows = await er.json();
        const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagnostico_import_${resp.batchId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch(e){
        alert('No se pudo descargar el diagnóstico');
      }
    };
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// =================================================================================
// 12. Trabajo
// =================================================================================
async function loadWorkLogData(){ await populateSelect('workMoldId','molds','name','id','Molde'); await populateSelect('workPartId','molds/parts','name','id','Parte'); await populateSelect('workMachineId','machines','name','id','Máquina'); }
async function createWorkLogEntry(e){ if(e) e.preventDefault(); alert('Registro de trabajo enviado (demo).'); }