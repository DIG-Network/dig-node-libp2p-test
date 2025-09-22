// Service Worker for DIG Network URN resolution and load balancing
class DIGServiceWorker {
    constructor() {
        this.cache = null;
        this.gatewayUrl = 'http://localhost:8080';
        this.peerCache = new Map();
        this.initializeCache();
    }
    async initializeCache() {
        try {
            this.cache = await caches.open('dig-network-v1');
        }
        catch (error) {
            console.error('Failed to initialize DIG cache:', error);
        }
    }
    async handleFetch(event) {
        const url = new URL(event.request.url);
        if (this.shouldHandleDIGRequest(url)) {
            return await this.resolveDIGRequest(event.request, url);
        }
        return fetch(event.request);
    }
    shouldHandleDIGRequest(url) {
        return url.protocol === 'dig:' || url.toString().startsWith('urn:dig:');
    }
    parseDIGURL(url) {
        const urlString = url.toString();
        if (urlString.startsWith('urn:dig:')) {
            return this.parseURN(urlString);
        }
        if (url.protocol === 'dig:') {
            const pathParts = url.pathname.substring(1).split('/');
            const storeId = url.hostname || pathParts[0];
            const filePath = url.hostname ? url.pathname.substring(1) : pathParts.slice(1).join('/');
            if (!storeId)
                return null;
            return { storeId, filePath: filePath || 'index.html' };
        }
        return null;
    }
    parseURN(urn) {
        if (!urn.toLowerCase().startsWith('urn:dig:chia:')) {
            return null;
        }
        try {
            const nss = urn.substring(14);
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
            if (!/^[a-fA-F0-9]+$/.test(storeId) || storeId.length < 32) {
                return null;
            }
            if (rootHash && (!/^[a-fA-F0-9]+$/.test(rootHash) || rootHash.length < 32)) {
                return null;
            }
            return { storeId, filePath: resourceKey, rootHash };
        }
        catch (error) {
            return null;
        }
    }
    async resolveDIGRequest(request, url) {
        const parsed = this.parseDIGURL(url);
        if (!parsed) {
            return new Response('Invalid DIG URL format', {
                status: 400,
                statusText: 'Bad Request'
            });
        }
        const { storeId, filePath } = parsed;
        try {
            const cacheKey = `dig:${storeId}:${filePath}`;
            if (this.cache) {
                const cachedResponse = await this.cache.match(cacheKey);
                if (cachedResponse && this.isCacheValid(cachedResponse)) {
                    return cachedResponse.clone();
                }
            }
            const peers = await this.discoverStorePeers(storeId);
            if (peers.length === 0) {
                return new Response('No peers found for store', {
                    status: 404,
                    statusText: 'Not Found'
                });
            }
            const content = await this.loadBalancedDownload(storeId, filePath, peers);
            if (!content) {
                return new Response('Content not available from any peer', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            }
            const response = new Response(content.data, {
                status: 200,
                statusText: 'OK',
                headers: {
                    'Content-Type': content.mimeType,
                    'Content-Length': content.data.byteLength.toString(),
                    'X-DIG-Store-Id': storeId,
                    'X-DIG-Source-Peer': content.sourcePeer,
                    'Cache-Control': 'public, max-age=3600'
                }
            });
            if (this.cache) {
                await this.cache.put(cacheKey, response.clone());
            }
            return response;
        }
        catch (error) {
            return new Response(`DIG Network error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
                status: 500,
                statusText: 'Internal Server Error'
            });
        }
    }
    // Simplified peer discovery via gateway
    async discoverStorePeers(storeId) {
        try {
            const response = await fetch(`${this.gatewayUrl}/discover/${storeId}`);
            if (response.ok) {
                const data = await response.json();
                return data.peers || [];
            }
        }
        catch (error) {
            console.warn('Gateway discovery failed:', error);
        }
        return [];
    }
    async loadBalancedDownload(storeId, filePath, peers) {
        for (const peer of peers) {
            try {
                const result = await this.downloadFromPeer(peer, storeId, filePath);
                if (result) {
                    return {
                        data: result.data,
                        mimeType: result.mimeType,
                        sourcePeer: peer.peerId
                    };
                }
            }
            catch (error) {
                console.warn(`Download failed from peer ${peer.peerId}:`, error);
            }
        }
        return null;
    }
    async downloadFromPeer(peer, storeId, filePath) {
        try {
            const response = await fetch(`${this.gatewayUrl}/dig/${peer.peerId}/${storeId}/${filePath}`);
            if (response.ok) {
                return {
                    data: await response.arrayBuffer(),
                    mimeType: response.headers.get('Content-Type') || 'application/octet-stream'
                };
            }
        }
        catch (error) {
            console.warn('Peer download failed:', error);
        }
        return null;
    }
    isCacheValid(response) {
        const cacheControl = response.headers.get('Cache-Control');
        if (!cacheControl)
            return false;
        const maxAge = cacheControl.match(/max-age=(\d+)/);
        if (!maxAge)
            return true;
        const responseTime = new Date(response.headers.get('date') || Date.now()).getTime();
        const maxAgeSeconds = parseInt(maxAge[1]);
        return (Date.now() - responseTime) < (maxAgeSeconds * 1000);
    }
}
const digWorker = new DIGServiceWorker();
self.addEventListener('fetch', (event) => {
    event.respondWith(digWorker.handleFetch(event));
});
export {};
//# sourceMappingURL=dig-service-worker.js.map