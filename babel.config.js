// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // ...any other plugins you use...
    'react-native-worklets-core/plugin',
    // 'react-native-worklets/plugin', // 🔚 MUST be last
    'react-native-reanimated/plugin',
  ],
};
