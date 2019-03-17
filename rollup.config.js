import typescriptPlugin from 'rollup-plugin-typescript2';
import typescript from 'typescript';

const globals = {
  __proto__: null,
  tslib: "tslib",
  assert: "assert",
  crypto: "crypto"
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
    "src/tests/main.ts",
    "lib/tests/bundle.js",
    "cjs"
  )
];
