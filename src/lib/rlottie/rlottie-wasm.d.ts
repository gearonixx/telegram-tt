export type RLottieWasmModule = {
  HEAPU8: Uint8Array<ArrayBuffer>;
  cwrap: (ident: string, returnType: string, argTypes: string[]) => AnyFunction;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
};

type RLottieModuleOverrides = {
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
  onRuntimeInitialized?: NoneToVoidFunction;
};

declare function initRlottieModule(overrides?: RLottieModuleOverrides): Promise<RLottieWasmModule>;

export default initRlottieModule;
