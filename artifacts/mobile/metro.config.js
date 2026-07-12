const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Prevent Metro from crashing while watching openid-client's temp cache dir
// (used by the sibling api-server artifact's auth flow).
config.resolver.blockList = [/\.cache\/openid-client\/.*/];

module.exports = config;
