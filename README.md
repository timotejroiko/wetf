# Wetf

<p align="center">
  <img width="250" src="https://github.com/timotejroiko/wetf/blob/main/logo.png?raw=true" alt="Wetf Logo"/>
</p>

A highly customizable and stupid fast ETF (External Term Format) encoder/decoder for NodeJS and Browsers.

External Term Format, or ETF, is the binary serialization format used by Erlang and Elixir for inter-process communication. ETF has seen prominent usage in many languages and systems as a replacement to JSON, mostly for languages that are better equipped to deal with binary formats rather than string-based formats. ETF is also often used for websocket communication with online API's such as the Discord API.

ETF has very loose definitions and rules for how data should be encoded between languages, especially since JavaScript and Erlang are vastly different, therefore **Wetf** is highly customizable and gives the user a lot of options for how the data should be encoded and decoded.

In addition, **Wetf** is fast, [stupid fast](#benchmark), it was designed for absolute performance and tries to squeeze every inch of juice out of the JS engine.

**Wetf** is pronounced "wet-the-fuck" and stands for "Wetf Es Truly Fast" (or "Wet Extra Terrestrial Format" if you prefer).

## Installation

**Wetf** works everywhere, including Node.js, Browsers, Deno, Bun, Electron and more.

### Runtimes

Installation for various runtimes can be done using most package managers:

```sh
npm i wetf
pnpm add wetf
yarn add wetf
bun add wetf
```

Likewise, it can be used in any format desired:

```js
// cjs
const { Packer, Unpacker } = require("wetf");
const Packer = require("wetf/packer");

// esm
import { Packer, Unpacker } from "wetf";

// deno with npm
import { Packer, Unpacker } from "npm:wetf";

// deno with unpkg
import { Packer } from "https://unpkg.com/wetf/esm/packer.js";

// deno with jsdelivr
import { Unpacker } from "https://cdn.jsdelivr.net/npm/wetf/esm/unpacker.min.js";
```

### Browsers

For Browsers you can access both the UMD versions and the ESM versions via `unpkg` and their minified versions via `jsdelivr`. There are separate versions to include only the Packer or only the Unpacker.

```js
// via jsdelivr
"https://cdn.jsdelivr.net/npm/wetf/{umd | esm}/{packer | unpacker | wetf}.js"

// minified via jsdelivr
"https://cdn.jsdelivr.net/npm/wetf/{umd | esm}/{packer | unpacker | wetf}.min.js"

// via unpkg
"https://unpkg.com/wetf/{umd | esm}/{packer | unpacker | wetf}.js"
```

Examples:

```html
<!-- regular script -->
<script src="https://cdn.jsdelivr.net/npm/wetf/umd/packer.min.js"></script>
<script>
    const { Packer } = Wetf;
</script>
```

```html
<!-- requirejs -->
<script>
    require(["https://cdn.jsdelivr.net/npm/wetf/umd/unpacker.min.js"], function(Wetf) {
        const { Unpacker } = Wetf;
    });
</script>
```

```html
<!-- systemjs -->
<script>
    System.import("https://cdn.jsdelivr.net/npm/wetf/umd/wetf.min.js").then(Wetf => {
        const { Packer, Unpacker } = Wetf;
    });
</script>
```

```html
<!-- esm -->
<script type="module">
    import { Packer, Unpacker } from "https://cdn.jsdelivr.net/npm/wetf/esm/wetf.min.js";
</script>
```

### Usage

**Wetf** offers two classes, a Packer and an Unpacker:

## Packer

The **Wetf** Packer is used to convert JavaScript objects and data into the binary ETF format.  
A Packer instance contains a single `pack` method that synchronously returns an instance of Uint8Array containing the binary data.  

```js
const packer = new Packer({
    // packer options
});

const etf = packer.pack({a:10,b:20}) // Uint8Array<[131,116,0,0,0,2,119,1,97,97,10,119,1,98,97,20]>
```

**Wetf** supports various compression methods, if an asynchronous compression method is used, the `pack` method will instead return a Promise that resolves into Uint8Array.

```js
const packer = new Packer({
    compression: "compressionstream"
});

const etf = await packer.pack({a:10,b:20}) // Uint8Array<[131,80,0,0,0,23,120,156,43,97,96,96,96,42,103,76,76,228,42,103,76,74,20,1,0,21,222,3,10]>
```

### Packer Options

All options are optional.

| option | type | default | description |
|---|---|---|---|
| poolSize | number | 1048576 | Initial size of the internal memory buffer in bytes |
| useLegacyAtoms | boolean | false | If enabled, Atoms will be encoded using the legacy `ATOM_EXT` formats instead of the newer `ATOM_UTF8_EXT`. Legacy atoms are slightly faster but are limited to the latin1 character set |
| compression | [Compression Method](#compression-method) | false | Enable data compression and specify the compression method |
| encoding | [Encoding Options](#encoding-options) | {} | Customize encoding behavior |

### Compression Method

**Wetf** has two built-in compression methods and also allows a user-defined function for compressing with third party libraries such as `pako` or `fflate`:

| method | description |
|---|---|
| false | Do not compress (default) |
| true | Compress using "zlib" if available, fallback to "compressionstream" |
| "zlib" | Compress using `deflateSync` from NodeJS's native zlib module (not available in browsers) |
| "compressionstream" | Compress using `CompressionStream` from native web streams. This method is Async and will make `pack` return a Promise (available in modern browsers and node 18+) |
| (Uint8Array) => Uint8Array \| Promise\<Uint8Array\> | Compress using a custom function. If the function is Async, `pack` will return a Promise |

### Encoding Options

This object controls the encoding behavior and determines which JavaScript data types should be encoded into which ETF types, limited to what makes reasonable sense.

| option | values | default | description |
|---|---|---|---|
| string | "binary", "string" | "string" | Whether strings should be encoded as `STRING_EXT` or `BINARY_EXT` |
| key | "binary", "string", "atom" | "atom" | Whether object keys should be encoded as `STRING_EXT`, `BINARY_EXT` or `ATOM_*_EXT` |
| safeInt | "bigint", "float" | "bigint" | Whether integers between 32 and 53 bits should be encoded as `SMALL_BIG_EXT` or `NEW_FLOAT_EXT` |
| safeBigInt | "number", "bigint" | "number" | Whether BigInts smaller than 32 bits should be encoded as `*_INTEGER_EXT` or `SMALL_BIG_EXT` |
| null | "atom", "nil" | "atom" | Whether null should be encoded as the Atom `nil` or as `NIL_EXT` |
| undefined | "atom", "null", "ignore" | "atom" | Whether undefined should be encoded as the Atom `undefined`, converted to null or ignored\* |
| infinity | "atom", "null", "ignore" | "atom" | Whether Infinity should be encoded as the Atoms `positive_infinity` and `negative_infinity`, converted to `null` or ignored\* |
| nan | "atom", "null", "ignore" | "atom" | Whether NaN should be encoded as the Atom `nan`, converted to `null` or ignored\* |
| buffer | "binary", "bitbinary", "string" | "binary" | Whether Buffers and TypedArrays should be encoded as `BINARY_EXT`, `BIT_BINARY_EXT` or `STRING_EXT` |
| array | "list", "improperlist", "tuple" | "tuple" | Whether Arrays should be encoded as a proper nil-terminated `LIST_EXT`, an improper `LIST_EXT` or a `*_TUPLE_EXT` |

\* Ignored types will have their object keys deleted and their array indexes spliced from the final value.

### Packer Limitations

The Packer currently cannot create the following ETF types:

`Distribution Header`, `ATOM_CACHE_REF`, `FLOAT_EXT`, `PORT_EXT`, `NEW_PORT_EXT`, `V4_PORT_EXT`, `PID_EXT`, `NEW_PID_EXT`, `REFERENCE_EXT`, `NEW_REFERENCE_EXT`, `NEWER_REFERENCE_EXT`, `FUN_EXT`, `NEW_FUN_EXT`, `EXPORT_EXT`

And does not support encoding the following JS objects:

`Map`, `Set`, `Date`, `Error`, `ArrayBuffer`, `DataView`, `Function`, `RegExp`

Methods to create and support some of these types and objects might be added in the future, feel free to open a feature request or issue.

The following JS objects may have special rules and behavior:

`Symbol`s are stringified to `Symbol(description)` and encoded as strings.

`ArrayBuffer` and `DataView` are not directly supported, but Buffer and TypedArrays are.

## Unpacker

The **Wetf** Unpacker is used to convert ETF binary data into JavaScript objects and values.  
An Unpacker instance contains a single `unpack` method that synchronously processes the binary data and returns a JavaScript value.  

```js
const unpacker = new Unpacker({
    // unpacker options
});

const etf = new Uint8Array([131,116,0,0,0,2,119,1,97,97,10,119,1,98,97,20]);
const js = unpacker.unpack(etf) // { a: 10, b: 20 }
```

Compressed data is automatically decompressed when encountered. If an asynchronous decompression method is used, the `unpack` method will instead return a Promise that resolves into the JavaScript value.

```js
const unpacker = new Unpacker({
    decompression: "decompressionstream"
});

const etf = new Uint8Array([131,80,0,0,0,23,120,156,43,97,96,96,96,42,103,76,76,228,42,103,76,74,20,1,0,21,222,3,10]);
const js = await unpacker.unpack(etf) // { a: 10, b: 20 }
```

### Unpacker Options

All options are optional.

| option | type | default | description |
|---|---|---|---|
| decompression | [Decompression Method](#decompression-method) | - | Specify the decompression method |
| decoding | [Decoding Options](#decoding-options) | {} | Customize decoding behavior |
| atomTable | object | [Default Atom Table](#default-atom-table) | Defines a table of atoms and the fixed values they represent. When an atom is decoded, it will be replaced by the corresponding value, or converted to a string if no value is found |
| atomRegistration | boolean | true | Whether to enable adding newly encountered atoms to the atom table. This option slightly increases memory usage and makes first-time atoms slightly slower to decode but subsequent decodings of the same atom will become much faster (enabled by default) |

### Decompression Method

**Wetf** has two built-in decompression methods and also allows a user-defined function for decompressing with third party libraries such as `pako` or `fflate`:

| method | description |
|---|---|
| "zlib" | Decompress using `inflateSync` from NodeJS's native zlib module (not available in browsers) |
| "decompressionstream" | Decompress using `DecompressionStream` from native web streams. This method is Async and will make `unpack` return a Promise (available in modern browsers and node 18+) |
| (Uint8Array \| Buffer) => Uint8Array \| Buffer \| Promise\<Uint8Array\> \| Promise\<Buffer\> | Decompress using a custom function. If the function is Async, `unpack` will return a Promise |

If no decompression method is set, **Wetf** will decompress using "zlib" if available and fallback to "decompressionstream";

### Decoding Options

This object controls the decoding behavior and determines which ETF data types should be decoded into which JavaScript values, limited to what makes reasonable sense.

| option | value | default | description |
|---|---|---|---|
| nil | "null", "array" | "null" | Whether `NIL_EXT` should be decoded as `null` or as `[]` |
| string | "utf8", "latin1", "buffer", "uint8array", "array" | "utf8" | Whether `STRING_EXT` should be decoded as a string (utf8 or latin1) or as bytes (Buffer, Uint8Array or Array) |
| binary | "utf8", "latin1", "buffer", "uint8array", "array" | "uint8array" | Whether `BINARY_EXT` should be decoded as a string (utf8 or latin1) or as bytes (Buffer, Uint8Array or Array) |
| bitbinary | "utf8", "latin1", "buffer", "uint8array", "array" | "uint8array" | Whether `BIT_BINARY_EXT` should be decoded as a string (utf8 or latin1) or as bytes (Buffer, Uint8Array or Array) |
| bigint | "bigint", "string" | "bigint" | Whether `*_BIG_EXT` should be decoded as bigint or as a stringified number |
| safebigint | "number", "bigint", "string" | "number" | Whether `*_BIG_EXT` smaller than 53 bits should be decoded as a number, a bigint or a stringified number |

### Default Atom Table

A table of atoms and the JavaScript values they represent. The default atom table looks like this:

```js
{
    "true": true,
    "false": false,
    "undefined": undefined,
    "null": null,
    "nil": null,
    "nan": NaN,
    "infinity": Infinity,
    "positive_infinity": Infinity,
    "negative_infinity": -Infinity
}
```

If a custom atom table is defined, it replaces the entire default table. To simply add an atom to the default table, copy it first and then add your atoms.  
This table also works as an accelerator as Atoms in the table are faster to decode. Atoms not in the table will be decoded as strings.

If `atomRegistration` is enabled, newly encountered atoms will automatically be added to the table as strings, making them faster to decode the next time they appear.

### Unpacker Limitations

The Unpacker currently cannot unpack the following ETF types:

`Distribution Header`, `ATOM_CACHE_REF`, `FLOAT_EXT`, `PORT_EXT`, `NEW_PORT_EXT`, `V4_PORT_EXT`, `PID_EXT`, `NEW_PID_EXT`, `REFERENCE_EXT`, `NEW_REFERENCE_EXT`, `NEWER_REFERENCE_EXT`, `FUN_EXT`, `NEW_FUN_EXT`, `EXPORT_EXT`

Support for these types might be added in the future, feel free to open a feature request or issue.

## Benchmark

An ungodly amount of JS abuse and trickery went into creating **Wetf** in order to make it truly stupid fast. In this benchmark, several libraries were tested by measuring the time taken to encode the same sample object 1 million times and then the time taken to decode the result another 1 million times. Here are the results:

### Sample object

```js
const obj = {
    a: 10,
    b: 20.4857394875938,
    c: "02fh203jf0293",
    d: [32,42352,"3523",234],
    e: { r: 4345, g: "fwefw" },
    n: true,
    f: false,
    z: null,
    k: 837028304n
}
```

### Results

| Library | Encoding Performance | Decoding Performance |
|---|---|---|
| [erlpack](https://github.com/discord/erlpack) | 34.39s (29078 op/s) | 6.88s (145348 op/s) |
| [etf.js](https://github.com/vladfrangu/etf.js) | 27.24s (36710 op/s) | 7.09s (141043 op/s) |
| [erlpackjs](https://github.com/SemperFortis/erlpackjs) | 20.57s (48614 op/s) | 8.05s (124223 op/s) |
| [erlang_js](https://github.com/okeuday/erlang_js) | 88.85s (11254 op/s) | 49.08s (20374 op/s) |
| [@devsnek/earl](https://github.com/devsnek/earl) | 19.83s (50428 op/s) | 7.09s (140847 op/s) |
| [@typescord/ftee](https://github.com/typescord/ftee) | 8.94s (111856 op/s) | 9.31s (107411 op/s) |
| [wetf](https://github.com/timotejroiko/wetf) | 1.48s (675675 op/s) | 1.28s (781250 op/s) |

Feel free to run the benchmarks yourself with `npm run benchmark`.

## License

**Wetf** is licensed under MIT for simplicity and ease of access to other developers, however, if you're an individual or a company using this library in commercial products and/or services, consider subscribing to the appropriate sponsorship level [here](https://github.com/sponsors/timotejroiko) and get priority support for your business.
