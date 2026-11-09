export = Unpacker;
declare class Unpacker {
    constructor(options?: {
        decompression?: "zlib" | "decompressionstream" | ((data: Uint8Array) => Uint8Array | Promise<Uint8Array>);
        cacheKeys?: boolean;
        cacheAtoms?: boolean;
        decoding?: {
            nil?: "null" | "array";
            string?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
            stringKey?: "utf8" | "latin1";
            binary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
            binaryKey?: "utf8" | "latin1";
            bitbinary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
            list?: "array" | "string";
            safebigint?: "number" | "bigint" | "string";
            bigint?: "bigint" | "string";
        };
        browserStrictLatin1?: boolean;
        atomTable?: Record<string, any>;
    });
    private _decompressor;
    private _cacheKeys;
    private _cacheAtoms;
    private _nilDecoding;
    private _stringDecoding;
    private _stringKeyDecoding;
    private _binaryDecoding;
    private _binaryKeyDecoding;
    private _bitbinaryDecoding;
    private _safebigintDecoding;
    private _bigintDecoding;
    private _listDecoding;
    private _browserStrictLatin1;
    private _d;
    private _v;
    private _sd;
    private _sv;
    private _sb;
    private _b;
    private _i;
    private _end;
    private _T;
    private _TL;
    private _u;
    private _l;
    private _atoms;
    private _atomTableLatin;
    private _atomTableUtf;
    private _keyTableLatin;
    private _keyTableUtf;
    unpack(data: Uint8Array): any;
    private _loop;
    private _skip;
    private _key;
    private _lookup;
    private _charList;
    private _utf;
    private _latin;
    private _decompressorStreamOut;
}
declare namespace Unpacker {
    export { Unpacker };
    export { Unpacker as default };
}
