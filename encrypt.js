import crypto from 'crypto';
import {memoize} from './utils.js';

const EVP_BytesToKey = memoize(function (password, key_len, iv_len) {
  const m = [];
  let i = 0;
  let count = 0;
  while (count < key_len + iv_len) {
    const md5 = crypto.createHash('md5');
    let data = password;
    if (i > 0) {
      data = Buffer.concat([m[i - 1], password]);
    }
    md5.update(data);
    const d = md5.digest();
    m.push(d);
    count += d.length;
    i += 1;
  }
  const ms = Buffer.concat(m);
  const key = ms.subarray(0, key_len);
  const iv = ms.subarray(key_len, key_len + iv_len);
  return [key, iv];
});

const method_supported = {
  'aes-128-cfb': [16, 16],
  'aes-192-cfb': [24, 16],
  'aes-256-cfb': [32, 16],
  'camellia-128-cfb': [16, 16],
  'camellia-192-cfb': [24, 16],
  'camellia-256-cfb': [32, 16],
};

export class Encryptor {
  constructor(key, method) {
    this.key = key;
    this.method = method;
    this.iv_sent = false;
    this.cipher = this.get_cipher(
      this.key,
      this.method,
      1,
      crypto.randomBytes(32),
    );
  }

  get_cipher_len(method) {
    method = method.toLowerCase();
    return method_supported[method];
  }

  get_cipher(password, method, op, iv) {
    method = method.toLowerCase();
    password = Buffer.from(password, 'binary');
    const m = this.get_cipher_len(method);
    if (m) {
      const [key] = EVP_BytesToKey(password, m[0], m[1]);
      if (op === 1) {
        this.cipher_iv = iv.subarray(0, m[1]);
      }
      iv = iv.subarray(0, m[1]);
      if (op === 1) {
        return crypto.createCipheriv(method, key, iv);
      } else {
        return crypto.createDecipheriv(method, key, iv);
      }
    }
  }

  encrypt(buf) {
    const result = this.cipher.update(buf);
    if (this.iv_sent) {
      return result;
    } else {
      this.iv_sent = true;
      return Buffer.concat([this.cipher_iv, result]);
    }
  }

  decrypt(buf) {
    if (!this.decipher) {
      const decipher_iv_len = this.get_cipher_len(this.method)[1];
      if (buf.length < decipher_iv_len) throw new Error('insufficient iv');
      const decipher_iv = buf.subarray(0, decipher_iv_len);
      this.decipher = this.get_cipher(this.key, this.method, 0, decipher_iv);
      return this.decipher.update(buf.subarray(decipher_iv_len));
    } else {
      return this.decipher.update(buf);
    }
  }
}
