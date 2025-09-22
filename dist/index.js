"use strict";
// Main exports for DIG Network Node
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = exports.DIGNetworkClient = exports.DIGGateway = exports.DIGNode = void 0;
var DIGNode_1 = require("./node/DIGNode");
Object.defineProperty(exports, "DIGNode", { enumerable: true, get: function () { return DIGNode_1.DIGNode; } });
var http_gateway_1 = require("./gateway/http-gateway");
Object.defineProperty(exports, "DIGGateway", { enumerable: true, get: function () { return http_gateway_1.DIGGateway; } });
var DIGClient_1 = require("./client/DIGClient");
Object.defineProperty(exports, "DIGNetworkClient", { enumerable: true, get: function () { return DIGClient_1.DIGNetworkClient; } });
__exportStar(require("./node/types"), exports);
__exportStar(require("./node/utils"), exports);
__exportStar(require("./client/utils"), exports);
__exportStar(require("./client/hooks"), exports);
// Default export
var DIGNode_2 = require("./node/DIGNode");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return DIGNode_2.DIGNode; } });
//# sourceMappingURL=index.js.map