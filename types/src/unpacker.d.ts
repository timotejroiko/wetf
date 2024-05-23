export = Unpacker;
declare class Unpacker {
    constructor(options?: {
        decompression?: "zlib" | "decompressionstream" | ((data: Uint8Array | Buffer) => Uint8Array | Buffer | Promise<Uint8Array> | Promise<Buffer>);
        decoding?: {
            nil?: "null" | "array";
            string?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
            binary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
            bitbinary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
            safebigint?: "number" | "bigint" | "string";
            bigint?: "bigint" | "string";
        };
        atomTable?: Record<string, any>;
        atomRegistration?: boolean;
    });
    private _decompressor;
    private _nilDecoding;
    private _stringDecoding;
    private _binaryDecoding;
    private _bitbinaryDecoding;
    private _safebigintDecoding;
    private _bigintDecoding;
    private _atomRegistration;
    private _d;
    private _v;
    private _sd;
    private _sv;
    private _i;
    private _u;
    private _l;
    private _T;
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
