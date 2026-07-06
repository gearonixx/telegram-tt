import { IGE as AesIge } from '@cryptography/aes';

import { concat } from '../../../util/encoding/buffer';
import { ensureAesWasm, getAesWasm } from './aesWasm';

import { convertToLittle, generateRandomBytes } from '../Helpers';

const BLOCK_SIZE = 16;

class IGENEW {
  private key: Uint8Array;

  private iv: Uint8Array;

  private jsIge?: AesIge;

  constructor(key: Uint8Array, iv: Uint8Array) {
    ensureAesWasm();
    this.key = new Uint8Array(key);
    this.iv = new Uint8Array(iv);
  }

  /**
     * Decrypts the given text in 16-bytes blocks by using the given key and 32-bytes initialization vector
  */
  decryptIge(cipherText: Uint8Array): Uint8Array<ArrayBuffer> {
    const wasm = cipherText.length % BLOCK_SIZE === 0 ? getAesWasm() : undefined;
    if (wasm) {
      return wasm.igeDecrypt(this.key, this.iv, cipherText);
    }

    return convertToLittle(this.getJsIge().decrypt(cipherText));
  }

  /**
     * Encrypts the given text in 16-bytes blocks by using the given key and 32-bytes initialization vector
     */
  encryptIge(plainText: Uint8Array) {
    const padding = plainText.length % BLOCK_SIZE;
    if (padding) {
      plainText = concat(
        plainText,
        generateRandomBytes(BLOCK_SIZE - padding),
      );
    }

    const wasm = getAesWasm();
    if (wasm) {
      return wasm.igeEncrypt(this.key, this.iv, plainText);
    }

    return convertToLittle(this.getJsIge().encrypt(plainText));
  }

  private getJsIge(): AesIge {
    this.jsIge ??= new AesIge(this.key, this.iv);
    return this.jsIge;
  }
}

export { IGENEW as IGE };
