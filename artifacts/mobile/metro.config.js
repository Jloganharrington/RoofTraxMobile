const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Prevent Metro from crashing while watching openid-client's temp cache dir
// (used by the sibling api-server artifact's auth flow).
config.resolver.blockList = [
  // openid-client temp cache (api-server only)
  /\.cache\/openid-client\/.*/,
  // Anthropic SDK pnpm-install temp dirs that get cleaned up before Metro watches
  /_tmp_\d+\//,
];

module.exports = config;
