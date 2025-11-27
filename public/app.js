const API_URL = 'http://localhost:3000/api';
let authToken = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    checkHealth();
    setDefaultDates();
    setupUsernameChange();
    setupEventListeners();
    
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');
    
    if (savedToken && savedUser) {
        authToken = savedToken;
        currentUser = JSON.parse(savedUser);
        showUserInfo();
    }
});

function setupEventListeners() {
    document.getElementById('loginBtn')?. addEventListener('click', login);
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    
    document.querySelectorAll('[data-tab]'). forEach(tab => {
        tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });
    
    document.getElementById('loadMachinesBtn')?.addEventListener('click', loadMachines);
    document.getElementById('createPlanBtn')?.addEventListener('click', createPlan);
    document.getElementById('createWorkLogBtn')?.addEventListener('click', createWorkLog);
    document.getElementById('loadCalendarBtn')?.addEventListener('click', loadCalendar);
    document. getElementById('loadReportBtn')?. addEventListener('click', loadReport);
    document.getElementById('loadDetailedReportBtn')?.addEventListener('click', loadDetailedReport);
}

async function checkHealth() {
    try {
        const response = await fetch('http://localhost:3000/health');
        const data = await response. json();
        
        if (data.status === 'ok') {
            document.getElementById('status').classList.remove('disconnected');
            document.getElementById('status').textContent = '● Conectado';
        }
    } catch (error) {
        document.getElementById('status').classList.add('disconnected');
        document. getElementById('status').textContent = '● Desconectado';
    }
}

function setDefaultDates() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow. getDate() + 1);
    
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    document.getElementById('planStartDate').value = formatDate(tomorrow);
    document.getElementById('calendarFrom').value = formatDate(today);
    document.getElementById('calendarTo').value = formatDate(nextMonth);
    document.getElementById('reportFrom').value = formatDate(today);
    document.getElementById('reportTo').value = formatDate(nextMonth);
}

function setupUsernameChange() {
    document.getElementById('username').addEventListener('change', async (e) => {
        const operatorGroup = document.getElementById('operatorSelectGroup');
        
        if (e.target.value === 'operarios') {
            operatorGroup.classList.remove('hidden');
            await loadOperators();
        } else {
            operatorGroup.classList.add('hidden');
        }
    });
}

async function loadOperators() {
    try {
        const response = await fetch(`${API_URL}/auth/operators? username=operarios`);
        const data = await response.json();
        
        if (! response.ok) {
            console.error('Error loading operators:', data);
            return;
        }
        
        const select = document.getElementById('operatorId');
        select.innerHTML = '<option value="">Seleccionar... </option>';
        
        if (Array.isArray(data)) {
            data.forEach(op => {
                const option = document.createElement('option');
                option.value = op.id;
                option.textContent = op. name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error cargando operarios:', error);
    }
}

async function login() {
    const username = document.getElementById('username').value;
    const password = document. getElementById('password').value;
    const operatorId = document.getElementById('operatorId').value;
    
    const body = { username, password };
    
    if (username === 'operarios') {
        if (!operatorId) {
            alert('Por favor selecciona un operario');
            return;
        }
        body.operatorId = parseInt(operatorId);
    }
    
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON. stringify(body)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            showUserInfo();
            alert('¡Login exitoso!');
            await checkHealth();
        } else {
            alert('Error: ' + (data.error || 'Login fallido'));
            console.error('Login failed:', data);
        }
    } catch (error) {
        alert('Error de conexión: ' + error.message);
        console.error('Connection error:', error);
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    
    document.getElementById('userInfo').classList.remove('active');
    document.getElementById('loginPanel').querySelector('h2').style.display = 'block';
    document.querySelectorAll('#loginPanel .form-group').forEach(el => el.style.display = 'block');
    document.getElementById('loginBtn').style.display = 'block';
    
    alert('Sesión cerrada');
}

function showUserInfo() {
    document.getElementById('displayUsername').textContent = currentUser. username;
    document.getElementById('displayRole').textContent = currentUser.role;
    document.getElementById('displayOperator').textContent = currentUser.operatorName || 'N/A';
    
    document.getElementById('userInfo').classList.add('active');
    document.getElementById('loginPanel').querySelector('h2').style. display = 'none';
    document.querySelectorAll('#loginPanel .form-group').forEach(el => el.style.display = 'none');
    document. getElementById('loginBtn').style.display = 'none';
    
    if (currentUser.operatorId) {
        document. getElementById('workOperatorId').value = currentUser. operatorId;
    }
}

function showTab(tabName) {
    document.querySelectorAll('[data-tab]').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList. add('active');
    document. getElementById(`tab-${tabName}`).classList.add('active');
}

async function loadMachines() {
    if (!authToken) {
        alert('Por favor inicia sesión primero');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/machines`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        displayResponse('machinesResponse', data, response.ok);
    } catch (error) {
        displayResponse('machinesResponse', { error: error.message }, false);
    }
}

async function createPlan() {
    if (!authToken) {
        alert('Por favor inicia sesión primero');
        return;
    }
    
    const body = {
        moldId: parseInt(document.getElementById('planMoldId').value),
        partId: parseInt(document.getElementById('planPartId').value),
        machineId: parseInt(document.getElementById('planMachineId').value),
        startDate: document. getElementById('planStartDate').value,
        totalHours: parseFloat(document.getElementById('planTotalHours').value)
    };
    
    try {
        const response = await fetch(`${API_URL}/tasks/plan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        displayResponse('planResponse', data, response. ok);
    } catch (error) {
        displayResponse('planResponse', { error: error.message }, false);
    }
}

async function createWorkLog() {
    if (!authToken) {
        alert('Por favor inicia sesión primero');
        return;
    }
    
    const body = {
        moldId: parseInt(document.getElementById('workMoldId').value),
        partId: parseInt(document.getElementById('workPartId').value),
        machineId: parseInt(document.getElementById('workMachineId').value),
        operatorId: parseInt(document.getElementById('workOperatorId').value),
        hours_worked: parseFloat(document.getElementById('workHours').value),
        note: document.getElementById('workNote').value || null
    };
    
    try {
        const response = await fetch(`${API_URL}/work_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON. stringify(body)
        });
        
        const data = await response.json();
        displayResponse('worklogResponse', data, response. ok);
    } catch (error) {
        displayResponse('worklogResponse', { error: error. message }, false);
    }
}

async function loadCalendar() {
    if (!authToken) {
        alert('Por favor inicia sesión primero');
        return;
    }
    
    const from = document.getElementById('calendarFrom').value;
    const to = document.getElementById('calendarTo').value;
    
    try {
        const response = await fetch(`${API_URL}/calendar? from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response. json();
        displayResponse('calendarResponse', data, response.ok);
    } catch (error) {
        displayResponse('calendarResponse', { error: error.message }, false);
    }
}

async function loadReport() {
    if (!authToken) {
        alert('Por favor inicia sesión primero');
        return;
    }
    
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const moldId = document.getElementById('reportMoldId').value;
    
    let url = `${API_URL}/reports/planned-vs-actual?from=${from}&to=${to}`;
    if (moldId) url += `&moldId=${moldId}`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        displayResponse('reportResponse', data, response.ok);
    } catch (error) {
        displayResponse('reportResponse', { error: error.message }, false);
    }
}

async function loadDetailedReport() {
    if (!authToken) {
        alert('Por favor inicia sesión primero');
        return;
    }
    
    const from = document.getElementById('reportFrom').value;
    const to = document. getElementById('reportTo').value;
    
    let url = `${API_URL}/reports/detailed-deviations?from=${from}&to=${to}`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        displayResponse('reportResponse', data, response. ok);
    } catch (error) {
        displayResponse('reportResponse', { error: error.message }, false);
    }
}

function displayResponse(elementId, data, success) {
    const element = document.getElementById(elementId);
    element.textContent = JSON.stringify(data, null, 2);
    element.className = 'response-box ' + (success ? 'success' : 'error');
}