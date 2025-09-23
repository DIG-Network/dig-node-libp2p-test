/**
 * Consolidated DIG Node Implementation
 *
 * Combines the best of both DIGNode.ts and CleanDIGNode.ts:
 * - Clean architecture from CleanDIGNode
 * - Full functionality from DIGNode
 * - Dual-role peer system (direct + TURN)
 * - Comprehensive NAT traversal
 * - Intelligent download orchestration
 */
import type { Libp2p } from 'libp2p';
import { DIGNodeConfig, NodeCapabilities } from './types.js';
export declare class DIGNode {
    private config;
    private node;
    private digFiles;
    private digPath;
    private cryptoIPv6;
    private watcher;
    private isStarted;
    private logger;
    private startTime;
    private peerDiscovery;
    private turnCoordination;
    private peerCapabilities;
    private natTraversal;
    private downloadOrchestrator;
    private webSocketRelay;
    private e2eEncryption;
    private zkPrivacy;
    private downloadManager;
    private nodeCapabilities;
    private metrics;
    constructor(config?: DIGNodeConfig);
    start(): Promise<void>;
    private initializeLibP2PWithNATTraversal;
    private initializeIntelligentSubsystems;
    private startCoreServices;
    private safeServiceInit;
    private handleDIGRequest;
    private handleDiscoveryRequest;
    private serveStore;
    private serveFileRange;
    private handleHandshake;
    private getConnectionCapabilitiesResponse;
    private startWebSocketRelay;
    private startPeerEventHandling;
    private startStoreSync;
    private syncStores;
    private ensureDigDirectory;
    private scanDIGFiles;
    private loadDIGFile;
    private announceStores;
    private announceStore;
    private startFileWatcher;
    private runFileWatcher;
    private saveDownloadedStore;
    private validateConfig;
    private detectEnvironment;
    private logStartupSummary;
    getNode(): Libp2p;
    getCryptoIPv6(): string;
    getAvailableStores(): string[];
    getCapabilities(): NodeCapabilities;
    isHealthy(): boolean;
    getStatus(): any;
    getMetrics(): any;
    getNetworkHealth(): any;
    downloadStore(storeId: string): Promise<boolean>;
    hasStore(storeId: string): boolean;
    findStorePeers(storeId: string): Promise<any[]>;
    connectToPeer(peerAddress: string): Promise<void>;
    getConnectionInfo(): any;
    discoverAllPeers(): Promise<void>;
    forceConnectToPeers(): Promise<void>;
    stop(): Promise<void>;
    private cleanup;
}
