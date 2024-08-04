export = Packer;
declare class Packer {
    constructor(options?: {
        poolSize?: number;
        compression?: boolean | "zlib" | "compressionstream" | ((data: Uint8Array) => Uint8Array | Promise<Uint8Array>);
        encoding?: {
            string?: "binary" | "string";
            key?: "binary" | "string" | "atom";
            safeInt?: "bigint" | "float";
            safeBigInt?: "number" | "bigint";
            null?: "atom" | "nil";
            buffer?: "binary" | "bitbinary" | "string";
            undefined?: "atom" | "null" | "ignore";
            infinity?: "atom" | "null" | "ignore";
            nan?: "atom" | "null" | "ignore";
            array?: "list" | "improperlist" | "tuple";
        };
        useLegacyAtoms?: boolean;
    });
    private _compressor;
    private _stringEncoding;
    private _keyEncoding;
    private _safeIntEncoding;
    private _safeBigIntEncoding;
    private _nullEncoding;
    private _bufferEncoding;
    private _undefinedEncoding;
    private _infinityEncoding;
    private _nanEncoding;
    private _arrayEncoding;
    private _useLegacyAtoms;
    private _poolSize;
    private _u;
    private _v;
    private _i;
    private _o;
    private _r;
    private _b;
    private _e;
    private _T;
    private _z;
    pack(data: any): Uint8Array | Promise<Uint8Array>;
    private _loop;
    private _notIgnoreOrNull;
    private _expand;
    private _utf;
    private _compressorOut;
    private _compressorStreamOut;
}
declare namespace Packer {
    export { Packer };
    export { Packer as default };
}
