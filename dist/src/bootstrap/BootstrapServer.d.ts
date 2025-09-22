export declare class BootstrapServer {
    private port;
    private app;
    private server;
    private io;
    private logger;
    private peers;
    private cleanupInterval;
    private readonly PEER_TIMEOUT;
    private readonly MAX_PEERS;
    private relayConnections;
    private turnServers;
    constructor(port?: number);
    private setupRoutes;
    private groupBy;
    private calculateStoreDistribution;
    private startCleanupTask;
    private setupRelayServer;
    start(): Promise<void>;
    private shutdown;
    getStats(): any;
}
