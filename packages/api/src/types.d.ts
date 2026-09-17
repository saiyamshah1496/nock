declare module "picomatch" {
  interface Options {
    dot?: boolean;
    nocase?: boolean;
    [key: string]: any;
  }
  function picomatch(globs: string | string[], options?: Options): (path: string) => boolean;
  export = picomatch;
  export default picomatch;
}

