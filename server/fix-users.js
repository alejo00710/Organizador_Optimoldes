const bcrypt = require('bcrypt');
const { query } = require('./src/config/database');

async function fixUsers() {
    try {
        console.log('🔧 Arreglando usuarios...\n');
        
        const password = 'password123';
        const hash = await bcrypt.hash(password, 10);
        
        console.log('Contraseña:', password);
        console.log('Nuevo hash:', hash);
        console.log('');
        
        // Actualizar todos los usuarios
        await query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, 'admin']);
        await query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, 'jefe']);
        await query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, 'operarios']);
        
        console.log('✅ Usuarios actualizados');
        console.log('');
        console.log('Prueba con:');
        console.log('  Usuario: jefe');
        console.log('  Contraseña: password123');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixUsers();