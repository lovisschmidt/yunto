const IS_DEV = process.env.APP_ENV === "development";

/** @param {{ config: import('@expo/config-types').ExpoConfig }} ctx */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    package: IS_DEV ? "com.yunto.app.debug" : "com.yunto.app",
  },
});
