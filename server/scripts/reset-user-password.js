#!/usr/bin/env node

/**
 * Reset de contraseña para un usuario existente.
 * Uso:
 *   node scripts/reset-user-password.js --username admin --password "NuevaClave"
 *
 * Notas:
 * - No borra filas (evita problemas con foreign keys como plan_entries.created_by).
 * - Requiere acceso al servidor/entorno donde corre la API (misma config .env de DB).
 */

const bcrypt = require('bcryptjs');
const { query } = require('../src/config/database');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--username' || a === '-u') out.username = argv[++i];
    else if (a === '--password' || a === '-p') out.password = argv[++i];
  }
  return out;
}

async function main() {
  const { username, password } = parseArgs(process.argv);

  if (!username || !password) {
    console.error('Uso: node scripts/reset-user-password.js --username <user> --password <newPassword>');
    process.exit(2);
  }

  const users = await query('SELECT id, username, role FROM users WHERE username = ? LIMIT 1', [username]);
  if (!users.length) {
    console.error(`No existe el usuario: ${username}`);
    process.exit(3);
  }

  const hash = await bcrypt.hash(String(password), 10);
  await query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, username]);

  console.log(`✅ Contraseña actualizada: ${username} (rol: ${users[0].role})`);
}

main().catch((e) => {
  console.error('❌ Error reseteando contraseña:', e && e.message ? e.message : e);
  process.exit(1);
});
