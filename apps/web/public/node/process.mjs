const proc = {
  env: {},
  cwd: () => '/',
  argv: [],
  versions: {},
  browser: true
};
if (!globalThis.process) {
  globalThis.process = proc;
}
export default globalThis.process;
export const env = globalThis.process.env;
