import typescriptPlugin from 'rollup-plugin-typescript2';
import typescript from 'typescript';

const globals = {
  __proto__: null,
  tslib: "tslib",
  assert: "assert",
  crypto: "crypto",
  "@wry/context": "wryContext",
  "@wry/trie": "wryTrie",
};

function external(id) {
  return id in globals;
}

function build(input, output, format) {
  return {
    input,
    external,
    output: {
      file: output,
      format,
      sourcemap: true,
      globals
    },
    plugins: [
      typescriptPlugin({
        typescript,
        tsconfig: "./tsconfig.rollup.json"
      })
    ]
  }
}

export default [
  build(
    "src/index.ts",
    "lib/bundle.esm.js",
    "esm"
  ),
  build(
    "src/index.ts",
    "lib/bundle.cjs.js",
    "cjs"
  ),
  build(
    "src/tests/main.ts",
    "lib/tests/bundle.esm.js",
    "esm"
  ),
  build(
    "src/tests/main.ts",
    "lib/tests/bundle.cjs.js",
    "cjs"
  ),
];
