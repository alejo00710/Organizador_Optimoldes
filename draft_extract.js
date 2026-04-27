const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'frontend/app.js');
const plannerPath = path.join(__dirname, 'frontend/src/features/planner.js');
const worklogsPath = path.join(__dirname, 'frontend/src/features/worklogs.js');
const indicatorsPath = path.join(__dirname, 'frontend/src/features/indicators.js');

const codeStr = fs.readFileSync(appJsPath, 'utf8');
const lines = codeStr.split(/\r?\n/);

// We will find boundaries based on comments or function signatures.
// Planner: from initPlannerTab to submitGridPlan
// Worklogs: from getTiemposSelectedYMD to importDatosCSV
// Indicators: from indicatorsCache to exportIndicatorsCSV

let plannerStart = -1, plannerEnd = -1;
let worklogsStart = -1, worklogsEnd = -1;
let indicatorsStart = -1, indicatorsEnd = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('async function initPlannerTab()')) plannerStart = i;
  if (lines[i].includes('function getTiemposSelectedYMD()')) worklogsStart = i;
  if (lines[i].includes('let indicatorsCache = null;')) indicatorsStart = i;
}

// Find ends by looking backwards from the start of the next section
for (let i = worklogsStart - 1; i >= plannerStart; i--) {
  if (lines[i].trim() === '}') {
    plannerEnd = i;
    break;
  }
}

for (let i = indicatorsStart - 1; i >= worklogsStart; i--) {
  if (lines[i].trim() === '}') {
    worklogsEnd = i;
    break;
  }
}

// Indicator end is just before the clearPlannerGrid function (or the end of the functions)
for (let i = indicatorsStart; i < lines.length; i++) {
  if (lines[i].includes('function clearPlannerGrid()')) {
    indicatorsEnd = i - 1;
    break;
  }
}

if (indicatorsEnd === -1) {
  // Try to find the closing brace of exportIndicatorsCSV
  for (let i = indicatorsStart; i < lines.length; i++) {
    if (lines[i].includes('function exportIndicatorsCSV()')) {
      for (let j = i; j < lines.length; j++) {
        if (lines[j].trim() === '}') {
          indicatorsEnd = j;
          break;
        }
      }
      break;
    }
  }
}

console.log('Planner:', plannerStart, plannerEnd);
console.log('Worklogs:', worklogsStart, worklogsEnd);
console.log('Indicators:', indicatorsStart, indicatorsEnd);

function buildModule(linesSlice, exportNames) {
  let header = `import { state } from '../core/state.js';\nimport * as api from '../core/api.js';\nimport { showToast, displayResponse, escapeHtml, openTab } from '../ui/ui.js';\n\n`;
  
  let mapped = linesSlice.map(l => {
    if (l.startsWith('function ') || l.startsWith('async function ')) return `export ${l}`;
    return l;
  }).join('\\n');

  let expose = `\n// --- AUTO EXPOSE START ---\nconst exports = { ${exportNames.join(', ')} };\nfor (const [name, func] of Object.entries(exports)) { if (typeof func === 'function') window[name] = func; }\n// --- AUTO EXPOSE END ---\n`;
  
  return header + mapped + expose;
}

// Wait, the new line format mapping might not correctly match everything (like `let ...`), but that's fine for now. We will use a script executed directly.
