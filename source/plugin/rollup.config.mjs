// rollup.config.mjs - bundles src/index.tsx into dist/index.js for Decky.
// Matches the shape of the shipping bundle: single-file ESM, external
// @decky/ui + @decky/api + react (they're provided by the Decky loader).

import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import json from "@rollup/plugin-json";

import { deckyPlugin } from "@decky/rollup";

export default deckyPlugin({
  input: "src/index.tsx",
  plugins: [
    replace({
      preventAssignment: true,
      "process.env.NODE_ENV": JSON.stringify("production"),
    }),
    json(),
    nodeResolve({ browser: true }),
    commonjs(),
    typescript(),
  ],
  output: {
    file: "dist/index.js",
    format: "esm",
    sourcemap: false,
  },
});
