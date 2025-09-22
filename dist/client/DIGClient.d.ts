export declare class DIGNetworkClient {
    private gatewayUrl;
    private serviceWorkerReady;
    constructor(gatewayUrl?: string);
    private initializeServiceWorker;
    createDIGURL(storeId: string, filePath?: string): string;
    createURN(storeId: string, filePath?: string, rootHash?: string): string;
    testContent(identifier: string): Promise<boolean>;
    downloadContent(identifier: string): Promise<ArrayBuffer | null>;
    getContentAsText(identifier: string): Promise<string | null>;
    getContentAsJSON(identifier: string): Promise<any | null>;
    getStoreFiles(storeId: string): Promise<string[] | null>;
    getStoreInfo(storeId: string): Promise<any | null>;
    isServiceWorkerReady(): boolean;
    getGatewayUrl(): string;
    setGatewayUrl(url: string): void;
}
