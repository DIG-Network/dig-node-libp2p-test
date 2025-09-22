"use strict";
// React/Vue hooks for DIG Network integration
Object.defineProperty(exports, "__esModule", { value: true });
exports.useDIGContent = useDIGContent;
exports.useDIGStore = useDIGStore;
exports.useDigContent = useDigContent;
exports.useDigStore = useDigStore;
const DIGClient_1 = require("./DIGClient");
// React hooks (if using React)
function useDIGContent(identifier, client) {
    // This would be a proper React hook implementation
    // For now, providing a basic structure
    const digClient = client || new DIGClient_1.DIGNetworkClient();
    return {
        download: () => digClient.downloadContent(identifier),
        test: () => digClient.testContent(identifier),
        getText: () => digClient.getContentAsText(identifier),
        getJSON: () => digClient.getContentAsJSON(identifier)
    };
}
function useDIGStore(storeId, client) {
    const digClient = client || new DIGClient_1.DIGNetworkClient();
    return {
        getFiles: () => digClient.getStoreFiles(storeId),
        getInfo: () => digClient.getStoreInfo(storeId),
        createURN: (filePath, rootHash) => digClient.createURN(storeId, filePath, rootHash),
        createURL: (filePath) => digClient.createDIGURL(storeId, filePath)
    };
}
// Vue composables (if using Vue)
function useDigContent(identifier, client) {
    const digClient = client || new DIGClient_1.DIGNetworkClient();
    return {
        downloadContent: () => digClient.downloadContent(identifier),
        testContent: () => digClient.testContent(identifier),
        getContentAsText: () => digClient.getContentAsText(identifier),
        getContentAsJSON: () => digClient.getContentAsJSON(identifier)
    };
}
function useDigStore(storeId, client) {
    const digClient = client || new DIGClient_1.DIGNetworkClient();
    return {
        getStoreFiles: () => digClient.getStoreFiles(storeId),
        getStoreInfo: () => digClient.getStoreInfo(storeId),
        createURN: (filePath, rootHash) => digClient.createURN(storeId, filePath, rootHash),
        createDIGURL: (filePath) => digClient.createDIGURL(storeId, filePath)
    };
}
//# sourceMappingURL=hooks.js.map