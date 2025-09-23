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
export interface DIGHandshake {
    networkId: string;
    protocolVersion: string;
    softwareVersion: string;
    serverPort: number;
    nodeType: number;
    capabilities: Array<[number, string]>;
    peerId: string;
    cryptoIPv6: string;
    publicKey: string;
    timestamp: number;
    stores: string[];
}
export declare enum NodeType {
    FULL_NODE = 0,// Full DIG node with all capabilities
    LIGHT_NODE = 1,// Light node (limited storage)
    BOOTSTRAP_NODE = 2,// Bootstrap/discovery server
    TURN_NODE = 3,// Dedicated TURN server
    RELAY_NODE = 4
}
export declare enum CapabilityCode {
    STORE_SYNC = 1,// Can sync .dig stores
    TURN_RELAY = 2,// Can act as TURN server
    BOOTSTRAP_DISCOVERY = 3,// Can provide peer discovery
    E2E_ENCRYPTION = 4,// Supports end-to-end encryption
    BYTE_RANGE_DOWNLOAD = 5,// Supports parallel byte-range downloads
    GOSSIP_DISCOVERY = 6,// Supports gossip-based peer discovery
    DHT_STORAGE = 7,// Supports DHT storage
    CIRCUIT_RELAY = 8,// Supports LibP2P circuit relay
    WEBRTC_NAT = 9,// Supports WebRTC NAT traversal
    MESH_ROUTING = 10
}
export interface DIGRequest {
    type: 'GET_FILE' | 'GET_URN' | 'GET_STORE_FILES' | 'GET_STORE_CONTENT' | 'GET_FILE_RANGE' | 'HANDSHAKE' | 'PEER_EXCHANGE' | 'PRIVACY_PEER_DISCOVERY' | 'QUERY_STORE_LOCATION' | 'DIG_NETWORK_IDENTIFICATION' | 'VERIFY_DIG_MEMBERSHIP' | 'GET_CONNECTION_CAPABILITIES';
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
    metadata?: any;
    anonymousQueries?: any[];
    challengeNonce?: string;
    requestedProof?: string[];
    networkId?: string;
    isDIGNode?: boolean;
    requestedInfo?: string[];
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
    networkId?: string;
    isDIGNode?: boolean;
    capabilities?: any;
    cryptoIPv6?: string;
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
