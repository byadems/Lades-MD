const eslintPluginNode = require('eslint-plugin-node');

module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        Promise: "readonly",
        URL: "readonly",
        exports: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "error",
      "no-empty": "warn"
    },
    ignores: [
      "core/**",
      "plugins/utils/misc.js",
      "plugins/utils/yt.js",
      "plugins/utils/manglish.js",
      "node_modules/**"
    ]
  }
];