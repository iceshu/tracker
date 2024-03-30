import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import pkg from "./package.json" assert { type: "json" };
import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";

export default {
  input: "./src/index.ts",
  output: [
    {
      format: "cjs",
      file: pkg.main,
    },
    {
      format: "es",
      file: pkg.module,
      name: pkg.name,
    },
  ],
  plugins: [
    typescript({ outDir: "dist", declaration: true, declarationDir: "dist" }),
    json(),
    resolve(),
    commonjs(),
  ],
};
