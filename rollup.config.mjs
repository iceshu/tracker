import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import pkg from "./package.json" assert { type: "json" };
import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";
import { uglify } from "rollup-plugin-uglify";
import { terser } from "rollup-plugin-terser";
const name = "__TC_TRACKER__";
const isProduction = process.env.NODE_ENV === "production";

const plugins = [
  typescript({ outDir: "dist", declaration: true, declarationDir: "dist" }),
  json(),
  resolve(),
  commonjs(),
  isProduction && uglify(),
  isProduction && terser(),
].filter(Boolean);

export default {
  input: "./src/index.ts",
  output: [
    {
      format: "cjs",
      file: pkg.main,
      exports: "named",
    },
    {
      format: "umd",
      file: pkg.umd,
      name,
      exports: "named",
    },
    {
      format: "es",
      file: pkg.module,
      name: pkg.name,
      exports: "named",
    },
  ],
  plugins: plugins,
};
console.log("111111111", process.env.NODE_ENV);
