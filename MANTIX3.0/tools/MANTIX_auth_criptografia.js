'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const SETTINGS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 256) {
    throw new Error('La contrasena debe tener entre 12 y 256 bytes UTF-8.');
  }
  const salt = crypto.randomBytes(32);
  const hash = await scrypt(password, salt, 64, SETTINGS);
  return `scrypt$v1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string' || !stored.startsWith('scrypt$v1$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || !/^[0-9a-f]{64}$/.test(parts[2]) || !/^[0-9a-f]{128}$/.test(parts[3])) return false;
  if (Buffer.byteLength(password, 'utf8') > 256) return false;
  const actual = await scrypt(password, Buffer.from(parts[2], 'hex'), 64, SETTINGS);
  return crypto.timingSafeEqual(actual, Buffer.from(parts[3], 'hex'));
}
module.exports = { hashPassword, verifyPassword };
