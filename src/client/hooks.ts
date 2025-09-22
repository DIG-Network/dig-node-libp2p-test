// React/Vue hooks for DIG Network integration

import { DIGNetworkClient } from './DIGClient';

// React hooks (if using React)
export function useDIGContent(identifier: string, client?: DIGNetworkClient) {
  // This would be a proper React hook implementation
  // For now, providing a basic structure
  
  const digClient = client || new DIGNetworkClient();
  
  return {
    download: () => digClient.downloadContent(identifier),
    test: () => digClient.testContent(identifier),
    getText: () => digClient.getContentAsText(identifier),
    getJSON: () => digClient.getContentAsJSON(identifier)
  };
}

export function useDIGStore(storeId: string, client?: DIGNetworkClient) {
  const digClient = client || new DIGNetworkClient();
  
  return {
    getFiles: () => digClient.getStoreFiles(storeId),
    getInfo: () => digClient.getStoreInfo(storeId),
    createURN: (filePath?: string, rootHash?: string) => 
      digClient.createURN(storeId, filePath, rootHash),
    createURL: (filePath?: string) => 
      digClient.createDIGURL(storeId, filePath)
  };
}

// Vue composables (if using Vue)
export function useDigContent(identifier: string, client?: DIGNetworkClient) {
  const digClient = client || new DIGNetworkClient();
  
  return {
    downloadContent: () => digClient.downloadContent(identifier),
    testContent: () => digClient.testContent(identifier),
    getContentAsText: () => digClient.getContentAsText(identifier),
    getContentAsJSON: () => digClient.getContentAsJSON(identifier)
  };
}

export function useDigStore(storeId: string, client?: DIGNetworkClient) {
  const digClient = client || new DIGNetworkClient();
  
  return {
    getStoreFiles: () => digClient.getStoreFiles(storeId),
    getStoreInfo: () => digClient.getStoreInfo(storeId),
    createURN: (filePath?: string, rootHash?: string) => 
      digClient.createURN(storeId, filePath, rootHash),
    createDIGURL: (filePath?: string) => 
      digClient.createDIGURL(storeId, filePath)
  };
}
