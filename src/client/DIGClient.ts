export class DIGNetworkClient {
  private gatewayUrl: string;
  private serviceWorkerReady = false;

  constructor(gatewayUrl = 'http://localhost:8080') {
    this.gatewayUrl = gatewayUrl;
    this.initializeServiceWorker();
  }

  private async initializeServiceWorker(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/dig-service-worker.js');
        await navigator.serviceWorker.ready;
        this.serviceWorkerReady = true;
        console.log('DIG Service Worker registered successfully');
      } catch (error) {
        console.error('Service Worker failed:', error);
      }
    }
  }

  createDIGURL(storeId: string, filePath = ''): string {
    return filePath ? `dig://${storeId}/${filePath}` : `dig://${storeId}/`;
  }

  createURN(storeId: string, filePath?: string, rootHash?: string): string {
    if (!/^[a-fA-F0-9]+$/.test(storeId) || storeId.length < 32) {
      throw new Error('Invalid storeID format');
    }
    
    let urn = `urn:dig:chia:${storeId}`;
    
    if (rootHash) {
      if (!/^[a-fA-F0-9]+$/.test(rootHash) || rootHash.length < 32) {
        throw new Error('Invalid rootHash format');
      }
      urn += `:${rootHash}`;
    }
    
    if (filePath) {
      urn += `/${filePath}`;
    }
    
    return urn;
  }

  async testContent(identifier: string): Promise<boolean> {
    try {
      const response = await fetch(identifier, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async downloadContent(identifier: string): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(identifier);
      return response.ok ? await response.arrayBuffer() : null;
    } catch (error) {
      return null;
    }
  }

  async getContentAsText(identifier: string): Promise<string | null> {
    try {
      const response = await fetch(identifier);
      return response.ok ? await response.text() : null;
    } catch (error) {
      return null;
    }
  }

  async getContentAsJSON(identifier: string): Promise<any | null> {
    try {
      const response = await fetch(identifier);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async getStoreFiles(storeId: string): Promise<string[] | null> {
    try {
      const response = await fetch(`${this.gatewayUrl}/store/${storeId}/files`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.files || [];
    } catch (error) {
      return null;
    }
  }

  async getStoreInfo(storeId: string): Promise<any | null> {
    try {
      const response = await fetch(`${this.gatewayUrl}/store/${storeId}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  isServiceWorkerReady(): boolean {
    return this.serviceWorkerReady;
  }

  getGatewayUrl(): string {
    return this.gatewayUrl;
  }

  setGatewayUrl(url: string): void {
    this.gatewayUrl = url;
  }
}
