const { getDefaultConfig } = require("expo/metro-config");
const { createOxcResolver } = require("react-native-oxc");

const config = getDefaultConfig(__dirname);

const oxcResolve = createOxcResolver();

// extensionAlias has no effect with a custom resolveRequest, so we strip
// the .js suffix from relative imports before handing off to oxc-resolver,
// letting its extension probing (.ts → .tsx → .js → .jsx) find the real file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const normalized =
    moduleName.startsWith(".") && moduleName.endsWith(".js") ? moduleName.slice(0, -3) : moduleName;
  return oxcResolve(context, normalized, platform);
};

module.exports = config;
