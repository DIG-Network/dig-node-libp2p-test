/**
 * Validate if a string is a valid DIG URN
 */
export declare function isValidDIGURN(urn: string): boolean;
/**
 * Validate if a string is a valid DIG URL
 */
export declare function isValidDIGURL(url: string): boolean;
/**
 * Extract store ID from DIG URN or URL
 */
export declare function extractStoreId(identifier: string): string | null;
/**
 * Extract file path from DIG URN or URL
 */
export declare function extractFilePath(identifier: string): string;
/**
 * Convert DIG URN to DIG URL
 */
export declare function urnToUrl(urn: string): string | null;
/**
 * Convert DIG URL to DIG URN
 */
export declare function urlToUrn(url: string): string | null;
/**
 * Check if service worker is supported
 */
export declare function isServiceWorkerSupported(): boolean;
/**
 * Get file extension from path
 */
export declare function getFileExtension(filePath: string): string;
/**
 * Guess MIME type from file extension
 */
export declare function guessMimeTypeFromPath(filePath: string): string;
