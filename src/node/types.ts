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
  port?: number;
  connectToPeers?: string[]; // Manual peer connections
  enableMdns?: boolean;
  enableDht?: boolean;
  discoveryServers?: string[]; // Custom bootstrap/discovery servers
  enableGlobalDiscovery?: boolean;
  enableTurnServer?: boolean; // Act as TURN server for other nodes
  turnPort?: number; // Port for TURN server functionality
  privacyMode?: boolean; // Only use crypto-IPv6 addresses, hide real IPs
  enableCryptoIPv6Overlay?: boolean; // Create IPv6 overlay network
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
