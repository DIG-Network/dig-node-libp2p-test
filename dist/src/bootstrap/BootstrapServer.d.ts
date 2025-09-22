export declare class BootstrapServer {
    private port;
    private app;
    private logger;
    private peers;
    private cleanupInterval;
    private readonly PEER_TIMEOUT;
    private readonly MAX_PEERS;
    constructor(port?: number);
    private setupRoutes;
    private groupBy;
    private calculateStoreDistribution;
    private startCleanupTask;
    start(): Promise<void>;
    private shutdown;
    getStats(): any;
}
