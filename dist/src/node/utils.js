import { createHash } from 'crypto';
/**
 * Generate cryptographic IPv6 address from public key
 */
export function generateCryptoIPv6(publicKey) {
    const hash = createHash('sha256').update(publicKey).digest();
    const ipv6Bytes = hash.subarray(0, 16);
    const parts = [];
    for (let i = 0; i < 8; i++) {
        const part = (ipv6Bytes[i * 2] << 8) | ipv6Bytes[i * 2 + 1];
        parts.push(part.toString(16).padStart(4, '0'));
    }
    parts[0] = 'fd00'; // DIG network prefix
    return parts.join(':');
}
/**
 * Parse DIP-0001 URN: urn:dig:chia:{storeID}:{optional roothash}/{optional resource key}
 */
export function parseURN(urn) {
    if (!urn.toLowerCase().startsWith('urn:dig:chia:')) {
        console.warn('URN must start with urn:dig:chia:', urn);
        return null;
    }
    try {
        const nss = urn.substring(14); // Remove "urn:dig:chia:"
        const slashIndex = nss.indexOf('/');
        let storePart;
        let resourceKey = 'index.html';
        if (slashIndex !== -1) {
            storePart = nss.substring(0, slashIndex);
            resourceKey = nss.substring(slashIndex + 1);
        }
        else {
            storePart = nss;
        }
        const colonIndex = storePart.indexOf(':');
        let storeId;
        let rootHash;
        if (colonIndex !== -1) {
            storeId = storePart.substring(0, colonIndex);
            rootHash = storePart.substring(colonIndex + 1);
        }
        else {
            storeId = storePart;
        }
        // Validate formats
        if (!/^[a-fA-F0-9]+$/.test(storeId) || storeId.length < 32) {
            console.warn('Invalid storeID format in URN:', storeId);
            return null;
        }
        if (rootHash && (!/^[a-fA-F0-9]+$/.test(rootHash) || rootHash.length < 32)) {
            console.warn('Invalid rootHash format in URN:', rootHash);
            return null;
        }
        return { storeId, filePath: resourceKey, rootHash };
    }
    catch (error) {
        console.error('URN parsing error:', error);
        return null;
    }
}
/**
 * Guess MIME type from file extension
 */
export function guessMimeType(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeTypes = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'mp4': 'video/mp4',
        'mp3': 'audio/mpeg',
        'pdf': 'application/pdf',
        'txt': 'text/plain'
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
}
/**
 * Validate store ID format
 */
export function validateStoreId(storeId) {
    return /^[a-fA-F0-9]+$/.test(storeId) && storeId.length >= 32;
}
/**
 * Validate root hash format
 */
export function validateRootHash(rootHash) {
    return /^[a-fA-F0-9]+$/.test(rootHash) && rootHash.length >= 32;
}
//# sourceMappingURL=utils.js.map