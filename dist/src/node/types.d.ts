export declare const DIG_PROTOCOL = "/dig/1.0.0";
export declare const DIG_DISCOVERY_PROTOCOL = "/dig-discovery/1.0.0";
export interface DIGFile {
    storeId: string;
    filePath: string;
    content: Buffer;
    metadata: {
        name: string;
        size: number;
        created: string;
        mimeType: string;
    };
}
export interface DIGNodeConfig {
    digPath?: string;
    publicKey?: string;
    privateKey?: string;
    bootstrapPeers?: string[];
    port?: number;
    connectToPeers?: string[];
    enableMdns?: boolean;
    enableDht?: boolean;
    discoveryServers?: string[];
    enableGlobalDiscovery?: boolean;
    enableTurnServer?: boolean;
    turnPort?: number;
}
export interface DIGRequest {
    type: 'GET_FILE' | 'GET_URN' | 'GET_STORE_FILES' | 'GET_STORE_CONTENT';
    storeId?: string;
    filePath?: string;
    urn?: string;
}
export interface DIGResponse {
    success: boolean;
    error?: string;
    size?: number;
    mimeType?: string;
    storeId?: string;
    files?: string[];
    metadata?: any;
}
export interface DIGPeer {
    peerId: string;
    cryptoIPv6: string;
    latency?: number;
    successRate: number;
    lastUsed: number;
    failures: number;
}
export interface DiscoveryRequest {
    type: 'FIND_STORE' | 'LIST_STORES';
    storeId?: string;
}
export interface DiscoveryResponse {
    success: boolean;
    peerId: string;
    cryptoIPv6: string;
    hasStore: boolean;
}
export interface ParsedURN {
    storeId: string;
    filePath: string;
    rootHash?: string;
}
export interface FileContent {
    data: ArrayBuffer;
    mimeType: string;
    sourcePeer?: string;
}
