require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./src/db');

async function resetAdminPassword() {
  try {
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('Sätter admin-lösenord...');
    console.log(`Hash: ${hashedPassword}\n`);

    const result = await db.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username',
      [hashedPassword, 'admin']
    );

    if (result.rows.length === 0) {
      console.log('Admin-användare hittades inte. Skapar...');
      await db.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        ['admin', hashedPassword]
      );
      console.log('✅ Admin-användare skapad');
    } else {
      console.log('✅ Admin-lösenord uppdaterat');
    }

    console.log('\nDu kan nu logga in med:');
    console.log('Användarnamn: admin');
    console.log('Lösenord: admin123');
    
    process.exit(0);
  } catch (error) {
    console.error('Fel:', error.message);
    process.exit(1);
  }
}

resetAdminPassword();
