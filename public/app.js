const API_URL = 'http://localhost:3000/api';
let authToken = null;
let currentUser = null;

const loginContainer = document.getElementById('loginContainer');
const mainApp = document.getElementById('mainApp');

// Variables para el nuevo calendario
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];


// =================================================================================
// GESTOR DE INACTIVIDAD
// =================================================================================
const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
let inactivityTimer = null;

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        alert('Tu sesión ha expirado por inactividad.');
        logout(false);
    }, INACTIVITY_TIMEOUT);
}

function stopInactivityTimer() {
    clearTimeout(inactivityTimer);
}

// =================================================================================
// ARRANQUE Y LÓGICA DE SESIÓN
// =================================================================================

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
        try {
            const response = await fetch(`${API_URL}/auth/verify`, { headers: { 'Authorization': `Bearer ${savedToken}` } });
            if (!response.ok) throw new Error('Sesión inválida o expirada');
            const data = await response.json();
            authToken = savedToken;
            currentUser = data.user;
            mainApp.classList.remove('hidden');
            loginContainer.classList.add('hidden');
            initializeUI();
        } catch (error) {
            console.error("Verificación fallida:", error.message);
            logout(false);
        }
    } else {
        mainApp.classList.add('hidden');
        loginContainer.classList.remove('hidden');
    }
});

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const operatorId = document.getElementById('operatorId').value;
    const body = { username, password };
    if (username === 'operarios') {
        if (!operatorId) return alert('Por favor selecciona un operario');
        body.operatorId = parseInt(operatorId);
    }
    try {
        const response = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login fallido');
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        loginContainer.classList.add('hidden');
        mainApp.classList.remove('hidden');
        initializeUI();
        alert('¡Login exitoso!');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

function logout(isManual = true) {
    stopInactivityTimer();
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    mainApp.classList.add('hidden');
    loginContainer.classList.remove('hidden');
    if (isManual) alert('Has cerrado sesión correctamente.');
}

// =================================================================================
// INICIALIZACIÓN DE LA UI Y FUNCIONES GLOBALES
// =================================================================================

function initializeUI() {
    showUserInfo();
    checkHealth();
    setDefaultDates();
    resetInactivityTimer();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('gridStartDate').value = today;
    loadMoldsIntoSelectors();
    loadPlanningGrid();
    renderCalendar(currentYear, currentMonth); // Renderiza el calendario visual inicial
}

function setupEventListeners() {
    // Sesión y UI General
    document.getElementById('loginBtn')?.addEventListener('click', login);
    document.getElementById('logoutBtn')?.addEventListener('click', () => logout(true));
    document.getElementById('username')?.addEventListener('change', handleUsernameChange);
    const userActivityEvents = ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    userActivityEvents.forEach(event => document.addEventListener(event, resetInactivityTimer, { passive: true }));
    document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
    
    // Cuadro Planificador
    document.getElementById('planningGridContainer').addEventListener('input', handleGridInput);
    document.getElementById('submitGridPlanBtn')?.addEventListener('click', submitGridPlan);

    // Configuración
    document.getElementById('createMachineBtn')?.addEventListener('click', createMachine);
    document.getElementById('createMoldBtn')?.addEventListener('click', createMold);
    document.getElementById('createPartBtn')?.addEventListener('click', createPart);
    
    // Calendario Visual
    document.getElementById('prev-month-btn')?.addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month-btn')?.addEventListener('click', () => changeMonth(1));
    document.getElementById('calendar-grid')?.addEventListener('click', handleDayClick);
    document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('day-details-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'day-details-modal') closeModal();
    });

    // Otras Pestañas
    document.getElementById('createWorkLogBtn')?.addEventListener('click', createWorkLog);
    document.getElementById('loadReportBtn')?.addEventListener('click', loadReport);
    document.getElementById('loadDetailedReportBtn')?.addEventListener('click', loadDetailedReport);
}

async function loadMoldsIntoSelectors() {
    try {
        const response = await fetch(`${API_URL}/molds`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        if (!response.ok) throw new Error('No se pudieron cargar los moldes');
        const molds = await response.json();
        const select = document.getElementById('planMoldSelector');
        if (select) {
            const currentVal = select.value;
            select.innerHTML = '<option value="">Seleccionar Molde...</option>';
            molds.forEach(mold => {
                const option = document.createElement('option');
                option.value = mold.id;
                option.textContent = `${mold.id} - ${mold.name}`;
                select.appendChild(option);
            });
            select.value = currentVal;
        }
    } catch (error) {
        console.error(error.message);
    }
}

function showUserInfo() {
    document.getElementById('displayUsername').textContent = currentUser.username;
    document.getElementById('displayRole').textContent = currentUser.role;
    document.getElementById('displayOperator').textContent = currentUser.operatorName || 'N/A';
    if (currentUser.operatorId) {
        document.getElementById('workOperatorId').value = currentUser.operatorId;
    }
}

async function checkHealth() {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    try {
        const response = await fetch('http://localhost:3000/health');
        if (!response.ok) throw new Error('Server not OK');
        statusEl.classList.remove('disconnected');
        statusEl.textContent = '● Conectado';
    } catch (error) {
        statusEl.classList.add('disconnected');
        statusEl.textContent = '● Desconectado';
    }
}

function setDefaultDates() {
    // Esta función ahora solo configura los inputs de la pestaña de reportes.
    const today = new Date();
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const formatDate = (date) => date.toISOString().split('T')[0];
    document.getElementById('reportFrom').value = formatDate(today);
    document.getElementById('reportTo').value = formatDate(nextMonth);
}

function showTab(tabName) {
    document.querySelectorAll('[data-tab]').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    const activeContent = document.getElementById(`tab-${tabName}`);
    if (activeTab) activeTab.classList.add('active');
    if (activeContent) activeContent.classList.add('active');
}

function displayResponse(elementId, data, success) {
    const element = document.getElementById(elementId);
    element.textContent = JSON.stringify(data, null, 2);
    element.className = 'response-box ' + (success ? 'success' : 'error');
}

async function handleUsernameChange(e) {
    const operatorGroup = document.getElementById('operatorSelectGroup');
    if (e.target.value === 'operarios') {
        operatorGroup.classList.remove('hidden');
        await loadOperators();
    } else {
        operatorGroup.classList.add('hidden');
    }
}

async function loadOperators() {
    try {
        const response = await fetch(`${API_URL}/auth/operators?username=operarios`);
        const data = await response.json();
        if (!response.ok) return;
        const select = document.getElementById('operatorId');
        select.innerHTML = '<option value="">Seleccionar...</option>';
        if (Array.isArray(data)) {
            data.forEach(op => {
                const option = document.createElement('option');
                option.value = op.id;
                option.textContent = op.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error cargando operarios:', error);
    }
}

// =================================================================================
// LÓGICA PESTAÑA "CONFIGURACIÓN"
// =================================================================================

async function createMachine() {
    const name = document.getElementById('newMachineName').value;
    const opCount = document.getElementById('newMachineOpCount').value;
    if (!name || !opCount) return alert('Nombre y Nº de operarios son requeridos.');
    try {
        const response = await fetch(`${API_URL}/machines`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ name, operarios_count: opCount }) });
        const data = await response.json();
        displayResponse('configResponse', data, response.ok);
        if (response.ok) {
            document.getElementById('newMachineName').value = '';
            document.getElementById('newMachineId').value = data.id;
            loadPlanningGrid();
        }
    } catch (error) {
        displayResponse('configResponse', { error: error.message }, false);
    }
}

async function createMold() {
    const name = document.getElementById('newMoldName').value;
    if (!name) return alert('El nombre del molde es requerido.');
    try {
        const response = await fetch(`${API_URL}/molds`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ name }) });
        const data = await response.json();
        displayResponse('configResponse', data, response.ok);
        if (response.ok) {
            document.getElementById('newMoldName').value = '';
            document.getElementById('newMoldId').value = data.id;
            loadMoldsIntoSelectors();
        }
    } catch (error) {
        displayResponse('configResponse', { error: error.message }, false);
    }
}

async function createPart() {
    const name = document.getElementById('newPartName').value;
    if (!name) return alert('El nombre de la parte es requerido.');
    try {
        const response = await fetch(`${API_URL}/molds/parts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ name }) });
        const data = await response.json();
        displayResponse('configResponse', data, response.ok);
        if (response.ok) {
            document.getElementById('newPartName').value = '';
            document.getElementById('newPartId').value = data.id;
            loadPlanningGrid();
        }
    } catch (error) {
        displayResponse('configResponse', { error: error.message }, false);
    }
}

// =================================================================================
// LÓGICA PESTAÑA "CUADRO PLANIFICADOR"
// =================================================================================

function handleGridInput(event) {
    if (event.target.matches('.grid-input')) {
        updateRowCalculations(event.target.closest('tr'));
        updateColumnTotals();
    }
}

function updateRowCalculations(row) {
    const qtyInput = row.querySelector('.qty-input');
    const quantity = parseFloat(qtyInput.value) || 0;
    
    let sumOfHours = 0;
    row.querySelectorAll('.hours-input').forEach(input => {
        sumOfHours += parseFloat(input.value) || 0;
    });

    const totalHoursProjected = quantity * sumOfHours;

    const totalHoursCell = row.querySelector('.total-hours-cell');
    if (totalHoursCell) {
        totalHoursCell.textContent = totalHoursProjected.toFixed(2);
    }
}

function updateColumnTotals() {
    const grid = document.getElementById('planningGrid');
    if (!grid) return;

    const machineHeaders = grid.querySelectorAll('thead th[data-machine-id]');
    machineHeaders.forEach(header => {
        const machineId = header.dataset.machineId;
        const totalCell = grid.querySelector(`tfoot #total-machine-${machineId}`);
        
        if (totalCell) {
            let columnTotal = 0;
            grid.querySelectorAll(`tbody .hours-input[data-machine-id="${machineId}"]`).forEach(input => {
                columnTotal += parseFloat(input.value) || 0;
            });
            totalCell.textContent = columnTotal.toFixed(2);
        }
    });
}

async function loadPlanningGrid() {
    const container = document.getElementById('planningGridContainer');
    container.innerHTML = '<p>Cargando datos maestros...</p>';
    try {
        const [partsRes, machinesRes] = await Promise.all([
            fetch(`${API_URL}/molds/parts`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch(`${API_URL}/machines`, { headers: { 'Authorization': `Bearer ${authToken}` } })
        ]);
        const parts = await partsRes.json();
        const machines = await machinesRes.json();

        if (parts.length === 0 || machines.length === 0) {
            container.innerHTML = '<p>No hay partes o máquinas registradas. Ve a "Configuración" para añadirlas.</p>';
            return;
        }

        let tableHTML = '<table id="planningGrid"><thead>';
        tableHTML += `
            <tr>
                <th rowspan="2">Parte</th>
                <th rowspan="2">Cantidad de Partes</th>
                <th colspan="${machines.length}">Horas por Máquina</th>
                <th rowspan="2">Total Horas Proyectado</th>
            </tr>
        `;
        tableHTML += '<tr>';
        machines.forEach(m => tableHTML += `<th data-machine-id="${m.id}">${m.name}</th>`);
        tableHTML += '</tr></thead><tbody>';

        parts.forEach(p => {
            tableHTML += `<tr data-part-id="${p.id}">`;
            tableHTML += `<td>${p.name}</td>`;
            tableHTML += `<td><input type="number" class="grid-input qty-input" min="0" placeholder="Cant."></td>`;
            machines.forEach(m => {
                tableHTML += `<td><input type="number" class="grid-input hours-input" data-part-id="${p.id}" data-machine-id="${m.id}" min="0" step="0.5" placeholder="Horas"></td>`;
            });
            tableHTML += `<td class="calculated-cell total-hours-cell">0.00</td>`;
            tableHTML += '</tr>';
        });
        tableHTML += '</tbody><tfoot><tr>';

        tableHTML += `<td>Total Horas Máquina</td>`;
        tableHTML += `<td></td>`;
        machines.forEach(m => {
            tableHTML += `<td id="total-machine-${m.id}">0.00</td>`;
        });
        tableHTML += `<td></td>`;
        tableHTML += '</tr></tfoot></table>';

        container.innerHTML = tableHTML;
    } catch (error) {
        container.innerHTML = `<p style="color: red;">Error al cargar la parrilla: ${error.message}</p>`;
    }
}

async function submitGridPlan() {
    const startDate = document.getElementById('gridStartDate').value;
    if (!startDate) return alert('Por favor, especifica una fecha de inicio.');
    const moldId = document.getElementById('planMoldSelector').value;
    if (!moldId) return alert("Debes seleccionar un molde para poder crear la planificación.");
    
    const tasks = [];
    document.querySelectorAll('.hours-input').forEach(input => {
        const totalHours = parseFloat(input.value);
        if (totalHours > 0) {
            tasks.push({
                moldId: parseInt(moldId),
                partId: parseInt(input.dataset.partId),
                machineId: parseInt(input.dataset.machineId),
                startDate: startDate,
                totalHours: totalHours
            });
        }
    });
    
    if (tasks.length === 0) return alert('No se han ingresado horas para planificar.');

    const submitBtn = document.getElementById('submitGridPlanBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Procesando...';
    
    const results = [];
    for (const task of tasks) {
        try {
            const response = await fetch(`${API_URL}/tasks/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify(task) });
            results.push({ task, success: response.ok, result: await response.json() });
        } catch (error) {
            results.push({ task, success: false, result: { error: error.message } });
        }
    }
    
    submitBtn.disabled = false;
    submitBtn.textContent = 'Crear Planificación desde Parrilla';
    displayResponse('gridResponse', results, true);
    alert('Proceso de planificación completado. Revisa la respuesta.');
}

// =================================================================================
// LÓGICA PESTAÑA "CALENDARIO" (NUEVA VERSIÓN VISUAL)
// =================================================================================

function changeMonth(direction) {
    currentMonth += direction;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    } else if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    renderCalendar(currentYear, currentMonth);
}

async function handleDayClick(event) {
    const dayCell = event.target.closest('.calendar-day');
    if (dayCell && !dayCell.classList.contains('other-month')) {
        const day = dayCell.dataset.day;
        const eventsData = JSON.parse(dayCell.dataset.events || '{}');
        
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        
        modalTitle.textContent = `Detalles del ${day} de ${monthNames[currentMonth]} de ${currentYear}`;
        
        if (Object.keys(eventsData).length > 0) {
            let html = '<h4>Tareas Planificadas:</h4>';
            eventsData.tasks.forEach(task => {
                html += `<p><strong>Molde:</strong> ${task.mold} <br> <strong>Parte:</strong> ${task.part} <br> <strong>Máquina:</strong> ${task.machine} (${task.hours}h)</p>`;
            });

            html += '<h4>Uso de Máquinas (Capacidad 8h):</h4><ul>';
            for (const [machine, hours] of Object.entries(eventsData.machineUsage)) {
                const percentage = (hours / 8) * 100;
                const color = percentage > 100 ? 'red' : 'green';
                html += `<li><strong>${machine}:</strong> ${hours}h / 8h <span style="color:${color}">(${percentage.toFixed(0)}% ocupado)</span></li>`;
            }
            html += '</ul>';
            modalBody.innerHTML = html;
        } else {
            modalBody.innerHTML = '<p>No hay tareas planificadas para este día.</p>';
        }

        document.getElementById('day-details-modal').classList.remove('hidden');
    }
}

function closeModal() {
    document.getElementById('day-details-modal').classList.add('hidden');
}

async function renderCalendar(year, month) {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthYearEl = document.getElementById('calendar-month-year');
    if (!calendarGrid || !monthYearEl) return;
    
    calendarGrid.innerHTML = 'Cargando...';
    monthYearEl.textContent = `${monthNames[month]} ${year}`;

    const events = await fetchMonthEvents(year, month + 1);

    calendarGrid.innerHTML = '';
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDayOfMonth; i++) {
        calendarGrid.innerHTML += `<div class="calendar-day other-month"></div>`;
    }

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const dayCell = document.createElement('div');
        dayCell.classList.add('calendar-day');
        dayCell.dataset.day = day;

        if (year === today.getFullYear() && month === today.getMonth() && day === today.getDate()) {
            dayCell.classList.add('today');
        }

        let dayContent = `<div class="day-number">${day}</div>`;

        if (events[day]) {
            const totalHours = Object.values(events[day].machineUsage).reduce((sum, h) => sum + h, 0);
            dayContent += `<div class="events-indicator">${totalHours.toFixed(1)}h</div>`;
            dayCell.dataset.events = JSON.stringify(events[day]);
        }

        dayCell.innerHTML = dayContent;
        calendarGrid.appendChild(dayCell);
    }
}

async function fetchMonthEvents(year, month) {
    try {
        const response = await fetch(`${API_URL}/calendar/month-view?year=${year}&month=${month}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!response.ok) return {};
        return await response.json();
    } catch (error) {
        console.error('Error al cargar eventos del calendario:', error);
        return {};
    }
}

// =================================================================================
// OTRAS PESTAÑAS
// =================================================================================

async function createWorkLog() {
    if (!authToken) return;
    const body = {
        moldId: parseInt(document.getElementById('workMoldId').value),
        partId: parseInt(document.getElementById('workPartId').value),
        machineId: parseInt(document.getElementById('workMachineId').value),
        operatorId: parseInt(document.getElementById('workOperatorId').value),
        hours_worked: parseFloat(document.getElementById('workHours').value),
        note: document.getElementById('workNote').value || null
    };
    try {
        const response = await fetch(`${API_URL}/work_logs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify(body) });
        displayResponse('worklogResponse', await response.json(), response.ok);
    } catch (error) {
        displayResponse('worklogResponse', { error: error.message }, false);
    }
}

async function loadReport() {
    if (!authToken) return;
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const moldId = document.getElementById('reportMoldId').value;
    let url = `${API_URL}/reports/planned-vs-actual?from=${from}&to=${to}`;
    if (moldId) url += `&moldId=${moldId}`;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
        displayResponse('reportResponse', await response.json(), response.ok);
    } catch (error) {
        displayResponse('reportResponse', { error: error.message }, false);
    }
}

async function loadDetailedReport() {
    if (!authToken) return;
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    let url = `${API_URL}/reports/detailed-deviations?from=${from}&to=${to}`;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
        displayResponse('reportResponse', await response.json(), response.ok);
    } catch (error) {
        displayResponse('reportResponse', { error: error.message }, false);
    }
}