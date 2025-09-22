export declare class GlobalDiscovery {
    private peerId;
    private addresses;
    private cryptoIPv6;
    private getStores;
    private logger;
    private knownPeers;
    private discoveryServers;
    private registrationInterval;
    private discoveryInterval;
    constructor(peerId: string, addresses: string[], cryptoIPv6: string, getStores: () => string[], customBootstrapServers?: string[]);
    start(): Promise<void>;
    stop(): Promise<void>;
    private registerWithDiscoveryServers;
    private discoverPeers;
    private unregisterFromDiscoveryServers;
    getKnownPeerAddresses(): string[];
    getStats(): any;
    addDiscoveryServer(serverUrl: string): void;
    discoverViaDHT(dhtService: any): Promise<string[]>;
    announceToGlobalDHT(dhtService: any): Promise<void>;
}
