import { Logger } from './logger.js';
import { io, Socket } from 'socket.io-client';

export class WebSocketRelay {
  private logger = new Logger('WebSocketRelay');
  private socket: Socket | null = null;
  private relayConnections = new Map<string, any>();
  private messageHandlers = new Map<string, (data: any) => void>();
  private failureCount = 0;
  private maxFailures = 3;
  private backoffTime = 60000; // 1 minute
  private lastFailureTime = 0;

  constructor(
    private bootstrapServerUrl: string,
    private peerId: string
  ) {}

  async connect(): Promise<void> {
    // Check if we should back off due to repeated failures
    const now = Date.now();
    if (this.failureCount >= this.maxFailures && 
        now - this.lastFailureTime < this.backoffTime) {
      throw new Error(`WebSocket relay backing off (${this.failureCount} failures, retry in ${Math.ceil((this.backoffTime - (now - this.lastFailureTime)) / 1000)}s)`);
    }
    
    const wsUrl = this.bootstrapServerUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    
    this.socket = io(wsUrl, {
      transports: ['websocket'], // Match bootstrap server websocket-only config
      upgrade: true,
      rememberUpgrade: false
    });
    
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Failed to create socket'));
        return;
      }

      this.socket.on('connect', () => {
        this.logger.info(`🔗 Connected to relay server: ${wsUrl}`);
        
        // Reset failure count on successful connection
        this.failureCount = 0;
        this.lastFailureTime = 0;
        
        // Register this peer for relay
        this.socket!.emit('register-relay', { peerId: this.peerId });
        resolve();
      });

      this.socket.on('relay-registered', (data) => {
        if (data.success) {
          this.logger.info(`📡 Registered for relay: ${this.peerId}`);
        }
      });

      this.socket.on('relay-initiate', (data) => {
        const { targetPeerId } = data;
        this.logger.info(`🔄 Relay initiation request for: ${targetPeerId}`);
        
        // Notify the application about relay initiation
        const handler = this.messageHandlers.get('relay-initiate');
        if (handler) {
          handler({ targetPeerId });
        }
      });

      this.socket.on('relay-offer', (data) => {
        const { offer, fromPeerId } = data;
        this.logger.debug(`📨 Received relay offer from: ${fromPeerId}`);
        
        const handler = this.messageHandlers.get('relay-offer');
        if (handler) {
          handler({ offer, fromPeerId });
        }
      });

      this.socket.on('relay-answer', (data) => {
        const { answer, fromPeerId } = data;
        this.logger.debug(`📨 Received relay answer from: ${fromPeerId}`);
        
        const handler = this.messageHandlers.get('relay-answer');
        if (handler) {
          handler({ answer, fromPeerId });
        }
      });

      this.socket.on('relay-ice-candidate', (data) => {
        const { candidate, fromPeerId } = data;
        this.logger.debug(`🧊 Received ICE candidate from: ${fromPeerId}`);
        
        const handler = this.messageHandlers.get('relay-ice-candidate');
        if (handler) {
          handler({ candidate, fromPeerId });
        }
      });

      this.socket.on('relay-error', (data) => {
        this.logger.warn(`❌ Relay error: ${data.error}`);
      });

      this.socket.on('store-request', (data) => {
        const { requestId, storeId, fromPeerId } = data;
        this.logger.info(`📥 Store request received: ${storeId} from ${fromPeerId}`);
        
        const handler = this.messageHandlers.get('store-request');
        if (handler) {
          handler({ requestId, storeId, fromPeerId });
        }
      });

      this.socket.on('bootstrap-turn-request', (data) => {
        const { requestId, storeId, toPeerId, method, rangeStart, rangeEnd } = data;
        this.logger.info(`📡 Bootstrap TURN request received: ${storeId} for ${toPeerId} (method: ${method})`);
        
        const handler = this.messageHandlers.get('bootstrap-turn-request');
        if (handler) {
          handler({ requestId, storeId, toPeerId, method, rangeStart, rangeEnd });
        }
      });

      this.socket.on('turn-peer-exchange-request', (data) => {
        const { requestId, toPeerId, method, maxPeers, includeCapabilities } = data;
        this.logger.info(`📋 TURN peer exchange request received for ${toPeerId} (method: ${method})`);
        
        const handler = this.messageHandlers.get('turn-peer-exchange-request');
        if (handler) {
          handler({ requestId, toPeerId, method, maxPeers, includeCapabilities });
        }
      });

      this.socket.on('disconnect', () => {
        this.logger.warn('📡 Disconnected from relay server');
      });

      this.socket.on('connect_error', (error) => {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.logger.error('❌ Relay connection error:', error);
        reject(error);
      });

      // Timeout for connection
      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error('Relay connection timeout'));
        }
      }, 10000);
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.logger.info('📡 Disconnected from relay server');
    }
  }

  // Register message handler
  onMessage(event: string, handler: (data: any) => void): void {
    this.messageHandlers.set(event, handler);
  }

  // Send relay offer
  sendRelayOffer(targetPeerId: string, offer: any): void {
    if (this.socket?.connected) {
      this.socket.emit('relay-offer', {
        targetPeerId,
        offer,
        fromPeerId: this.peerId
      });
      this.logger.debug(`📤 Sent relay offer to: ${targetPeerId}`);
    }
  }

  // Send relay answer
  sendRelayAnswer(targetPeerId: string, answer: any): void {
    if (this.socket?.connected) {
      this.socket.emit('relay-answer', {
        targetPeerId,
        answer,
        fromPeerId: this.peerId
      });
      this.logger.debug(`📤 Sent relay answer to: ${targetPeerId}`);
    }
  }

  // Send ICE candidate
  sendIceCandidate(targetPeerId: string, candidate: any): void {
    if (this.socket?.connected) {
      this.socket.emit('relay-ice-candidate', {
        targetPeerId,
        candidate,
        fromPeerId: this.peerId
      });
      this.logger.debug(`📤 Sent ICE candidate to: ${targetPeerId}`);
    }
  }

  // Check if relay is connected
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // Send store response
  sendStoreResponse(requestId: string, storeContent: Buffer | null, error?: string): void {
    if (this.socket?.connected) {
      if (storeContent) {
        this.socket.emit('store-response', {
          requestId,
          success: true,
          content: storeContent.toString('base64')
        });
        this.logger.debug(`📤 Sent store response: ${storeContent.length} bytes`);
      } else {
        this.socket.emit('store-response', {
          requestId,
          success: false,
          error: error || 'Store not found'
        });
        this.logger.debug(`📤 Sent store error response: ${error}`);
      }
    }
  }

  // Send bootstrap TURN response with data
  sendBootstrapTurnResponse(requestId: string, success: boolean, storeData?: string, error?: string, size?: number): void {
    if (!this.socket?.connected) {
      this.logger.error('Cannot send bootstrap TURN response: not connected');
      return;
    }

    this.socket.emit('bootstrap-turn-response', {
      requestId,
      success,
      storeData,
      error,
      size
    });

    this.logger.debug(`📡 Bootstrap TURN response sent for request ${requestId}: ${success ? 'success' : 'failed'}`);
  }

  // Send TURN peer exchange response
  sendTurnPeerExchangeResponse(requestId: string, success: boolean, peers?: any[], error?: string): void {
    if (!this.socket?.connected) {
      this.logger.error('Cannot send TURN peer exchange response: not connected');
      return;
    }

    this.socket.emit('turn-peer-exchange-response', {
      requestId,
      success,
      peers,
      error
    });

    this.logger.debug(`📋 TURN peer exchange response sent for request ${requestId}: ${success ? 'success' : 'failed'}`);
  }

  // Get relay server URL
  getRelayUrl(): string {
    return this.bootstrapServerUrl;
  }
}
