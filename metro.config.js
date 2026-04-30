const { getDefaultConfig } = require("expo/metro-config");
const { createOxcResolver } = require("react-native-oxc");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = createOxcResolver();

module.exports = config;
