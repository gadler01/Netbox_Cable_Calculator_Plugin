const path = require("path");
module.exports = {
  entry: "./src/index.jsx",
  output: {
    path: path.resolve(__dirname, "../netbox_cable_calc/static/netbox_cable_calc"),
    filename: "calculator.bundle.js",
    library: { type: "umd" },
  },
  resolve: { extensions: [".js", ".jsx"] },
  module: {
    rules: [{
      test: /\.(js|jsx)$/,
      exclude: /node_modules/,
      use: {
        loader: "babel-loader",
        options: {
          presets: [
            "@babel/preset-env",
            ["@babel/preset-react", { runtime: "automatic" }],
          ],
        },
      },
    }],
  },
};
