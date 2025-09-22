import { createECDH, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Logger } from './logger.js';

export class E2EEncryption {
  private logger = new Logger('E2E');
  private ecdh = createECDH('secp256k1');
  private publicKey: Buffer;
  private sharedSecrets = new Map<string, Buffer>(); // peerId -> shared secret

  constructor() {
    this.ecdh.generateKeys();
    this.publicKey = this.ecdh.getPublicKey();
  }

  // Get our public key for handshake
  getPublicKey(): string {
    return this.publicKey.toString('hex');
  }

  // Establish shared secret with peer
  establishSharedSecret(peerId: string, peerPublicKey: string): Buffer {
    try {
      const peerPubKeyBuffer = Buffer.from(peerPublicKey, 'hex');
      const sharedSecret = this.ecdh.computeSecret(peerPubKeyBuffer);
      
      this.sharedSecrets.set(peerId, sharedSecret);
      this.logger.debug(`🔐 Established shared secret with peer: ${peerId}`);
      
      return sharedSecret;
    } catch (error) {
      this.logger.error(`Failed to establish shared secret with ${peerId}:`, error);
      throw error;
    }
  }

  // Encrypt data for specific peer
  encryptForPeer(peerId: string, data: Buffer): string {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      throw new Error(`No shared secret established with peer: ${peerId}`);
    }

    try {
      // Use first 32 bytes of shared secret as encryption key
      const key = sharedSecret.subarray(0, 32);
      const iv = randomBytes(16);
      
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Prepend IV to encrypted data
      const result = Buffer.concat([iv, encrypted]);
      
      this.logger.debug(`🔐 Encrypted ${data.length} bytes for peer ${peerId}`);
      return result.toString('base64');
      
    } catch (error) {
      this.logger.error(`Encryption failed for peer ${peerId}:`, error);
      throw error;
    }
  }

  // Decrypt data from specific peer
  decryptFromPeer(peerId: string, encryptedData: string): Buffer {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      throw new Error(`No shared secret established with peer: ${peerId}`);
    }

    try {
      const data = Buffer.from(encryptedData, 'base64');
      
      // Extract IV and encrypted content
      const iv = data.subarray(0, 16);
      const encrypted = data.subarray(16);
      
      // Use first 32 bytes of shared secret as decryption key
      const key = sharedSecret.subarray(0, 32);
      
      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      this.logger.debug(`🔓 Decrypted ${decrypted.length} bytes from peer ${peerId}`);
      return decrypted;
      
    } catch (error) {
      this.logger.error(`Decryption failed for peer ${peerId}:`, error);
      throw error;
    }
  }

  // Check if we have a shared secret with peer
  hasSharedSecret(peerId: string): boolean {
    return this.sharedSecrets.has(peerId);
  }

  // Remove shared secret (on disconnect)
  removeSharedSecret(peerId: string): void {
    this.sharedSecrets.delete(peerId);
    this.logger.debug(`🗑️ Removed shared secret for peer: ${peerId}`);
  }

  // Get protocol capabilities
  static getProtocolCapabilities(): string[] {
    return [
      'e2e-encryption',
      'protocol-negotiation', 
      'store-sync',
      'turn-relay',
      'circuit-relay',
      'webrtc-nat',
      'websocket-transport'
    ];
  }

  // Get current protocol version
  static getProtocolVersion(): string {
    return '1.0.0';
  }
}
