import deckyPlugin from "@decky/rollup";

// @decky/rollup supplies the Decky-specific externals and output shape:
// react / react-dom map to SP_REACT, the JSX runtime maps to SP_JSX, and
// @decky/ui and @decky/api are provided by the loader at runtime.
export default deckyPlugin({});
