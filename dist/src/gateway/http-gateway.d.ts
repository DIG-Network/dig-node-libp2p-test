import { DIGNode } from '../node/DIGNode';
export declare class DIGGateway {
    private port;
    private app;
    private digNode;
    constructor(port?: number);
    private setupRoutes;
    private parseURN;
    start(): Promise<void>;
    stop(): Promise<void>;
    getDigNode(): DIGNode;
}
