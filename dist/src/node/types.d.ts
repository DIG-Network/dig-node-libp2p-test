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
    privacyMode?: boolean;
    enableCryptoIPv6Overlay?: boolean;
}
export interface NodeCapabilities {
    libp2p: boolean;
    dht: boolean;
    mdns: boolean;
    upnp: boolean;
    autonat: boolean;
    webrtc: boolean;
    websockets: boolean;
    circuitRelay: boolean;
    turnServer: boolean;
    bootstrapServer: boolean;
    storeSync: boolean;
    e2eEncryption: boolean;
    protocolVersion: string;
    environment: 'development' | 'production' | 'aws';
}
export interface DIGRequest {
    type: 'GET_FILE' | 'GET_URN' | 'GET_STORE_FILES' | 'GET_STORE_CONTENT' | 'GET_FILE_RANGE' | 'HANDSHAKE' | 'PEER_EXCHANGE' | 'PRIVACY_PEER_DISCOVERY';
    storeId?: string;
    filePath?: string;
    urn?: string;
    rangeStart?: number;
    rangeEnd?: number;
    chunkId?: string;
    protocolVersion?: string;
    supportedFeatures?: string[];
    publicKey?: string;
    encryptedPayload?: string;
    maxPeers?: number;
    includeStores?: boolean;
    includeCapabilities?: boolean;
    privacyMode?: boolean;
}
export interface DIGResponse {
    success: boolean;
    error?: string;
    size?: number;
    mimeType?: string;
    storeId?: string;
    files?: string[];
    metadata?: any;
    rangeStart?: number;
    rangeEnd?: number;
    totalSize?: number;
    chunkId?: string;
    isPartial?: boolean;
    protocolVersion?: string;
    supportedFeatures?: string[];
    publicKey?: string;
    encryptedPayload?: string;
    peers?: any[];
    totalPeers?: number;
    privacyMode?: boolean;
    timestamp?: number;
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
