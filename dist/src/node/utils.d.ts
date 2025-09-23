import { ParsedURN } from './types.js';
/**
 * Generate cryptographic IPv6 address from public key
 */
export declare function generateCryptoIPv6(publicKey: string): string;
/**
 * Create crypto-IPv6 overlay network addresses (privacy-preserving)
 */
export declare function createCryptoIPv6Addresses(cryptoIPv6: string, port?: number): string[];
/**
 * Resolve crypto-IPv6 to real addresses via bootstrap server (privacy-preserving lookup)
 */
export declare function resolveCryptoIPv6(cryptoIPv6: string, bootstrapUrl: string): Promise<string[]>;
/**
 * Check if an address is a crypto-IPv6 overlay address
 */
export declare function isCryptoIPv6Address(address: string): boolean;
/**
 * Parse DIP-0001 URN: urn:dig:chia:{storeID}:{optional roothash}/{optional resource key}
 */
export declare function parseURN(urn: string): ParsedURN | null;
/**
 * Guess MIME type from file extension
 */
export declare function guessMimeType(filePath: string): string;
/**
 * Validate store ID format
 */
export declare function validateStoreId(storeId: string): boolean;
/**
 * Validate root hash format
 */
export declare function validateRootHash(rootHash: string): boolean;
