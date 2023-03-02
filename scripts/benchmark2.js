// basic benchmark with randomized data, need to increase coverage but for now its fine
// also, some of these libs outright break when trying to encode/decode certain types so the bechmark is limited to types that work on all of them

const bench = require("nanobench");
const N = 1000000;

const a = [];
const c = [];

console.log("generating data");

for (let i = 0; i < N; i++) {
    const o = {
        a: Math.random(),
        b: Math.random().toString(),
        c: [i, i * 1000, i.toString()],
        d: {
            [i]: "wefwef" + i,
            n: BigInt(i * 347928347)
        },
        t: i % 2 ? true: false,
        f: i % 3 ? false : true,
        n: i % 4 ? null : undefined,
        u: i % 5 ? undefined : null,
        z: 973948579823745989n + BigInt(i)
    }
    a.push(o);
}

console.log("begin benchmark");
console.log("iterations = " + N);

bench('erlpack pack', function (b) {
    const { pack } = require("erlpack");
    b.start();
    for (let i = 0; i < N; i++) {
        c[i] = pack(a[i]);
    }
    b.end();
});

bench('erlpack unpack', function (b) {
    const { pack } = require("etf.js"); // erlpack's packer is broken lol
    for (let i = 0; i < N; i++) {
        c[i] = pack(a[i]);
    }

    const { unpack } = require("erlpack");
    b.start();
    for (let i = 0; i < N; i++) {
        unpack(c[i]);
    }
    b.end();
});

bench('etf.js pack', function (b) {
    const { pack } = require("etf.js");
    b.start();
    for (let i = 0; i < N; i++) {
        c[i] = pack(a[i]);
    }
    b.end();
});

bench('etf.js unpack', function (b) {
    const { unpack } = require("etf.js");
    b.start();
    for (let i = 0; i < N; i++) {
        try {
            unpack(c[i]);
        }
        catch {
            console.log(i, c[i], a[i]);
            process.exit();
        }
    }
    b.end();
});

bench('erlpackjs pack', function (b) {
    const { pack } = require("erlpackjs");
    b.start();
    for (let i = 0; i < N; i++) {
        c[i] = pack(a[i]);
    }
    b.end();
});

bench('erlpackjs unpack', function (b) {
    const { unpack } = require("erlpackjs");
    b.start();
    for (let i = 0; i < N; i++) {
        unpack(c[i]);
    }
    b.end();
});

bench('erlang_js pack', function (b) {
    const { Erlang: { term_to_binary } } = require("erlang_js");
    b.start();
    for (let i = 0; i < N; i++) {
        term_to_binary(a[i], (e, d) => c[i] = d);
    }
    b.end();
});

bench('erlang_js unpack', function (b) {
    const { Erlang: { binary_to_term } } = require("erlang_js");
    b.start();
    for (let i = 0; i < N; i++) {
        binary_to_term(c[i], () => {});
    }     
    b.end();
});

bench('@devsnek/earl pack', function (b) {
    const { pack } = require("@devsnek/earl");
    b.start();
    for (let i = 0; i < N; i++) {
        c[i] = pack(a[i]);
    }
    b.end();
});

bench('@devsnek/earl unpack', function (b) {
    const { unpack } = require("@devsnek/earl");
    b.start();
    for (let i = 0; i < N; i++) {
        unpack(c[i]);
    }
    b.end();
});

bench('@typescord/ftee pack', function (b) {
    const { encode } = require("@typescord/ftee");
    b.start();
    for (let i = 0; i < N; i++) {
        c[i] = encode(a[i]);
    }
    b.end();
});

bench('@typescord/ftee unpack', function (b) {
    const { decode } = require("@typescord/ftee");
    b.start();
    for (let i = 0; i < N; i++) {
        decode(c[i]);
    }
    b.end();
});

bench('wetf pack', function (b) {
    const { Packer } = require("../index");
    const packer = new Packer();
    b.start();
    for (let i = 0; i < N; i++) {
        c[i] = packer.pack(a[i]);
    }
    b.end();
});

bench('wetf unpack', function (b) {
    const { Unpacker } = require("../index");
    const unpacker = new Unpacker();
    b.start();
    for (let i = 0; i < N; i++) {
        unpacker.unpack(c[i]);
    }
    b.end();
});
