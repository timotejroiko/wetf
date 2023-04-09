export = Packer;
declare class Packer {
    constructor(options?: {
        poolSize?: number | undefined;
        compression?: boolean | "zlib" | "compressionstream" | ((data: Uint8Array) => Uint8Array | Promise<Uint8Array>) | undefined;
        encoding?: {
            string?: "string" | "binary" | undefined;
            key?: "string" | "binary" | "atom" | undefined;
            safeInt?: "bigint" | "float" | undefined;
            safeBigInt?: "number" | "bigint" | undefined;
            null?: "atom" | "nil" | undefined;
            buffer?: "string" | "binary" | "bitbinary" | undefined;
            undefined?: "atom" | "null" | "ignore" | undefined;
            infinity?: "atom" | "null" | "ignore" | undefined;
            nan?: "atom" | "null" | "ignore" | undefined;
            array?: "list" | "improperlist" | "tuple" | undefined;
        } | undefined;
        useLegacyAtoms?: boolean | undefined;
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
