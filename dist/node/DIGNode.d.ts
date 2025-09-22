import type { Libp2p } from 'libp2p';
import { DIGNodeConfig } from './types';
export declare class DIGNode {
    private config;
    private node;
    private digFiles;
    private digPath;
    private cryptoIPv6;
    constructor(config?: DIGNodeConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    private scanDIGFiles;
    private loadDIGFile;
    private handleDIGRequest;
    private serveFileFromURN;
    private serveFileFromStore;
    private handleDiscoveryRequest;
    private announceStores;
    private announceStore;
    getAvailableStores(): string[];
    hasStore(storeId: string): boolean;
    getCryptoIPv6(): string;
    getNode(): Libp2p;
    rescanDIGFiles(): Promise<void>;
    findStorePeers(storeId: string): Promise<any[]>;
}
