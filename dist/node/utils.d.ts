import { ParsedURN } from './types';
/**
 * Generate cryptographic IPv6 address from public key
 */
export declare function generateCryptoIPv6(publicKey: string): string;
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
