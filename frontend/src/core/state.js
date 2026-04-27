export const state = {
  API_URL: '/api',
  SERVER_URL: '/api'.replace(/\/api\/?$/, ''),
  currentUser: null,
  
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  monthNames: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  
  DEFAULT_INACTIVITY_MINUTES: 60,
  INACTIVITY_TIMEOUT: (parseInt(localStorage.getItem('inactivityMinutes') || 60, 10) || 60) * 60 * 1000,
  
  inactivityTimer: null,
  HEALTH_INTERVAL_MS: 30000,
  healthTimer: null,
  bootstrapStatusTimer: null,
  
  FIXED_MACHINES: [
    { id: 'CNC_VF3_1', name: 'CNC VF3 #1', hoursAvailable: 15 },
    { id: 'CNC_VF3_2', name: 'CNC VF3 #2', hoursAvailable: 15 },
    { id: 'FRESADORA_1', name: 'Fresadora #1', hoursAvailable: 14 },
    { id: 'FRESADORA_2', name: 'Fresadora #2', hoursAvailable: 14 },
    { id: 'TORNO_CNC', name: 'Torno CNC', hoursAvailable: 9.5 },
    { id: 'EROSIONADORA', name: 'Erosionadora', hoursAvailable: 14 },
    { id: 'RECTIFICADORA', name: 'Rectificadora', hoursAvailable: 14 },
    { id: 'TORNO', name: 'Torno', hoursAvailable: 14 },
    { id: 'TALADRO_RADIAL', name: 'Taladro radial', hoursAvailable: 14 },
    { id: 'PULIDA', name: 'Pulida', hoursAvailable: 9.5 }
  ],
  
  FIXED_PARTS: [
    "Anillo de Expulsion", "Anillo de Registro", "Boquilla Principal", "Botador inclinado", "Buje de Expulsion",
    "Buje Principal", "Bujes de Rama", "Correderas", "Deflector de Refrigeración", "Devolvedores", "Electrodos",
    "Flanche actuador hidraulico", "Guia actuadur hidraulico", "Guia Principal", "Guias de expulsion", "Guias de Rama",
    "Haladores", "Hembra", "Hembra empotrada", "Limitadores de Placa Flotante", "Macho", "Macho Central", "Macho empotrado",
    "Molde completo", "Nylon", "Paralelas Porta Macho", "Pilares Soporte", "Placa anillos expulsores", "Placa de Expulsion",
    "Placa Expulsion de Rama", "Placa Portahembras", "Placa Portamachos", "placa respaldo anillos expulsores",
    "Placa Respaldo de Expulsion", "Placa Respaldo Hembras", "Placa Respaldo Inferior", "Placa Respaldo Machos",
    "Placa respaldo portamachos", "Placa Respaldo Superior", "Placa Tope", "Porta Fondo", "Retenedores de Rama",
    "Soporte correderas", "Soporte nylon", "Tapones de Enfriamiento", "Techos"
  ],
  
  cachedMolds: [],
  plannerPendingMoldName: null,
  
  LS_KEYS: {
    plannerState: 'plannerState',
    plannerGridConfig: 'plannerGridConfig',
    configPartsDefaultsApplied: 'configPartsDefaultsApplied',
    inactivityMinutes: 'inactivityMinutes',
    indicatorsSelectedOperators: 'indicatorsSelectedOperators',
    financialCostedMoldsHistory: 'financialCostedMoldsHistory'
  },
  
  plannerCatalogMachines: [],
  plannerCatalogParts: [],
  plannerMachinesInGrid: [],
  plannerPartsInGrid: [],
  plannerLoadedMold: null,
  plannerPreviewMode: false,
  
  toastTimer: null,
  hoursOptionsCache: null,
  
  calendarHolidaysCache: {},
  calendarWorkingOverridesCache: {},
  calendarCompletedMoldIdsCache: new Set(),
  fullCalendarInstance: null,
  fullCalendarResourcesCache: [],
  calendarMonthState: {
    year: null,
    month: null,
    monthData: null,
    hideCompleted: false,
  },
  isCalendarLoading: false,
  isDeletingMold: false,
  currentCalendarRequestId: 0,
  calendarLoadingCount: 0,
  currentDayDetailsRequestId: 0,
  sharedDays: JSON.parse(localStorage.getItem('sharedDays') || '{}')
};
