import type { Stream } from '@libp2p/interface'
import type { Libp2p } from 'libp2p'
// Removed JSZip import - serving .dig files as binary data

// DIG Network Protocol Constants
export const DIG_PROTOCOL = '/dig/1.0.0'
export const DIG_DISCOVERY_PROTOCOL = '/dig-discovery/1.0.0'

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
  port?: number; // LibP2P main port (default: 8082)
  httpPort?: number; // HTTP download port (default: 8080)
  wsPort?: number; // WebSocket port (default: 8081)
  turnPort?: number; // TURN server port (default: 3478)
  connectToPeers?: string[]; // Manual peer connections
  enableMdns?: boolean;
  enableDht?: boolean;
  discoveryServers?: string[]; // Custom bootstrap/discovery servers
  enableGlobalDiscovery?: boolean;
  enableTurnServer?: boolean; // Act as TURN server for other nodes
  // 🔐 ALL PRIVACY FEATURES ARE MANDATORY (graceful degradation only if unsupported)
  // No configuration options to disable privacy - it's always enabled
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

// Enhanced handshake information (similar to Chia network protocol)
export interface DIGHandshake {
  networkId: string;                    // Network id: mainnet, testnet, devnet
  protocolVersion: string;              // Protocol version for message compatibility
  softwareVersion: string;              // Software version for feature support
  serverPort: number;                   // Port the server is listening on
  nodeType: number;                     // Node type: 0=full, 1=light, 2=bootstrap, 3=turn
  capabilities: Array<[number, string]>; // Capability codes with descriptions
  peerId: string;                       // LibP2P peer ID
  cryptoIPv6: string;                   // Crypto-derived IPv6 address
  publicKey: string;                    // Public key for encryption
  timestamp: number;                    // Handshake timestamp
  stores: string[];                     // Available stores
}

// Node type constants
export enum NodeType {
  FULL_NODE = 0,      // Full DIG node with all capabilities
  LIGHT_NODE = 1,     // Light node (limited storage)
  BOOTSTRAP_NODE = 2, // Bootstrap/discovery server
  TURN_NODE = 3,      // Dedicated TURN server
  RELAY_NODE = 4      // Relay-only node
}

// Capability codes (similar to Chia's capability system)
export enum CapabilityCode {
  STORE_SYNC = 1,           // Can sync .dig stores
  TURN_RELAY = 2,           // Can act as TURN server
  BOOTSTRAP_DISCOVERY = 3,  // Can provide peer discovery
  E2E_ENCRYPTION = 4,       // Supports end-to-end encryption
  BYTE_RANGE_DOWNLOAD = 5,  // Supports parallel byte-range downloads
  GOSSIP_DISCOVERY = 6,     // Supports gossip-based peer discovery
  DHT_STORAGE = 7,          // Supports DHT storage
  CIRCUIT_RELAY = 8,        // Supports LibP2P circuit relay
  WEBRTC_NAT = 9,           // Supports WebRTC NAT traversal
  MESH_ROUTING = 10         // Supports mesh routing
}

export interface DIGRequest {
  type: 'GET_FILE' | 'GET_URN' | 'GET_STORE_FILES' | 'GET_STORE_CONTENT' | 'GET_FILE_RANGE' | 'HANDSHAKE' | 'PEER_EXCHANGE' | 'PRIVACY_PEER_DISCOVERY' | 'QUERY_STORE_LOCATION' | 'DIG_NETWORK_IDENTIFICATION' | 'VERIFY_DIG_MEMBERSHIP' | 'GET_CONNECTION_CAPABILITIES' | 'GET_PEER_INFO' | 'TURN_COORDINATION_REQUEST' | 'TURN_RELAY_DATA' | 'TURN_CONNECTION_SIGNAL';
  storeId?: string;
  filePath?: string;
  urn?: string;
  // Byte range support for parallel downloads
  rangeStart?: number;
  rangeEnd?: number;
  chunkId?: string; // Unique identifier for this chunk request
  // Protocol negotiation
  protocolVersion?: string;
  supportedFeatures?: string[];
  publicKey?: string; // For end-to-end encryption
  encryptedPayload?: string; // Encrypted request data
  // Peer exchange protocol
  maxPeers?: number;
  includeStores?: boolean;
  includeCapabilities?: boolean;
  privacyMode?: boolean;
  // Zero-knowledge privacy fields
  metadata?: any;
  anonymousQueries?: any[];
  // Security verification fields
  challengeNonce?: string;
  requestedProof?: string[];
  networkId?: string;
  isDIGNode?: boolean;
  requestedInfo?: string[];
  // TURN coordination fields
  fromPeerId?: string;
  targetPeerId?: string;
  sessionId?: string;
  timestamp?: number;
  turnServerPeerId?: string;
  turnServerAddresses?: string[];
  websocketEstablished?: boolean;
}

export interface DIGResponse {
  success: boolean;
  error?: string;
  size?: number;
  mimeType?: string;
  storeId?: string;
  files?: string[];
  metadata?: any;
  // Byte range support
  rangeStart?: number;
  rangeEnd?: number;
  totalSize?: number;
  chunkId?: string;
  isPartial?: boolean;
  // Protocol negotiation response
  protocolVersion?: string;
  supportedFeatures?: string[];
  publicKey?: string; // For end-to-end encryption
  encryptedPayload?: string; // Encrypted response data
  // Peer exchange response
  peers?: any[];
  totalPeers?: number;
  privacyMode?: boolean;
  timestamp?: number;
  // Security verification response
  networkId?: string;
  isDIGNode?: boolean;
  capabilities?: any;
  cryptoIPv6?: string;
  stores?: string[];
  nodeType?: string;
  // TURN coordination response fields
  sessionId?: string;
  turnServerPeerId?: string;
  externalAddress?: string;
  relayPort?: number;
  data?: string;
  message?: string;
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
