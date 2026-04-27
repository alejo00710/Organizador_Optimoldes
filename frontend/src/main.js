import '../styles.css';
import { state } from './core/state.js';

// Exponemos el estado globalmente temporalmente si hay scripts que dependan de window (ej: onclicks de HTML)
window.state = state;

// Importar el app.js modificado para que se ejecute la lógica principal
import '../app.js';
import './features/calendar.js';
import { initFinancialEvents } from './features/financial.js';
import { initConfigEvents } from './features/config.js';
import { initPlannerEvents } from './features/planner.js';
import { initWorkLogsEvents } from './features/worklogs.js';
import { initIndicatorsEvents } from './features/indicators.js';
import { setupAuthListeners, initAuth } from './features/auth.js';
import { setupStickyTabsOffset, setupFixedTabsBar, setupLegalFooter, initNavigationEvents } from './ui/ui.js';

document.addEventListener('DOMContentLoaded', () => {
  setupLegalFooter();
  setupStickyTabsOffset();
  setupFixedTabsBar();
  initNavigationEvents();
  setupAuthListeners();
  initAuth();
  initConfigEvents();
  initWorkLogsEvents();
  initFinancialEvents();
  initPlannerEvents();
  initIndicatorsEvents();
});
