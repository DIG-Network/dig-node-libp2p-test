"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIGNode = void 0;
const libp2p_1 = require("libp2p");
const tcp_1 = require("@libp2p/tcp");
const libp2p_noise_1 = require("@chainsafe/libp2p-noise");
const libp2p_yamux_1 = require("@chainsafe/libp2p-yamux");
const kad_dht_1 = require("@libp2p/kad-dht");
const bootstrap_1 = require("@libp2p/bootstrap");
const mdns_1 = require("@libp2p/mdns");
const ping_1 = require("@libp2p/ping");
const it_pipe_1 = require("it-pipe");
const to_string_1 = require("uint8arrays/to-string");
const from_string_1 = require("uint8arrays/from-string");
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
const JSZip = __importStar(require("jszip"));
const types_1 = require("./types");
const utils_1 = require("./utils");
class DIGNode {
    constructor(config = {}) {
        this.config = config;
        this.digFiles = new Map();
        this.digPath = config.digPath || (0, path_1.join)((0, os_1.homedir)(), '.dig');
    }
    async start() {
        const publicKey = this.config.publicKey || (0, crypto_1.randomBytes)(32).toString('hex');
        this.cryptoIPv6 = (0, utils_1.generateCryptoIPv6)(publicKey);
        console.log(`DIG Node crypto IPv6: ${this.cryptoIPv6}`);
        this.node = await (0, libp2p_1.createLibp2p)({
            addresses: {
                listen: [`/ip4/0.0.0.0/tcp/${this.config.port || 0}`]
            },
            transports: [(0, tcp_1.tcp)()],
            connectionEncrypters: [(0, libp2p_noise_1.noise)()],
            streamMuxers: [(0, libp2p_yamux_1.yamux)()],
            peerDiscovery: [
                (0, bootstrap_1.bootstrap)({
                    list: this.config.bootstrapPeers || [
                        '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
                    ]
                }),
                (0, mdns_1.mdns)()
            ],
            services: {
                dht: (0, kad_dht_1.kadDHT)(),
                ping: (0, ping_1.ping)()
            }
        });
        await this.node.handle(types_1.DIG_PROTOCOL, this.handleDIGRequest.bind(this));
        await this.node.handle(types_1.DIG_DISCOVERY_PROTOCOL, this.handleDiscoveryRequest.bind(this));
        await this.scanDIGFiles();
        await this.announceStores();
        console.log(`DIG Node started`);
        console.log(`Peer ID: ${this.node.peerId.toString()}`);
        console.log(`Available stores: ${this.digFiles.size}`);
    }
    async stop() {
        await this.node.stop();
    }
    // Scan ~/.dig directory for .dig files
    async scanDIGFiles() {
        try {
            const files = await (0, promises_1.readdir)(this.digPath);
            for (const file of files) {
                if (file.endsWith('.dig')) {
                    await this.loadDIGFile((0, path_1.join)(this.digPath, file));
                }
            }
            console.log(`Loaded ${this.digFiles.size} .dig files`);
        }
        catch (error) {
            console.warn(`Could not scan DIG directory ${this.digPath}:`, error);
        }
    }
    async loadDIGFile(filePath) {
        try {
            const storeId = (0, path_1.basename)(filePath, '.dig');
            const fileContent = await (0, promises_1.readFile)(filePath);
            const zip = await JSZip.loadAsync(fileContent);
            let metadata = {
                name: storeId,
                size: fileContent.length,
                fileCount: Object.keys(zip.files).length,
                created: (await (0, promises_1.stat)(filePath)).birthtime.toISOString()
            };
            // Try to load metadata.json from zip
            if (zip.files['metadata.json']) {
                try {
                    const metadataContent = await zip.files['metadata.json'].async('text');
                    const zipMetadata = JSON.parse(metadataContent);
                    metadata = { ...metadata, ...zipMetadata };
                }
                catch (error) {
                    console.warn(`Could not parse metadata for ${storeId}:`, error);
                }
            }
            this.digFiles.set(storeId, {
                storeId,
                filePath,
                zip,
                metadata
            });
            console.log(`Loaded DIG file: ${storeId} (${metadata.fileCount} files, ${metadata.size} bytes)`);
        }
        catch (error) {
            console.error(`Failed to load .dig file ${filePath}:`, error);
        }
    }
    // Handle DIG protocol requests
    async handleDIGRequest({ stream }) {
        const self = this;
        try {
            await (0, it_pipe_1.pipe)(stream, async function* (source) {
                for await (const chunk of source) {
                    const request = JSON.parse((0, to_string_1.toString)(chunk.subarray()));
                    if (request.type === 'GET_FILE') {
                        const { storeId, filePath } = request;
                        if (storeId && filePath) {
                            yield* self.serveFileFromStore(storeId, filePath);
                        }
                    }
                    else if (request.type === 'GET_URN') {
                        const { urn } = request;
                        if (urn) {
                            yield* self.serveFileFromURN(urn);
                        }
                    }
                    else if (request.type === 'GET_STORE_FILES') {
                        const { storeId } = request;
                        if (storeId) {
                            const digFile = self.digFiles.get(storeId);
                            if (digFile) {
                                const fileList = Object.keys(digFile.zip.files).filter(path => !digFile.zip.files[path].dir);
                                const response = {
                                    success: true,
                                    storeId,
                                    files: fileList,
                                    metadata: digFile.metadata
                                };
                                yield (0, from_string_1.fromString)(JSON.stringify(response));
                            }
                            else {
                                const response = {
                                    success: false,
                                    error: 'Store not found'
                                };
                                yield (0, from_string_1.fromString)(JSON.stringify(response));
                            }
                        }
                    }
                    break;
                }
            }, stream);
        }
        catch (error) {
            console.error('Error handling DIG request:', error);
        }
    }
    // Serve file from URN
    async *serveFileFromURN(urn) {
        const parsed = (0, utils_1.parseURN)(urn);
        if (!parsed) {
            const response = {
                success: false,
                error: 'Invalid URN format. Expected: urn:dig:chia:{storeID}:{optional roothash}/{optional resource key}'
            };
            yield (0, from_string_1.fromString)(JSON.stringify(response));
            return;
        }
        const { storeId, filePath, rootHash } = parsed;
        if (!this.digFiles.has(storeId)) {
            const response = {
                success: false,
                error: `Store not found: ${storeId}`
            };
            yield (0, from_string_1.fromString)(JSON.stringify(response));
            return;
        }
        // TODO: Implement rootHash version checking
        if (rootHash) {
            console.warn(`Root hash versioning not yet implemented. Serving latest version of store ${storeId}`);
        }
        yield* this.serveFileFromStore(storeId, filePath);
    }
    // Serve file from store
    async *serveFileFromStore(storeId, filePath) {
        const digFile = this.digFiles.get(storeId);
        if (!digFile) {
            const response = {
                success: false,
                error: 'Store not found'
            };
            yield (0, from_string_1.fromString)(JSON.stringify(response));
            return;
        }
        const zipFile = digFile.zip.files[filePath];
        if (!zipFile || zipFile.dir) {
            const response = {
                success: false,
                error: 'File not found'
            };
            yield (0, from_string_1.fromString)(JSON.stringify(response));
            return;
        }
        try {
            const content = await zipFile.async('nodebuffer');
            const mimeType = (0, utils_1.guessMimeType)(filePath);
            // Send metadata first
            const response = {
                success: true,
                size: content.length,
                mimeType
            };
            yield (0, from_string_1.fromString)(JSON.stringify(response));
            // Send file content in chunks
            const CHUNK_SIZE = 64 * 1024;
            for (let i = 0; i < content.length; i += CHUNK_SIZE) {
                yield content.subarray(i, i + CHUNK_SIZE);
            }
        }
        catch (error) {
            const response = {
                success: false,
                error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
            yield (0, from_string_1.fromString)(JSON.stringify(response));
        }
    }
    async handleDiscoveryRequest({ stream }) {
        const self = this;
        try {
            await (0, it_pipe_1.pipe)(stream, async function* (source) {
                for await (const chunk of source) {
                    const request = JSON.parse((0, to_string_1.toString)(chunk.subarray()));
                    if (request.type === 'FIND_STORE') {
                        const { storeId } = request;
                        const response = {
                            success: true,
                            peerId: self.node.peerId.toString(),
                            cryptoIPv6: self.cryptoIPv6,
                            hasStore: self.digFiles.has(storeId)
                        };
                        yield (0, from_string_1.fromString)(JSON.stringify(response));
                    }
                    break;
                }
            }, stream);
        }
        catch (error) {
            console.error('Error handling discovery request:', error);
        }
    }
    async announceStores() {
        for (const storeId of this.digFiles.keys()) {
            await this.announceStore(storeId);
        }
    }
    async announceStore(storeId) {
        try {
            const key = (0, from_string_1.fromString)(`/dig-store/${storeId}`);
            const value = (0, from_string_1.fromString)(JSON.stringify({
                peerId: this.node.peerId.toString(),
                cryptoIPv6: this.cryptoIPv6,
                timestamp: Date.now()
            }));
            const dht = this.node.services.dht;
            if (dht && dht.put) {
                await dht.put(key, value);
            }
        }
        catch (error) {
            console.error(`Failed to announce store ${storeId}:`, error);
        }
    }
    // Public API methods
    getAvailableStores() {
        return Array.from(this.digFiles.keys());
    }
    hasStore(storeId) {
        return this.digFiles.has(storeId);
    }
    getCryptoIPv6() {
        return this.cryptoIPv6;
    }
    getNode() {
        return this.node;
    }
    async rescanDIGFiles() {
        this.digFiles.clear();
        await this.scanDIGFiles();
        await this.announceStores();
    }
    async findStorePeers(storeId) {
        try {
            const key = (0, from_string_1.fromString)(`/dig-store/${storeId}`);
            const peers = [];
            const dht = this.node.services.dht;
            if (dht && dht.get) {
                for await (const event of dht.get(key)) {
                    if (event.name === 'VALUE') {
                        try {
                            const peerInfo = JSON.parse((0, to_string_1.toString)(event.value));
                            peers.push(peerInfo);
                        }
                        catch (error) {
                            console.warn('Failed to parse peer info:', error);
                        }
                    }
                }
            }
            return peers;
        }
        catch (error) {
            console.error(`Failed to find peers for store ${storeId}:`, error);
            return [];
        }
    }
}
exports.DIGNode = DIGNode;
//# sourceMappingURL=DIGNode.js.map