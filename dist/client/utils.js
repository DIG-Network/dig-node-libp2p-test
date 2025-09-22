"use strict";
// Client utility functions
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidDIGURN = isValidDIGURN;
exports.isValidDIGURL = isValidDIGURL;
exports.extractStoreId = extractStoreId;
exports.extractFilePath = extractFilePath;
exports.urnToUrl = urnToUrl;
exports.urlToUrn = urlToUrn;
exports.isServiceWorkerSupported = isServiceWorkerSupported;
exports.getFileExtension = getFileExtension;
exports.guessMimeTypeFromPath = guessMimeTypeFromPath;
/**
 * Validate if a string is a valid DIG URN
 */
function isValidDIGURN(urn) {
    if (!urn.toLowerCase().startsWith('urn:dig:chia:')) {
        return false;
    }
    try {
        const nss = urn.substring(14);
        const slashIndex = nss.indexOf('/');
        let storePart;
        if (slashIndex !== -1) {
            storePart = nss.substring(0, slashIndex);
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
        // Validate storeId format
        if (!/^[a-fA-F0-9]+$/.test(storeId) || storeId.length < 32) {
            return false;
        }
        // Validate rootHash format if present
        if (rootHash && (!/^[a-fA-F0-9]+$/.test(rootHash) || rootHash.length < 32)) {
            return false;
        }
        return true;
    }
    catch (error) {
        return false;
    }
}
/**
 * Validate if a string is a valid DIG URL
 */
function isValidDIGURL(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol === 'dig:' && parsedUrl.hostname.length >= 32;
    }
    catch (error) {
        return false;
    }
}
/**
 * Extract store ID from DIG URN or URL
 */
function extractStoreId(identifier) {
    if (identifier.toLowerCase().startsWith('urn:dig:chia:')) {
        try {
            const nss = identifier.substring(14);
            const slashIndex = nss.indexOf('/');
            let storePart;
            if (slashIndex !== -1) {
                storePart = nss.substring(0, slashIndex);
            }
            else {
                storePart = nss;
            }
            const colonIndex = storePart.indexOf(':');
            return colonIndex !== -1 ? storePart.substring(0, colonIndex) : storePart;
        }
        catch (error) {
            return null;
        }
    }
    if (identifier.startsWith('dig://')) {
        try {
            const url = new URL(identifier);
            return url.hostname;
        }
        catch (error) {
            return null;
        }
    }
    return null;
}
/**
 * Extract file path from DIG URN or URL
 */
function extractFilePath(identifier) {
    if (identifier.toLowerCase().startsWith('urn:dig:chia:')) {
        try {
            const nss = identifier.substring(14);
            const slashIndex = nss.indexOf('/');
            return slashIndex !== -1 ? nss.substring(slashIndex + 1) : 'index.html';
        }
        catch (error) {
            return 'index.html';
        }
    }
    if (identifier.startsWith('dig://')) {
        try {
            const url = new URL(identifier);
            const path = url.pathname.substring(1); // Remove leading slash
            return path || 'index.html';
        }
        catch (error) {
            return 'index.html';
        }
    }
    return 'index.html';
}
/**
 * Convert DIG URN to DIG URL
 */
function urnToUrl(urn) {
    if (!isValidDIGURN(urn)) {
        return null;
    }
    const storeId = extractStoreId(urn);
    const filePath = extractFilePath(urn);
    if (!storeId) {
        return null;
    }
    return filePath === 'index.html' ? `dig://${storeId}/` : `dig://${storeId}/${filePath}`;
}
/**
 * Convert DIG URL to DIG URN
 */
function urlToUrn(url) {
    if (!isValidDIGURL(url)) {
        return null;
    }
    const storeId = extractStoreId(url);
    const filePath = extractFilePath(url);
    if (!storeId) {
        return null;
    }
    return filePath === 'index.html' ? `urn:dig:chia:${storeId}` : `urn:dig:chia:${storeId}/${filePath}`;
}
/**
 * Check if service worker is supported
 */
function isServiceWorkerSupported() {
    return 'serviceWorker' in navigator;
}
/**
 * Get file extension from path
 */
function getFileExtension(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot !== -1 ? filePath.substring(lastDot + 1).toLowerCase() : '';
}
/**
 * Guess MIME type from file extension
 */
function guessMimeTypeFromPath(filePath) {
    const ext = getFileExtension(filePath);
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
    return mimeTypes[ext] || 'application/octet-stream';
}
//# sourceMappingURL=utils.js.map