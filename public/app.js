// =================================================================================
// 1. CONSTANTES Y VARIABLES GLOBALES
// =================================================================================
const API_URL = 'http://localhost:3000/api';
let authToken = null;
let currentUser = null;

// Caché para la parrilla
let cachedMachines = [];
let cachedParts = [];

// Variables para el calendario visual
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Variables para el gestor de inactividad
const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutos
let inactivityTimer = null;


// =================================================================================
// 2. PUNTO DE ENTRADA
// =================================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    
    // Fecha por defecto en el planificador (hoy)
    const dateInput = document.getElementById('gridStartDate');
    if(dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
        verifySession(savedToken);
    } else {
        showLoginScreen();
    }
});


// =================================================================================
// 3. GESTIÓN DE SESIÓN Y PANTALLAS
// =================================================================================
function showLoginScreen(message = '') {
    const loginContainer = document.getElementById('loginContainer');
    const mainApp = document.getElementById('mainApp');
    
    if(loginContainer) loginContainer.classList.remove('hidden');
    if(mainApp) mainApp.classList.add('hidden');
    
    const welcomeMsg = document.getElementById('welcomeMessage');
    if(welcomeMsg) welcomeMsg.textContent = '';
    
    if (message) console.error(message); 
    
    if(document.getElementById('password')) document.getElementById('password').value = 'admin';
    if(document.getElementById('operatorId')) document.getElementById('operatorId').innerHTML = '<option value="">Cargando...</option>';
    if(document.getElementById('operatorSelectGroup')) document.getElementById('operatorSelectGroup').classList.add('hidden');
    
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    resetInactivityTimer();
}

function showMainApp(user) {
    currentUser = user;
    authToken = localStorage.getItem('authToken');
    
    let welcomeText = `Bienvenido, ${user.username}`;
    if (user.role === 'operator' && user.operatorName) {
        welcomeText += ` (${user.operatorName})`;
    }
    welcomeText += ` - ${user.role.toUpperCase()}`;
    
    const welcomeEl = document.getElementById('welcomeMessage');
    if(welcomeEl) welcomeEl.textContent = welcomeText;

    // Mostrar botones de pestañas según rol
    const configBtn = document.querySelector('button[data-tab="config"]');
    const planBtn = document.querySelector('button[data-tab="plan"]');
    const worklogBtn = document.querySelector('button[data-tab="worklog"]');

    if(configBtn) configBtn.classList.toggle('hidden', user.role !== 'admin');
    if(planBtn) planBtn.classList.toggle('hidden', user.role === 'operator');
    if(worklogBtn) worklogBtn.classList.toggle('hidden', user.role !== 'operator');
    
    // Pestaña por defecto
    const defaultTab = user.role === 'operator' ? 'worklog' : 'plan';
    openTab(defaultTab);
    
    document.getElementById('loginContainer').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    
    startInactivityTimer();
}

function openTab(tabName) {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const activeBtn = document.querySelector(`button[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const activeContent = document.getElementById(`tab-${tabName}`);
    if (activeContent) activeContent.classList.add('active');
    
    if (tabName === 'calendar') loadCalendar();
    if (tabName === 'plan') loadPlannerData(); 
    if (tabName === 'worklog') loadWorkLogData();
}


// =================================================================================
// 4. EVENT LISTENERS
// =================================================================================
function setupEventListeners() {
    // --- Login ---
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', login);
    
    const usernameSelect = document.getElementById('username');
    if (usernameSelect) usernameSelect.addEventListener('change', updateOperatorSelection);
    
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // --- Navegación Pestañas ---
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab');
            openTab(tabName);
        });
    });
    
    // --- Planificador (LA PARRILLA) ---
    const planMoldSelector = document.getElementById('planMoldSelector');
    if (planMoldSelector) planMoldSelector.addEventListener('change', loadPlanningGrid);
    
    const gridStartDate = document.getElementById('gridStartDate');
    if (gridStartDate) gridStartDate.addEventListener('change', loadPlanningGrid);

    const submitGridPlanBtn = document.getElementById('submitGridPlanBtn');
    if (submitGridPlanBtn) submitGridPlanBtn.addEventListener('click', submitGridPlan);

    // --- Calendario ---
    const prevMonthBtn = document.getElementById('prev-month-btn');
    if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeMonth(-1));
    const nextMonthBtn = document.getElementById('next-month-btn');
    if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeMonth(1));
    const modalCloseBtn = document.getElementById('modal-close-btn');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideModal);

    // --- Configuración (Datos Maestros y Festivos) ---
    const createMachineBtn = document.getElementById('createMachineBtn');
    if(createMachineBtn) createMachineBtn.addEventListener('click', () => createMasterData('machine'));
    
    const createMoldBtn = document.getElementById('createMoldBtn');
    if(createMoldBtn) createMoldBtn.addEventListener('click', () => createMasterData('mold'));
    
    const createPartBtn = document.getElementById('createPartBtn');
    if(createPartBtn) createPartBtn.addEventListener('click', () => createMasterData('part'));

    const createOperatorBtn = document.getElementById('createOperatorBtn');
    if(createOperatorBtn) createOperatorBtn.addEventListener('click', () => alert('Funcionalidad de crear operario pendiente'));

    const createHolidayBtn = document.getElementById('createHolidayBtn');
    if(createHolidayBtn) createHolidayBtn.addEventListener('click', createHoliday);

    const deleteHolidayBtn = document.getElementById('deleteHolidayBtn');
    if(deleteHolidayBtn) deleteHolidayBtn.addEventListener('click', () => alert('Selecciona un festivo de la lista para eliminar'));
    
    // --- Worklog y Reportes ---
    const createWorkLogBtn = document.getElementById('createWorkLogBtn');
    if (createWorkLogBtn) createWorkLogBtn.addEventListener('click', createWorkLogEntry);

    const loadReportBtn = document.getElementById('loadReportBtn');
    if (loadReportBtn) loadReportBtn.addEventListener('click', loadReport);
}


// =================================================================================
// 5. LÓGICA DEL PLANIFICADOR (LA PARRILLA RECUPERADA)
// =================================================================================

async function loadPlannerData() {
    if (!authToken) return;
    // Cargar select de moldes
    await populateSelect('planMoldSelector', 'molds', 'name', 'id', 'Selecciona un Molde');
}

/**
 * Función principal que construye la tabla dinámica
 */
async function loadPlanningGrid() {
    const moldId = document.getElementById('planMoldSelector').value;
    const startDate = document.getElementById('gridStartDate').value;
    const container = document.getElementById('planningGridContainer');
    
    if (!moldId || !startDate) {
        container.innerHTML = '<p class="text-muted">Selecciona un molde y una fecha para comenzar.</p>';
        return;
    }

    container.innerHTML = '<p>Cargando datos...</p>';

    try {
        // 1. Obtener Máquinas (Columnas)
        const machinesRes = await fetch(`${API_URL}/machines`, { headers: { 'Authorization': `Bearer ${authToken}` }});
        cachedMachines = await machinesRes.json();

        // 2. Obtener Partes asociadas al Molde (Filas)
        // Nota: Asumimos que hay un endpoint /molds/parts o similar. Si no, filtramos.
        // Como tu API tenía /molds/parts devolviendo todas, aquí haremos un filtro simple si es necesario.
        // Lo ideal sería: GET /molds/:id/parts
        // Por ahora cargamos todas y simulamos (o ajusta según tu API real).
        const partsRes = await fetch(`${API_URL}/molds/parts`, { headers: { 'Authorization': `Bearer ${authToken}` }});
        const allParts = await partsRes.json();
        // Filtramos partes si tu backend no lo hace (asumiendo que parts no tienen mold_id visible aquí, usamos todas por ahora o ajusta tu backend)
        cachedParts = allParts; 

        renderPlanningGrid(cachedMachines, cachedParts);

    } catch (error) {
        console.error(error);
        container.innerHTML = '<p class="error">Error al cargar datos para la parrilla.</p>';
    }
}

function renderPlanningGrid(machines, parts) {
    const container = document.getElementById('planningGridContainer');
    
    if (parts.length === 0) {
        container.innerHTML = '<p>No hay partes registradas para este molde.</p>';
        return;
    }
    if (machines.length === 0) {
        container.innerHTML = '<p>No hay máquinas registradas.</p>';
        return;
    }

    let html = `
    <div style="display: flex; gap: 20px; margin-bottom: 10px;">
        <div class="form-group">
            <label>Cantidad de Moldes/Partes a Producir:</label>
            <input type="number" id="totalParts" value="1" min="1" style="width: 100px; font-weight: bold;">
        </div>
        <div class="summary-box">
             <p>Total Horas Proyectado: <span id="totalHoursSummary">0.00</span></p>
             <p>Recuento Horas Máquina: <span id="machineHoursTotalSummary">0.00</span></p>
        </div>
    </div>
    <table id="planningGrid">
        <thead>
            <tr>
                <th>Parte</th>
                ${machines.map(m => `<th>${m.name} <br><small>(${m.operarios_count} op)</small></th>`).join('')}
                <th>Total Horas</th>
            </tr>
        </thead>
        <tbody id="planningTableBody">
    `;

    parts.forEach(part => {
        html += `
        <tr data-part-id="${part.id}">
            <td>${part.name}</td>
            ${machines.map(m => `
                <td>
                    <input type="number" 
                           class="grid-input" 
                           data-machine-id="${m.id}" 
                           placeholder="0" 
                           step="0.5" 
                           min="0">
                </td>
            `).join('')}
            <td class="totalHoursRow fw-bold">0.00</td>
        </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Agregar Listeners para cálculos en tiempo real
    const inputs = container.querySelectorAll('.grid-input');
    inputs.forEach(input => input.addEventListener('input', calculateTotalHours));
    document.getElementById('totalParts').addEventListener('input', calculateTotalHours);
}

function calculateTotalHours() {
    const totalPartsInput = document.getElementById('totalParts');
    const totalParts = parseFloat(totalPartsInput.value) || 0;
    const rows = document.querySelectorAll('#planningTableBody tr');
    
    let grandTotalProjected = 0;
    let grandTotalMachineBase = 0;

    rows.forEach(row => {
        let rowBaseHours = 0;
        const inputs = row.querySelectorAll('.grid-input');
        
        inputs.forEach(input => {
            rowBaseHours += parseFloat(input.value) || 0;
        });

        // Total proyectado para esta fila = (Suma horas máquinas) * (Cantidad de Partes)
        const rowTotalProjected = rowBaseHours * totalParts;
        
        // Actualizar celda de total por fila
        row.querySelector('.totalHoursRow').textContent = rowTotalProjected.toFixed(2);
        
        grandTotalMachineBase += rowBaseHours;
        grandTotalProjected += rowTotalProjected;
    });

    // Actualizar resumen superior
    document.getElementById('totalHoursSummary').textContent = grandTotalProjected.toFixed(2);
    document.getElementById('machineHoursTotalSummary').textContent = grandTotalMachineBase.toFixed(2);
}

async function submitGridPlan() {
    const moldId = document.getElementById('planMoldSelector').value;
    const startDate = document.getElementById('gridStartDate').value;
    const totalParts = parseFloat(document.getElementById('totalParts')?.value) || 1;
    
    if (!moldId || !startDate) return alert('Faltan datos de configuración.');

    // Recopilar datos de la parrilla
    const inputs = document.querySelectorAll('.grid-input');
    let tasksToPlan = [];

    inputs.forEach(input => {
        const hoursBase = parseFloat(input.value);
        if (hoursBase > 0) {
            const row = input.closest('tr');
            const partId = row.getAttribute('data-part-id');
            const machineId = input.getAttribute('data-machine-id');
            
            // Total horas = Base * Cantidad de Partes
            const totalHours = hoursBase * totalParts;

            tasksToPlan.push({
                moldId: parseInt(moldId),
                partId: parseInt(partId),
                machineId: parseInt(machineId),
                startDate: startDate,
                totalHours: totalHours
            });
        }
    });

    if (tasksToPlan.length === 0) return alert('No has asignado horas a ninguna máquina.');

    // Enviar peticiones (Secuencial o Paralelo)
    const responseBox = document.getElementById('gridResponse');
    responseBox.innerHTML = 'Enviando planificación...';
    
    let successCount = 0;
    let errorCount = 0;

    for (const task of tasksToPlan) {
        try {
            const res = await fetch(`${API_URL}/tasks/plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(task)
            });
            if (res.ok) successCount++;
            else errorCount++;
        } catch (e) {
            errorCount++;
        }
    }

    displayResponse('gridResponse', { message: `Proceso finalizado. Éxitos: ${successCount}, Errores: ${errorCount}` }, successCount > 0);
    
    // Si hubo éxitos, recargar calendario si está visible
    if(successCount > 0) {
        // Opcional: limpiar grid
    }
}


// =================================================================================
// 6. FUNCIONES DE UTILIDAD (Login, Datos Maestros, Calendario, etc)
// =================================================================================

async function updateOperatorSelection() {
    const username = document.getElementById('username').value;
    const group = document.getElementById('operatorSelectGroup');
    const select = document.getElementById('operatorId');
    
    if (username === 'operarios') {
        group.classList.remove('hidden');
        select.innerHTML = '<option>Cargando...</option>';
        try {
            const res = await fetch(`${API_URL}/auth/operators?username=${username}`);
            const ops = await res.json();
            let html = '<option value="">Selecciona...</option>';
            ops.forEach(o => html += `<option value="${o.id}">${o.name}</option>`);
            select.innerHTML = html;
        } catch(e) { console.error(e); }
    } else {
        group.classList.add('hidden');
        select.value = '';
    }
}

async function login(e) {
    if(e) e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const operatorId = document.getElementById('operatorId').value;
    
    const body = { username, password };
    if (username === 'operarios') {
        if(!operatorId) return alert('Selecciona un operario');
        body.operatorId = operatorId;
    }
    
    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if(res.ok) {
            localStorage.setItem('authToken', data.token);
            verifySession(data.token);
        } else {
            alert(data.error || 'Error login');
        }
    } catch(e) { alert('Error conexión'); }
}

async function verifySession(token) {
    try {
        const res = await fetch(`${API_URL}/auth/verify`, { headers: {'Authorization': `Bearer ${token}`} });
        if(res.ok) {
            const data = await res.json();
            showMainApp(data.user);
        } else {
            showLoginScreen('Sesión inválida');
        }
    } catch(e) { showLoginScreen('Error conexión'); }
}

function logout() {
    showLoginScreen('Logout');
}

// --- CALENDARIO ---
function changeMonth(delta) {
    currentMonth += delta;
    if(currentMonth > 11) { currentMonth = 0; currentYear++; }
    else if(currentMonth < 0) { currentMonth = 11; currentYear--; }
    loadCalendar();
}

async function loadCalendar() {
    if(!authToken) return;
    const display = document.getElementById('calendar-month-year');
    const grid = document.getElementById('calendar-grid');
    if(display) display.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    if(grid) grid.innerHTML = 'Cargando...';
    
    try {
        const res = await fetch(`${API_URL}/calendar/month-view?year=${currentYear}&month=${currentMonth+1}`, {
            headers: {'Authorization': `Bearer ${authToken}`}
        });
        const data = await res.json();
        if(res.ok) renderCalendar(currentYear, currentMonth, data.events, data.holidays);
    } catch(e) { if(grid) grid.innerHTML = 'Error cargar calendario'; }
}

function renderCalendar(year, month, events, holidays) {
    const grid = document.getElementById('calendar-grid');
    if(!grid) return;
    grid.innerHTML = '';
    
    const todayStr = new Date().toISOString().split('T')[0];
    const firstDay = new Date(year, month, 1);
    let startDayOfWeek = firstDay.getDay() || 7; // 1=Lun ... 7=Dom (ajuste si tu CSS espera eso)
    // Ajuste a tu CSS (parece que usas Domingo primero en el HTML)
    // Si tu HTML dice Dom, Lun, Mar... entonces Domingo es 0.
    const startDayIndex = firstDay.getDay(); // 0=Dom

    const daysInMonth = new Date(year, month+1, 0).getDate();
    
    // Rellenar vacíos previos
    for(let i=0; i<startDayIndex; i++) {
        const d = document.createElement('div');
        d.className = 'calendar-day other-month';
        grid.appendChild(d);
    }
    
    for(let d=1; d<=daysInMonth; d++) {
        const date = new Date(year, month, d);
        const dateStr = date.toISOString().split('T')[0];
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        cell.innerHTML = `<div class="day-number">${d}</div>`;
        
        if(dateStr === todayStr) cell.classList.add('today');
        if(date.getDay()===0 || date.getDay()===6) cell.classList.add('weekend');
        
        if(holidays[dateStr]) {
            cell.classList.add('holiday');
            cell.innerHTML += `<div class="holiday-name">${holidays[dateStr]}</div>`;
        }
        
        if(events[d]) {
            const total = Object.values(events[d].machineUsage).reduce((a,b)=>a+b,0);
            cell.classList.add('has-events');
            cell.innerHTML += `<div class="events-indicator">${total.toFixed(1)}h</div>`;
            cell.addEventListener('click', () => showDayDetails(date, events[d], holidays[dateStr]));
        }
        grid.appendChild(cell);
    }
}

function showDayDetails(date, events, holiday) {
    const modal = document.getElementById('day-details-modal');
    const body = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = date.toLocaleDateString();
    
    let html = '';
    if(holiday) html += `<p>🎉 ${holiday}</p>`;
    if(events) {
        html += '<ul>';
        events.tasks.forEach(t => html += `<li>${t.machine}: ${t.mold} (${t.part}) - ${t.hours}h</li>`);
        html += '</ul>';
    }
    body.innerHTML = html;
    modal.classList.remove('hidden');
}

function hideModal() {
    document.getElementById('day-details-modal').classList.add('hidden');
}

// --- UTILIDADES ---
async function populateSelect(id, endpoint, label, val, ph) {
    const sel = document.getElementById(id);
    if(!sel) return;
    sel.innerHTML = `<option>${ph}</option>`;
    try {
        const res = await fetch(`${API_URL}/${endpoint}`, { headers: {'Authorization': `Bearer ${authToken}`} });
        const data = await res.json();
        let html = `<option value="">${ph}</option>`;
        data.forEach(x => html += `<option value="${x[val]}">${x[label]}</option>`);
        sel.innerHTML = html;
    } catch(e) {}
}

async function createMasterData(type) {
    let endpoint = '', body = {};
    const nameVal = document.getElementById(`new${type.charAt(0).toUpperCase() + type.slice(1)}Name`)?.value;
    
    if(type === 'machine') {
        endpoint = 'machines';
        const ops = document.getElementById('newMachineOpCount').value;
        body = { name: nameVal, operarios_count: ops };
    } else if(type === 'mold') {
        endpoint = 'molds';
        body = { name: nameVal };
    } else if(type === 'part') {
        endpoint = 'molds/parts';
        body = { name: nameVal };
    }
    
    if(!body.name) return alert('Nombre requerido');
    
    try {
        const res = await fetch(`${API_URL}/${endpoint}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`},
            body: JSON.stringify(body)
        });
        if(res.ok) {
            alert('Creado con éxito');
            document.getElementById(`new${type.charAt(0).toUpperCase() + type.slice(1)}Name`).value = '';
        } else {
            alert('Error al crear');
        }
    } catch(e) { alert('Error conexión'); }
}

async function createHoliday() {
    const d = document.getElementById('newHolidayDate').value;
    const n = document.getElementById('newHolidayName').value;
    if(!d || !n) return alert('Datos incompletos');
    try {
        const res = await fetch(`${API_URL}/holidays`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`},
            body: JSON.stringify({date: d, name: n})
        });
        if(res.ok) { alert('Festivo creado'); document.getElementById('newHolidayName').value=''; }
        else alert('Error');
    } catch(e){}
}

async function createWorkLogEntry(e) {
    if(e) e.preventDefault();
    // Lógica básica de envío worklog
    alert('Función de registro de trabajo simulada. Implementar según campos del form.');
}

async function loadWorkLogData() {
    await populateSelect('workMoldId', 'molds', 'name', 'id', 'Molde');
    await populateSelect('workPartId', 'molds/parts', 'name', 'id', 'Parte');
    await populateSelect('workMachineId', 'machines', 'name', 'id', 'Máquina');
}

function loadReport() { displayResponse('reportResponse', {msg: 'Reportes pendientes'}, true); }
function resetInactivityTimer() { clearTimeout(inactivityTimer); if(authToken) inactivityTimer = setTimeout(logout, INACTIVITY_TIMEOUT); }
function startInactivityTimer() { 
    window.onclick = resetInactivityTimer; 
    window.onkeypress = resetInactivityTimer; 
    resetInactivityTimer(); 
}
function displayResponse(id, data, success) {
    const el = document.getElementById(id);
    if(el) {
        el.className = `response-box ${success?'success':'error'}`;
        el.textContent = JSON.stringify(data, null, 2);
    }
}