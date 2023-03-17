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
  };
}

export default [
  build(
    "lib/index.js",
    "lib/bundle.cjs",
    "cjs"
  ),
  build(
    "lib/tests/main.js",
    "lib/tests/bundle.js",
    "esm"
  ),
  build(
    "lib/tests/main.js",
    "lib/tests/bundle.cjs",
    "cjs"
  ),
];
