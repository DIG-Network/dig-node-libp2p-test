// Removed JSZip import - serving .dig files as binary data
// DIG Network Protocol Constants
export const DIG_PROTOCOL = '/dig/1.0.0';
export const DIG_DISCOVERY_PROTOCOL = '/dig-discovery/1.0.0';
// Node type constants
export var NodeType;
(function (NodeType) {
    NodeType[NodeType["FULL_NODE"] = 0] = "FULL_NODE";
    NodeType[NodeType["LIGHT_NODE"] = 1] = "LIGHT_NODE";
    NodeType[NodeType["BOOTSTRAP_NODE"] = 2] = "BOOTSTRAP_NODE";
    NodeType[NodeType["TURN_NODE"] = 3] = "TURN_NODE";
    NodeType[NodeType["RELAY_NODE"] = 4] = "RELAY_NODE"; // Relay-only node
})(NodeType || (NodeType = {}));
// Capability codes (similar to Chia's capability system)
export var CapabilityCode;
(function (CapabilityCode) {
    CapabilityCode[CapabilityCode["STORE_SYNC"] = 1] = "STORE_SYNC";
    CapabilityCode[CapabilityCode["TURN_RELAY"] = 2] = "TURN_RELAY";
    CapabilityCode[CapabilityCode["BOOTSTRAP_DISCOVERY"] = 3] = "BOOTSTRAP_DISCOVERY";
    CapabilityCode[CapabilityCode["E2E_ENCRYPTION"] = 4] = "E2E_ENCRYPTION";
    CapabilityCode[CapabilityCode["BYTE_RANGE_DOWNLOAD"] = 5] = "BYTE_RANGE_DOWNLOAD";
    CapabilityCode[CapabilityCode["GOSSIP_DISCOVERY"] = 6] = "GOSSIP_DISCOVERY";
    CapabilityCode[CapabilityCode["DHT_STORAGE"] = 7] = "DHT_STORAGE";
    CapabilityCode[CapabilityCode["CIRCUIT_RELAY"] = 8] = "CIRCUIT_RELAY";
    CapabilityCode[CapabilityCode["WEBRTC_NAT"] = 9] = "WEBRTC_NAT";
    CapabilityCode[CapabilityCode["MESH_ROUTING"] = 10] = "MESH_ROUTING"; // Supports mesh routing
})(CapabilityCode || (CapabilityCode = {}));
//# sourceMappingURL=types.js.map