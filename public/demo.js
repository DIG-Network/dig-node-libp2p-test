// DIG Network Demo JavaScript

class DIGDemo {
    constructor() {
        this.gatewayUrl = 'http://localhost:8080';
        this.serviceWorkerReady = false;
        this.init();
    }

    async init() {
        await this.registerServiceWorker();
        this.setupEventListeners();
        this.checkGatewayStatus();
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/dig-service-worker.js');
                console.log('DIG Service Worker registered:', registration);
                
                await navigator.serviceWorker.ready;
                this.serviceWorkerReady = true;
                this.updateStatus('Service Worker ready', 'success');
            } catch (error) {
                console.error('Service Worker registration failed:', error);
                this.updateStatus('Service Worker failed to register', 'error');
            }
        } else {
            this.updateStatus('Service Worker not supported', 'warning');
        }
    }

    setupEventListeners() {
        // URN testing
        const testUrnBtn = document.getElementById('testUrn');
        if (testUrnBtn) {
            testUrnBtn.addEventListener('click', () => this.testUrn());
        }

        // Store listing
        const listStoresBtn = document.getElementById('listStores');
        if (listStoresBtn) {
            listStoresBtn.addEventListener('click', () => this.listStores());
        }

        // Gateway health
        const healthCheckBtn = document.getElementById('healthCheck');
        if (healthCheckBtn) {
            healthCheckBtn.addEventListener('click', () => this.checkGatewayStatus());
        }
    }

    async testUrn() {
        const urnInput = document.getElementById('urnInput');
        const resultDiv = document.getElementById('urnResult');
        
        if (!urnInput || !resultDiv) return;

        const urn = urnInput.value.trim();
        if (!urn) {
            this.showResult(resultDiv, 'Please enter a URN', 'error');
            return;
        }

        this.showResult(resultDiv, 'Testing URN...', 'info');

        try {
            const response = await fetch(urn, { method: 'HEAD' });
            
            if (response.ok) {
                const contentType = response.headers.get('Content-Type') || 'Unknown';
                const contentLength = response.headers.get('Content-Length') || 'Unknown';
                
                this.showResult(resultDiv, 
                    `✅ URN resolved successfully!<br>
                     Content-Type: ${contentType}<br>
                     Content-Length: ${contentLength} bytes`, 'success');
            } else {
                this.showResult(resultDiv, 
                    `❌ URN resolution failed<br>Status: ${response.status} ${response.statusText}`, 'error');
            }
        } catch (error) {
            this.showResult(resultDiv, `❌ Error: ${error.message}`, 'error');
        }
    }

    async listStores() {
        const resultDiv = document.getElementById('storesResult');
        if (!resultDiv) return;

        this.showResult(resultDiv, 'Fetching stores...', 'info');

        try {
            const response = await fetch(`${this.gatewayUrl}/stores`);
            
            if (response.ok) {
                const data = await response.json();
                const stores = data.stores || [];
                
                if (stores.length > 0) {
                    const storeList = stores.map(store => `<li>${store}</li>`).join('');
                    this.showResult(resultDiv, 
                        `✅ Found ${stores.length} stores:<ul>${storeList}</ul>`, 'success');
                } else {
                    this.showResult(resultDiv, 'No stores available', 'warning');
                }
            } else {
                this.showResult(resultDiv, `❌ Failed to fetch stores: ${response.status}`, 'error');
            }
        } catch (error) {
            this.showResult(resultDiv, `❌ Gateway not accessible: ${error.message}`, 'error');
        }
    }

    async checkGatewayStatus() {
        const statusDiv = document.getElementById('gatewayStatus');
        if (!statusDiv) return;

        this.showResult(statusDiv, 'Checking gateway...', 'info');

        try {
            const response = await fetch(`${this.gatewayUrl}/health`);
            
            if (response.ok) {
                const data = await response.json();
                this.showResult(statusDiv, 
                    `✅ Gateway online<br>
                     Peer ID: ${data.peerId || 'Unknown'}<br>
                     Stores: ${data.stores}<br>
                     IPv6: ${data.cryptoIPv6 || 'Unknown'}`, 'success');
            } else {
                this.showResult(statusDiv, `❌ Gateway error: ${response.status}`, 'error');
            }
        } catch (error) {
            this.showResult(statusDiv, `❌ Gateway offline: ${error.message}`, 'error');
        }
    }

    showResult(element, message, type) {
        element.innerHTML = message;
        element.className = `result ${type}`;
    }

    updateStatus(message, type) {
        console.log(`Status (${type}):`, message);
    }

    // Utility methods
    static createUrn(storeId, filePath = '', rootHash = '') {
        if (!/^[a-fA-F0-9]+$/.test(storeId) || storeId.length < 32) {
            throw new Error('Invalid store ID format');
        }

        let urn = `urn:dig:chia:${storeId}`;
        
        if (rootHash) {
            if (!/^[a-fA-F0-9]+$/.test(rootHash) || rootHash.length < 32) {
                throw new Error('Invalid root hash format');
            }
            urn += `:${rootHash}`;
        }
        
        if (filePath) {
            urn += `/${filePath}`;
        }
        
        return urn;
    }

    static createDigUrl(storeId, filePath = '') {
        return filePath ? `dig://${storeId}/${filePath}` : `dig://${storeId}/`;
    }

    static isValidUrn(urn) {
        return urn.toLowerCase().startsWith('urn:dig:chia:') && 
               urn.length > 14 && 
               /^urn:dig:chia:[a-fA-F0-9]{32,}/.test(urn);
    }

    static extractStoreId(identifier) {
        if (identifier.toLowerCase().startsWith('urn:dig:chia:')) {
            const nss = identifier.substring(14);
            const slashIndex = nss.indexOf('/');
            const storePart = slashIndex !== -1 ? nss.substring(0, slashIndex) : nss;
            const colonIndex = storePart.indexOf(':');
            return colonIndex !== -1 ? storePart.substring(0, colonIndex) : storePart;
        }
        
        if (identifier.startsWith('dig://')) {
            try {
                const url = new URL(identifier);
                return url.hostname;
            } catch (error) {
                return null;
            }
        }
        
        return null;
    }
}

// Initialize demo when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.digDemo = new DIGDemo();
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DIGDemo;
}
