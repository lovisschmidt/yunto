const { version } = require("./package.json");

const IS_DEV = process.env.APP_ENV === "development";

/** @param {{ config: import('@expo/config-types').ExpoConfig }} ctx */
module.exports = ({ config }) => ({
  ...config,
  version,
  android: {
    ...config.android,
    package: IS_DEV ? "com.yunto.app.debug" : "com.yunto.app",
  },
});
