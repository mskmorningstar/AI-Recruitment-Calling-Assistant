const crypto = require('crypto');
require('dotenv').config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Derive 32-byte key from ENCRYPTION_KEY or fallback
function getKey() {
  const rawKey = process.env.ENCRYPTION_KEY || 'default_32_character_secret_key!';
  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * Encrypt sensitive text using AES-256-GCM
 */
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt ciphertext
 */
function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // If decryption fails, return original text
    return ciphertext;
  }
}

module.exports = {
  encrypt,
  decrypt,
};
