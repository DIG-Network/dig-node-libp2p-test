import express from 'express';
import cors from 'cors';
import { DIGNode } from '../node/DIGNode';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { pipe } from 'it-pipe';

export class DIGGateway {
  private app = express();
  private digNode = new DIGNode();

  constructor(private port = 8080) {
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      try {
        const health = this.digNode.getNetworkHealth()
        const metrics = this.digNode.getMetrics()
        
        res.json({ 
          status: health.isHealthy ? 'ok' : 'degraded',
          peerId: this.digNode.getNode()?.peerId?.toString(),
          stores: this.digNode.getAvailableStores().length,
          cryptoIPv6: this.digNode.getCryptoIPv6(),
          health,
          metrics,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // List all available stores
    this.app.get('/stores', (req, res) => {
      res.json({ 
        stores: this.digNode.getAvailableStores(),
        count: this.digNode.getAvailableStores().length
      });
    });

    // Get detailed metrics
    this.app.get('/metrics', (req, res) => {
      try {
        const status = this.digNode.getStatus()
        res.json({
          ...status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Get store information
    this.app.get('/store/:storeId', async (req, res) => {
      const { storeId } = req.params;
      
      if (this.digNode.hasStore(storeId)) {
        res.json({
          storeId,
          available: true,
          peerId: this.digNode.getNode()?.peerId?.toString(),
          cryptoIPv6: this.digNode.getCryptoIPv6()
        });
      } else {
        res.status(404).json({ 
          error: 'Store not found',
          storeId
        });
      }
    });

    // Get files in a store
    this.app.get('/store/:storeId/files', async (req, res) => {
      const { storeId } = req.params;
      
      try {
        if (!this.digNode.hasStore(storeId)) {
          res.status(404).json({ error: 'Store not found' });
          return;
        }

        // This would need to be implemented in DIGNode to get file list
        // For now, return a placeholder response
        res.json({
          storeId,
          files: [],
          message: 'File listing not yet implemented'
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to retrieve store files',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Proxy request to specific peer for a file
    this.app.get('/dig/:peerId/:storeId/*', async (req, res) => {
      const { peerId, storeId } = req.params;
      const filePath = req.path.split('/').slice(4).join('/');
      
      try {
        // For local node, serve directly if available
        if (this.digNode.hasStore(storeId)) {
          // Create a mock stream to get file content
          const chunks: Buffer[] = [];
          let isFirst = true;
          let metadata: any = null;

          // This is a simplified implementation
          // In a real implementation, you would stream the content properly
          const mockStream = {
            async *[Symbol.asyncIterator]() {
              // Mock the file serving logic
              yield uint8ArrayFromString(JSON.stringify({
                type: 'GET_FILE',
                storeId,
                filePath
              }));
            }
          };

          res.status(200).send('File content streaming not fully implemented in gateway');
        } else {
          res.status(404).json({ error: 'Store not found on this node' });
        }
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to retrieve content',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Discover peers for a store
    this.app.get('/discover/:storeId', async (req, res) => {
      const { storeId } = req.params;
      
      try {
        const peers = await this.digNode.findStorePeers(storeId);
        
        // Add local node if it has the store
        if (this.digNode.hasStore(storeId)) {
          peers.unshift({
            peerId: this.digNode.getNode()?.peerId?.toString(),
            cryptoIPv6: this.digNode.getCryptoIPv6(),
            local: true
          });
        }

        res.json({ 
          peers,
          storeId,
          count: peers.length
        });
      } catch (error) {
        res.json({ 
          peers: [],
          storeId,
          count: 0,
          error: error instanceof Error ? error.message : 'Discovery failed'
        });
      }
    });

    // Resolve URN endpoint
    this.app.get('/resolve', async (req, res) => {
      const { urn } = req.query;
      
      if (!urn || typeof urn !== 'string') {
        res.status(400).json({ error: 'URN parameter required' });
        return;
      }

      try {
        // Parse URN and check if we have the store locally
        const parsedURN = this.parseURN(urn);
        if (!parsedURN) {
          res.status(400).json({ error: 'Invalid URN format' });
          return;
        }

        const { storeId, filePath } = parsedURN;
        
        if (this.digNode.hasStore(storeId)) {
          res.json({
            success: true,
            storeId,
            filePath,
            available: true,
            source: 'local'
          });
        } else {
          // Try to find peers
          const peers = await this.digNode.findStorePeers(storeId);
          res.json({
            success: peers.length > 0,
            storeId,
            filePath,
            available: peers.length > 0,
            source: 'peers',
            peerCount: peers.length
          });
        }
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to resolve URN',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Serve URN content directly
    this.app.get('/content', async (req, res) => {
      const { urn } = req.query;
      
      if (!urn || typeof urn !== 'string') {
        res.status(400).json({ error: 'URN parameter required' });
        return;
      }

      try {
        const parsedURN = this.parseURN(urn);
        if (!parsedURN) {
          res.status(400).json({ error: 'Invalid URN format' });
          return;
        }

        const { storeId, filePath } = parsedURN;
        
        if (!this.digNode.hasStore(storeId)) {
          res.status(404).json({ error: 'Content not available' });
          return;
        }

        // This would stream the actual file content
        // For now, return a placeholder
        res.status(501).json({ 
          error: 'Content streaming not yet implemented',
          storeId,
          filePath
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to serve content',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  private parseURN(urn: string): { storeId: string; filePath: string; rootHash?: string } | null {
    if (!urn.toLowerCase().startsWith('urn:dig:chia:')) {
      return null;
    }

    try {
      const nss = urn.substring(14);
      
      const slashIndex = nss.indexOf('/');
      let storePart: string;
      let resourceKey = 'index.html';
      
      if (slashIndex !== -1) {
        storePart = nss.substring(0, slashIndex);
        resourceKey = nss.substring(slashIndex + 1);
      } else {
        storePart = nss;
      }
      
      const colonIndex = storePart.indexOf(':');
      let storeId: string;
      let rootHash: string | undefined;
      
      if (colonIndex !== -1) {
        storeId = storePart.substring(0, colonIndex);
        rootHash = storePart.substring(colonIndex + 1);
      } else {
        storeId = storePart;
      }
      
      if (!/^[a-fA-F0-9]+$/.test(storeId) || storeId.length < 32) {
        return null;
      }
      
      if (rootHash && (!/^[a-fA-F0-9]+$/.test(rootHash) || rootHash.length < 32)) {
        return null;
      }
      
      return { storeId, filePath: resourceKey, rootHash };
    } catch (error) {
      return null;
    }
  }

  async start(): Promise<void> {
    await this.digNode.start();
    
    this.app.listen(this.port, () => {
      console.log(`DIG Gateway running on port ${this.port}`);
      console.log(`Health check: http://localhost:${this.port}/health`);
      console.log(`Available stores: http://localhost:${this.port}/stores`);
    });
  }

  async stop(): Promise<void> {
    await this.digNode.stop();
  }

  getDigNode(): DIGNode {
    return this.digNode;
  }
}
