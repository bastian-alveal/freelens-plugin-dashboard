const path = require("path");

const sharedResolve = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
};

const mainConfig = {
  name: "main",
  mode: process.env.NODE_ENV === "development" ? "development" : "production",
  target: "electron-main",
  entry: "./src/main/index.ts",
  output: {
    path: path.resolve(__dirname, "out/main"),
    filename: "index.js",
    library: {
      type: "commonjs",
    },
  },
  resolve: sharedResolve,
  externals: {
    "@freelensapp/extensions": "global LensExtensions",
    electron: "commonjs electron",
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
            },
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};

const rendererConfig = {
  name: "renderer",
  mode: process.env.NODE_ENV === "development" ? "development" : "production",
  target: "electron-renderer",
  entry: "./src/renderer/index.tsx",
  output: {
    path: path.resolve(__dirname, "out/renderer"),
    filename: "index.js",
    library: {
      type: "commonjs",
    },
  },
  resolve: sharedResolve,
  externals: {
    "@freelensapp/extensions": "global LensExtensions",
    react: "global React",
    "react-dom": "global ReactDom",
    mobx: "global Mobx",
    "mobx-react": "global MobxReact",
    electron: "commonjs electron",
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};

module.exports = [mainConfig, rendererConfig];
