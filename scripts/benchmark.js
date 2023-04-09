// basic benchmark with fixed data, need to increase coverage but for now its fine
// also, some of these libs outright break when trying to encode/decode certain types so the bechmark is limited to types that work on all of them

const bench = require("nanobench");
const N = 1000000;

const obj = {
	a: 10,
	b: 20.4857394875938,
	c: "02fh203jf0293",
	d: [32, 42352, "3523", 234],
	e: { r: 4345, g: "fwefw" },
	n: true,
	f: false,
	z: null,
	k: 837028304n
};

console.log("begin benchmark");
console.log("iterations = " + N);

bench("wetf pack", function (b) {
	const { Packer } = require("../index");
	const packer = new Packer();
	b.start();
	for (var i = 0; i < N; i++) {
		packer.pack(obj);
	}
	b.end();
});

bench("wetf unpack", function (b) {
	const { Packer, Unpacker } = require("../index");
	const packer = new Packer();
	const unpacker = new Unpacker();
	const packed = packer.pack(obj);
	b.start();
	for (var i = 0; i < N; i++) {
		// @ts-expect-error 
		unpacker.unpack(packed);
	}
	b.end();
});

bench("erlpack pack", function (b) {
	const { pack } = require("erlpack");
	b.start();
	for (var i = 0; i < N; i++) {
		pack(obj);
	}
	b.end();
});

bench("erlpack unpack", function (b) {
	const { pack } = require("etf.js"); // erlpack's packer is broken lol
	const { unpack } = require("erlpack");
	const packed = Buffer.from(pack(obj));
	b.start();
	for (var i = 0; i < N; i++) {
		unpack(packed);
	}
	b.end();
});

bench("etf.js pack", function (b) {
	const { pack } = require("etf.js");
	b.start();
	for (var i = 0; i < N; i++) {
		pack(obj);
	}
	b.end();
});

bench("etf.js unpack", function (b) {
	const { pack, unpack } = require("etf.js");
	const packed = pack(obj);
	b.start();
	for (var i = 0; i < N; i++) {
		unpack(packed);
	}
	b.end();
});

bench("erlpackjs pack", function (b) {
	const { pack } = require("erlpackjs");
	b.start();
	for (var i = 0; i < N; i++) {
		pack(obj);
	}
	b.end();
});

bench("erlpackjs unpack", function (b) {
	const { pack, unpack } = require("erlpackjs");
	const packed = pack(obj);
	b.start();
	for (var i = 0; i < N; i++) {
		unpack(packed);
	}
	b.end();
});

bench("erlang_js pack", function (b) {
	const { Erlang: { term_to_binary } } = require("erlang_js");
	b.start();
	for (var i = 0; i < N; i++) {
		term_to_binary(obj, () => void 0);
	}
	b.end();
});

bench("erlang_js unpack", function (b) {
	const { Erlang: { term_to_binary, binary_to_term } } = require("erlang_js");
	b.start();
	term_to_binary(obj, result => {
		for (var i = 0; i < N; i++) {
			binary_to_term(result, () => {});
		}     
	});
	b.end();
});

bench("@devsnek/earl pack", function (b) {
	const { pack } = require("@devsnek/earl");
	b.start();
	for (var i = 0; i < N; i++) {
		pack(obj);
	}
	b.end();
});

bench("@devsnek/earl unpack", function (b) {
	const { pack, unpack } = require("@devsnek/earl");
	const packed = pack(obj);
	b.start();
	for (var i = 0; i < N; i++) {
		unpack(packed);
	}
	b.end();
});

bench("@typescord/ftee pack", function (b) {
	const { encode } = require("@typescord/ftee");
	b.start();
	for (var i = 0; i < N; i++) {
		encode(obj);
	}
	b.end();
});

bench("@typescord/ftee unpack", function (b) {
	const { encode, decode } = require("@typescord/ftee");
	const packed = encode(obj);
	b.start();
	for (var i = 0; i < N; i++) {
		decode(packed);
	}
	b.end();
});
