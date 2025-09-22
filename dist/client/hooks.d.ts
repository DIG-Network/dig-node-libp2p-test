import { DIGNetworkClient } from './DIGClient';
export declare function useDIGContent(identifier: string, client?: DIGNetworkClient): {
    download: () => Promise<ArrayBuffer | null>;
    test: () => Promise<boolean>;
    getText: () => Promise<string | null>;
    getJSON: () => Promise<any>;
};
export declare function useDIGStore(storeId: string, client?: DIGNetworkClient): {
    getFiles: () => Promise<string[] | null>;
    getInfo: () => Promise<any>;
    createURN: (filePath?: string, rootHash?: string) => string;
    createURL: (filePath?: string) => string;
};
export declare function useDigContent(identifier: string, client?: DIGNetworkClient): {
    downloadContent: () => Promise<ArrayBuffer | null>;
    testContent: () => Promise<boolean>;
    getContentAsText: () => Promise<string | null>;
    getContentAsJSON: () => Promise<any>;
};
export declare function useDigStore(storeId: string, client?: DIGNetworkClient): {
    getStoreFiles: () => Promise<string[] | null>;
    getStoreInfo: () => Promise<any>;
    createURN: (filePath?: string, rootHash?: string) => string;
    createDIGURL: (filePath?: string) => string;
};
