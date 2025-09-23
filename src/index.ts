// Main exports for DIG Network Node

export { DIGNode } from './node/DIGNode.js';
export { DIGGateway } from './gateway/http-gateway.js';
export { DIGNetworkClient } from './client/DIGClient.js';
export { E2EEncryption } from './node/E2EEncryption.js';

export * from './node/types.js';
export * from './node/utils.js';
export * from './client/utils.js';
export * from './client/hooks.js';

// Default export - Enhanced DIGNode with all functionality
export { DIGNode as default } from './node/DIGNode.js';
