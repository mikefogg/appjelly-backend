import { decrypt } from './src/helpers/encryption.js';
import pkg from 'pg';
const { Client } = pkg;

const connectionString = 'postgresql://localhost:5432/snugglebug_dev';

async function testDecrypt() {
  const client = new Client({ connectionString });

  try {
    await client.connect();

    const result = await client.query(
      'SELECT id, username, access_token, refresh_token FROM connected_accounts WHERE id = $1',
      ['7b9f13e6-45fa-41e0-83f6-53e356a52169']
    );

    if (result.rows.length === 0) {
      console.log('No connection found');
      return;
    }

    const conn = result.rows[0];
    console.log('\n📊 Connection Info:');
    console.log('ID:', conn.id);
    console.log('Username:', conn.username);
    console.log('Has access_token:', !!conn.access_token);
    console.log('Has refresh_token:', !!conn.refresh_token);

    console.log('\n🔓 Attempting to decrypt tokens...\n');

    try {
      const decryptedAccess = decrypt(conn.access_token);
      console.log('✅ Access Token (decrypted):');
      console.log(decryptedAccess);
      console.log('\nLength:', decryptedAccess.length);
      console.log('Prefix:', decryptedAccess.substring(0, 20) + '...');
    } catch (error) {
      console.log('❌ Failed to decrypt access_token:', error.message);
    }

    console.log('\n---\n');

    try {
      const decryptedRefresh = decrypt(conn.refresh_token);
      console.log('✅ Refresh Token (decrypted):');
      console.log(decryptedRefresh);
      console.log('\nLength:', decryptedRefresh.length);
      console.log('Prefix:', decryptedRefresh.substring(0, 20) + '...');
    } catch (error) {
      console.log('❌ Failed to decrypt refresh_token:', error.message);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testDecrypt();
