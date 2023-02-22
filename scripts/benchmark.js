// basic benchmark, need to increase coverage but for now its fine
// also, some of these libs outright break when trying to encode/decode certain types so the bechmark is limited to types that work on all of them

const bench = require("nanobench");

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

bench('erlpack pack 1 million times', function (b) {
    const { pack } = require("erlpack");
    b.start()
    for (var i = 0; i < 1000000; i++) {
        pack(obj);
    }
    b.end()
})

bench('etf.js pack 1 million times', function (b) {
    const { pack } = require("etf.js");
    b.start()
    for (var i = 0; i < 1000000; i++) {
        pack(obj);
    }
    b.end()
})

bench('erlpackjs pack 1 million times', function (b) {
    const { pack } = require("erlpackjs");
    b.start()
    for (var i = 0; i < 1000000; i++) {
        pack(obj);
    }
    b.end()
})

bench('erlang_js pack 1 million times', function (b) {
    const { Erlang: { term_to_binary } } = require("erlang_js");
    b.start()
    for (var i = 0; i < 1000000; i++) {
        term_to_binary(obj, () => void 0);
    }
    b.end()
})

bench('@devsnek/earl pack 1 million times', function (b) {
    const { pack } = require("@devsnek/earl");
    b.start()
    for (var i = 0; i < 1000000; i++) {
        pack(obj);
    }
    b.end()
})

bench('@typescord/ftee pack 1 million times', function (b) {
    const { encode } = require("@typescord/ftee");
    b.start()
    for (var i = 0; i < 1000000; i++) {
        encode(obj);
    }
    b.end()
})

bench('wetf pack 1 million times', function (b) {
    const { Packer } = require("../index");
    const packer = new Packer();
    b.start()
    for (var i = 0; i < 1000000; i++) {
        packer.pack(obj);
    }
    b.end()
})

bench('erlpack unpack 1 million times', function (b) {
    const { pack } = require("etf.js"); // erlpack's packer is broken lol
    const { unpack } = require("erlpack");
    const packed = Buffer.from(pack(obj));
    b.start()
    for (var i = 0; i < 1000000; i++) {
        unpack(packed);
    }
    b.end()
});

bench('etf.js unpack 1 million times', function (b) {
    const { pack, unpack } = require("etf.js");
    const packed = pack(obj);
    b.start()
    for (var i = 0; i < 1000000; i++) {
        unpack(packed);
    }
    b.end()
});

bench('erlpackjs unpack 1 million times', function (b) {
    const { pack, unpack } = require("erlpackjs");
    const packed = pack(obj);
    b.start()
    for (var i = 0; i < 1000000; i++) {
        unpack(packed);
    }
    b.end()
});

bench('erlang_js unpack 1 million times', function (b) {
    const { Erlang: { term_to_binary, binary_to_term } } = require("erlang_js");
    b.start()
    term_to_binary(obj, result => {
        for (var i = 0; i < 1000000; i++) {
            binary_to_term(result, () => {});
        }     
    });
    b.end()
})

bench('@devsnek/earl pack 1 million times', function (b) {
    const { pack, unpack } = require("@devsnek/earl");
    const packed = pack(obj);
    b.start()
    for (var i = 0; i < 1000000; i++) {
        unpack(packed);
    }
    b.end()
})

bench('@typescord/ftee unpack 1 million times', function (b) {
    const { encode, decode } = require("@typescord/ftee");
    const packed = encode(obj);
    b.start()
    for (var i = 0; i < 1000000; i++) {
        decode(packed);
    }
    b.end()
})

bench('wetf unpack 1 million times', function (b) {
    const { Packer, Unpacker } = require("../index");
    const packer = new Packer();
    const unpacker = new Unpacker();
    const packed = /** @type {Uint8Array} */ (packer.pack(obj));
    b.start()
    for (var i = 0; i < 1000000; i++) {
        unpacker.unpack(packed);
    }
    b.end()
});
