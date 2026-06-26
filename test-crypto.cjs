const crypto = require('crypto');

// Test encryption/decryption
const ENCRYPTION_KEYS = {
  v1: Buffer.from('h6NsYI/1Voh26Nh5PzwJgcPWZTYtkbQ4V9Hd/dfpPRY=', 'base64'),
};

function encryptField(plaintext) {
  const key = ENCRYPTION_KEYS.v1;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  return `encrypted:v1:${iv.toString('base64')}:${authTag}:${encrypted}`;
}

function decryptField(encrypted) {
  if (!encrypted.startsWith('encrypted:')) {
    return encrypted;
  }

  const withoutPrefix = encrypted.slice('encrypted:'.length);
  const parts = withoutPrefix.split(':');

  const [version, ivBase64, authTagBase64, ciphertext] = parts;
  const key = ENCRYPTION_KEYS[version];
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Test
const testToken = 'sk-test-1234567890abcdef';
const encrypted = encryptField(testToken);
const decrypted = decryptField(encrypted);

console.log('Original:', testToken);
console.log('Encrypted:', encrypted);
console.log('Decrypted:', decrypted);
console.log('Match:', testToken === decrypted);
console.log('Format check:', /^encrypted:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(encrypted));

// Test backward compatibility
const plainValue = 'plain-token-123';
const decryptedPlain = decryptField(plainValue);
console.log('Backward compat:', plainValue === decryptedPlain);
