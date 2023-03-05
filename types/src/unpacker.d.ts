export = Unpacker;
declare class Unpacker {
    constructor(options?: {
        decompression?: "zlib" | "decompressionstream" | ((data: Uint8Array | Buffer) => Uint8Array | Buffer | Promise<Uint8Array> | Promise<Buffer>) | undefined;
        decoding?: {
            nil?: "null" | "array" | undefined;
            string?: "buffer" | "utf8" | "latin1" | "array" | "uint8array" | undefined;
            binary?: "buffer" | "utf8" | "latin1" | "array" | "uint8array" | undefined;
            bitbinary?: "buffer" | "utf8" | "latin1" | "array" | "uint8array" | undefined;
            safebigint?: "string" | "number" | "bigint" | undefined;
            bigint?: "string" | "bigint" | undefined;
        } | undefined;
        atomTable?: Record<string, any> | undefined;
        atomRegistration?: boolean | undefined;
    });
    private _decompressor;
    private _nilDecoding;
    private _stringDecoding;
    private _binaryDecoding;
    private _bitbinaryDecoding;
    private _safebigintDecoding;
    private _bigintDecoding;
    private _atomRegistration;
    private _u;
    private _l;
    private _T;
    private _d;
    private _v;
    private _sd;
    private _sv;
    private _i;
    private _atoms;
    private _atomTableLatin;
    private _atomTableUtf;
    unpack(data: Buffer | Uint8Array): any;
    private _loop;
    private _resolveAtom;
    private _registerAtom;
    private _utf;
    private _latin;
    private _decompressorStreamOut;
}
