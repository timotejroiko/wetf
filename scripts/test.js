const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { deflateSync, inflateSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Packer, Unpacker } = require("../");

const u32 = value => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const frame = term => Uint8Array.from([131, ...term]);
const roundtrip = (value, options = {}) => new Unpacker(options).unpack(new Packer(options).pack(value));

function textTerm(type, bytes) {
	let length;
	if(type === 115 || type === 119) { length = [bytes.length]; }
	else if(type === 109 || type === 77) { length = u32(bytes.length); }
	else { length = [bytes.length >>> 8, bytes.length & 255]; }
	return [type, ...length, ...(type === 77 ? [8] : []), ...bytes];
}

test("scalar values match independent ETF fixtures", () => {
	const packer = new Packer();
	const unpacker = new Unpacker();
	for (const [value, term] of [
		[0, [97, 0]], [255, [97, 255]], [256, [98, 0, 0, 1, 0]],
		[-1, [98, 255, 255, 255, 255]], [-2147483647, [98, 128, 0, 0, 1]],
		[1.5, [70, 63, 248, 0, 0, 0, 0, 0, 0]],
		[true, [119, 4, 116, 114, 117, 101]], [false, [119, 5, 102, 97, 108, 115, 101]],
		[null, [119, 3, 110, 105, 108]], [undefined, [119, 9, 117, 110, 100, 101, 102, 105, 110, 101, 100]],
		["hi", [109, 0, 0, 0, 2, 104, 105]]
	]) {
		assert.deepEqual(packer.pack(value), frame(term));
		assert.deepEqual(unpacker.unpack(frame(term)), value);
	}
	assert.equal(unpacker.unpack(frame([98, 128, 0, 0, 0])), -2147483648);
	assert.equal(roundtrip(Symbol("name"), { decoding: { binary: "utf8" } }), "Symbol(name)");
	assert.equal(roundtrip(Symbol(), { decoding: { binary: "utf8" } }), "Symbol()");
	assert.equal(unpacker.unpack(Uint8Array.of(97, 7)), 7);
	assert.equal(unpacker.unpack(frame([97, 7, 97, 9])), 7);
	assert.throws(() => unpacker.unpack(frame([255])), Error);
});

test("truncated terms cannot read previous packets or cached payloads", () => {
	const terms = [
		[97, 7], [98, 0, 0, 1, 0], [70, 63, 248, 0, 0, 0, 0, 0, 0],
		[99, ...Buffer.from("1.50000000000000000000e+00".padEnd(31, "\0"))],
		...[100, 115, 118, 119, 107, 109, 77].map(type => textTerm(type, [115, 101, 99, 114, 101, 116])),
		[77, ...u32(2), 3, 97, 224],
		[110, 0, 0], [110, 1, 0, 0], [110, 2, 0, 255, 255],
		[111, ...u32(2), 0, 255, 255],
		[104, 1, 97, 7], [105, ...u32(1), 97, 7],
		[108, ...u32(1), 97, 7, 106],
		[108, ...u32(1), 97, 7, 97, 8],
		...[100, 115, 118, 119, 107, 109].flatMap(type =>
			[[], [97], [115, 101, 99, 114, 101, 116]].map(bytes =>
				[116, ...u32(1), ...textTerm(type, bytes), 97, 7])),
		[116, ...u32(1), 108, ...u32(1), 97, 97, 106, 97, 7]
	];
	for(const decoding of [
		{},
		{ binary: "latin1", string: "utf8", bitbinary: "latin1" },
		{ binary: "uint8array", string: "uint8array", bitbinary: "uint8array" },
		{ binary: "buffer", string: "buffer", bitbinary: "buffer" },
		{ binary: "array", string: "array", bitbinary: "array" }
	]) {
		for(const cache of [false, true]) {
			const unpacker = new Unpacker({ cacheKeys: cache, cacheAtoms: cache, decoding });
			for(const term of terms) {
				const packet = frame(term);
				const expected = unpacker.unpack(packet);
				for(let size = 0; size < packet.length; size++) {
					// Seed both scratch bytes and caches immediately before the truncated read.
					unpacker.unpack(packet);
					assert.throws(() => unpacker.unpack(packet.subarray(0, size)),
						`tag ${term[0]}, prefix ${size}, cache ${cache}`);
				}
				assert.deepEqual(unpacker.unpack(packet), expected);
			}
		}
	}
});

test("truncated length headers never make the decoder cursor non-finite", () => {
	const headers = [
		[100], [100, 0], [115], [118], [118, 0], [119],
		[104], [107], [107, 0], [110]
	];
	const tails = [
		...headers,
		...headers.slice(0, 6).map(header => [116, ...u32(1), ...header]),
		...[[], [0]].map(length => [116, ...u32(1), 107, ...length]),
		...[[], [0]].map(length => [108, ...u32(1), 97, 97, 107, ...length])
	];
	for(const size of [0, 11990, 12000, 13000]) {
		const prefix = [104, 2, ...textTerm(109, new Array(size).fill(97))];
		const valid = frame([...prefix, 97, 7]);
		for(const cache of [false, true]) {
			const unpacker = new Unpacker({ cacheKeys: cache, cacheAtoms: cache, decoding: { list: "string" } });
			for(const tail of tails) {
				assert.throws(() => unpacker.unpack(frame([...prefix, ...tail])));
				assert.ok(Number.isFinite(unpacker._i));
				assert.deepEqual(unpacker.unpack(valid), ["a".repeat(size), 7]);
			}
		}
	}
});

test("character list tails and large packets respect the input boundary", () => {
	const unpacker = new Unpacker({ decoding: { list: "string" } });
	for(const term of [
		[108, ...u32(1), 97, 97, 106],
		[108, ...u32(1), 97, 97, 108, ...u32(1), 97, 98, 106],
		[108, ...u32(1), 97, 97, 107, 0, 2, 98, 99]
	]) {
		const packet = frame(term);
		const expected = unpacker.unpack(packet);
		for(let size = 0; size < packet.length; size++) {
			unpacker.unpack(packet);
			assert.throws(() => unpacker.unpack(packet.subarray(0, size)));
		}
		assert.equal(unpacker.unpack(packet), expected);
	}
	const large = frame([109, ...u32(13000), ...new Array(13000).fill(97)]);
	for(const input of [large, Buffer.from(large)]) {
		assert.equal(unpacker.unpack(input), "a".repeat(13000));
		for(const size of [0, 1, 2, 3, 4, 5, 6, 11999, 12000, 12001, input.length - 1]) {
			assert.throws(() => unpacker.unpack(input.subarray(0, size)));
		}
	}
	for(const term of [[104, 255], [105, ...u32(1000000)], [108, ...u32(1000000)], [116, ...u32(1000000)]]) {
		assert.throws(() => unpacker.unpack(frame(term)));
	}
	for(let size = 2; size < 6; size++) {
		assert.throws(() => unpacker.unpack(Uint8Array.of(131, 80, 0, 0, 0, 2).subarray(0, size)), RangeError);
	}
});

test("numbers preserve integer boundaries and floating-point values", () => {
	for (const value of [2147483648, 4294967295, 4294967296, 2 ** 40 - 1, 2 ** 40, 2 ** 48 - 1, 2 ** 48, Number.MAX_SAFE_INTEGER]) {
		for (const sign of [1, -1]) {
			assert.equal(roundtrip(sign * value), sign * value);
			assert.equal(roundtrip(sign * value, { encoding: { safeInt: "float" } }), sign * value);
		}
	}
	for (const value of [0.1, -1.5, Number.MIN_VALUE, Number.MAX_VALUE, 2 ** 53, -(2 ** 53)]) {
		assert.equal(roundtrip(value), value);
	}
});

test("legacy floats preserve values and consume all 31 payload bytes", () => {
	const context = { TextEncoder, TextDecoder };
	runInNewContext(readFileSync(require.resolve("../umd/unpacker.js"), "utf8"), context);
	const constructors = [Unpacker, context.Wetf.Unpacker];
	for(const Decoder of constructors) {
		for(const browserStrictLatin1 of [false, true]) {
			const unpacker = new Decoder({ browserStrictLatin1 });
			for(const [text, value] of [
				["0.00000000000000000000e+00", 0],
				["-0.00000000000000000000e+00", -0],
				["8.75000000000000000000e-01", 0.875],
				["-1.23456789012345669043e+100", -1.2345678901234567e100],
				["4.94065645841246544177e-324", Number.MIN_VALUE],
				["1.79769313486231570815e+308", Number.MAX_VALUE]
			]) {
				const payload = Buffer.alloc(31);
				payload.write(text, "ascii");
				const term = [99, ...payload];
				assert.equal(unpacker.unpack(frame(term)), value);
				assert.equal(JSON.stringify(unpacker.unpack(frame([104, 2, ...term, 97, 65]))), JSON.stringify([value, 65]));
			}
		}
	}
});

test("small BigInts use signed INTEGER_EXT or little-endian SMALL_BIG_EXT", () => {
	const packer = new Packer();
	for (const value of [-1n, -42n, -256n, -65536n, -2147483647n, 256n, 2147483647n]) {
		const expected = Buffer.alloc(6);
		expected.set([131, 98]);
		expected.writeInt32BE(Number(value), 2);
		assert.deepEqual(Buffer.from(packer.pack(value)), expected);
		assert.deepEqual(roundtrip([value, 65]), [Number(value), 65]);
	}
	for (const value of [1n, 42n, 255n]) {
		assert.deepEqual(packer.pack(value), frame([97, Number(value)]));
		assert.deepEqual(roundtrip([value, 65]), [Number(value), 65]);
	}
	const forced = new Packer({ encoding: { safeBigInt: "bigint" } });
	for (let value = 1; value < 256; value++) {
		for (const sign of [0, 1]) {
			const bigint = BigInt(sign ? -value : value);
			assert.deepEqual(forced.pack(bigint), frame([110, 1, sign, value]));
			assert.deepEqual(new Unpacker({ decoding: { safebigint: "bigint" } }).unpack(forced.pack([bigint, 65])), [bigint, 65]);
		}
	}
	assert.equal(roundtrip(0n), 0);
});

test("BigInt byte widths, signs and decoding policies", () => {
	const packer = new Packer({ poolSize: 128, encoding: { safeBigInt: "bigint" } });
	const unpacker = new Unpacker();
	for (const bits of [0, 7, 8, 15, 16, 23, 24, 31, 32, 39, 40, 47, 48, 52, 53, 56, 63, 64, 65, 95, 127, 128, 129, 159, 191, 192, 223, 255, 256, 257, 319, 320, 383, 384, 511, 512, 1024, 2040, 2048, 8192]) {
		for (const value of [(1n << BigInt(bits)) - 1n, 1n << BigInt(bits)]) {
			for (const bigint of [value, -value]) {
				const mode = bigint >= -9007199254740991n && bigint <= 9007199254740991n ? "safebigint" : "bigint";
				assert.equal(unpacker.unpack(packer.pack(bigint)), mode === "safebigint" ? Number(bigint) : bigint);
				assert.equal(new Unpacker({ decoding: { [mode]: "string" } }).unpack(packer.pack(bigint)), bigint.toString());
				if(mode === "safebigint") {
					assert.equal(new Unpacker({ decoding: { safebigint: "bigint" } }).unpack(packer.pack(bigint)), bigint);
				}
			}
		}
	}
});

test("zero BigInts decode consistently and consume their whole term", () => {
	for (const type of [110, 111]) {
		for (const length of [0, 1, 2, 7, 8, 16, 255, 256]) {
			if(type === 110 && length > 255) { continue; }
			for (const sign of [0, 1]) {
				const term = [type, ...(type === 110 ? [length] : u32(length)), sign, ...Array(length).fill(0)];
				for (const [safebigint, zero] of [[undefined, 0], ["number", 0], ["bigint", 0n], ["string", "0"]]) {
					assert.deepEqual(new Unpacker({ decoding: { safebigint } }).unpack(frame([104, 2, ...term, 97, 65])), [zero, 65]);
				}
			}
		}
	}
});

test("padded BigInts use magnitude-based decoding policies and preserve following terms", () => {
	for(const value of [1n, 255n, 256n, (1n << 48n) - 1n, 1n << 48n, 9007199254740991n, 9007199254740992n, 1n << 63n, 1n << 64n, 1n << 120n]) {
		const digits = [];
		for(let rest = value; rest; rest >>= 8n) { digits.push(Number(rest & 255n)); }
		for(const type of [110, 111]) {
			for(const length of [2, 7, 8, 9, 16, 255, 256]) {
				if(length <= digits.length || type === 110 && length > 255) { continue; }
				for(const sign of [0, 1]) {
					const signed = sign ? -value : value;
					const term = [type, ...(type === 110 ? [length] : u32(length)), sign, ...digits, ...Array(length - digits.length).fill(0)];
					for(const safebigint of ["number", "bigint", "string"]) {
						for(const bigint of ["bigint", "string"]) {
							const mode = value <= 9007199254740991n ? safebigint : bigint;
							const expected = mode === "number" ? Number(signed) : mode === "string" ? signed.toString() : signed;
							assert.deepEqual(new Unpacker({ decoding: { safebigint, bigint } }).unpack(frame([104, 2, ...term, 97, 65])), [expected, 65]);
						}
					}
				}
			}
		}
	}
});

test("tuples, lists, improper lists and NIL", () => {
	for(const array of [undefined, "tuple", "list", "improperlist"]) {
		const expected = array === "list" || array === "improperlist" ? [106] : [104, 0];
		assert.deepEqual(new Packer({ encoding: { array } }).pack([]), frame(expected));
	}
	assert.deepEqual(new Packer().pack([1]), frame([104, 1, 97, 1]));
	for(const length of [1, 256]) {
		assert.deepEqual(new Packer({ encoding: { undefined: "ignore" } }).pack(Array(length)), frame(length < 256 ? [104, 0] : [105, 0, 0, 0, 0]));
	}
	for (const array of ["tuple", "list", "improperlist"]) {
		for (const length of [0, 1, 2, 255, 256, 257]) {
			const value = Array.from({ length }, (_, i) => i);
			assert.deepEqual(roundtrip(value, { encoding: { array } }), value);
		}
	}
	const unpacker = new Unpacker();
	assert.deepEqual(unpacker.unpack(frame([108, 0, 0, 0, 2, 97, 1, 97, 2, 97, 3])), [1, 2, 3]);
	assert.deepEqual(unpacker.unpack(frame([105, 0, 0, 0, 0])), []);
	assert.deepEqual(new Unpacker({ decoding: { nil: "array" } }).unpack(frame([106])), []);
	assert.deepEqual(unpacker.unpack(frame([106])), []);
	assert.equal(new Unpacker({ decoding: { nil: "null" } }).unpack(frame([106])), null);
	assert.deepEqual(roundtrip(null, { encoding: { null: "nil" } }), []);
	assert.equal(roundtrip(null, { encoding: { null: "nil" }, decoding: { nil: "null" } }), null);
	assert.deepEqual(roundtrip({ a: [], b: {} }), { a: [], b: {} });
});

test("character lists decode Unicode scalars without changing tuples or NIL", () => {
	const points = [0, 233, 255, 256, 55295, 57344, 65536, 1114111];
	const list = [108, ...u32(points.length), ...points.flatMap(point => point < 256 ? [97, point] : [98, ...u32(point)]), 106];
	const unpacker = new Unpacker({ decoding: { list: "string" } });
	assert.deepEqual(unpacker.unpack(frame([104, 3, 97, 7, ...list, 97, 9])), [7, String.fromCodePoint(...points), 9]);
	assert.deepEqual(new Unpacker().unpack(frame(list)), points);
	assert.equal(unpacker.unpack(frame([108, 0, 0, 0, 0, 106])), "");
	assert.deepEqual(unpacker.unpack(frame([106])), []);
	assert.equal(new Unpacker({ decoding: { list: "string", nil: "null" } }).unpack(frame([106])), null);
	assert.deepEqual(unpacker.unpack(frame([104, 2, 97, 65, 97, 66])), [65, 66]);
	for (const safebigint of ["number", "bigint", "string"]) {
		assert.equal(new Unpacker({ decoding: { list: "string", safebigint } }).unpack(frame([108, 0, 0, 0, 2, 110, 1, 0, 65, 111, 0, 0, 0, 1, 0, 66, 106])), "AB");
	}
	const large = "é😀".repeat(40000);
	assert.equal(unpacker.unpack(new Packer({ encoding: { string: "char-list" } }).pack(large)), large);
});

test("string-mode lists append integer tails and preserve following terms", () => {
	const unpacker = new Unpacker({ decoding: { list: "string" } });
	for(const [tail, point] of [
		[[97, 66], 66],
		[[98, 0, 1, 246, 0], 128512],
		[[110, 3, 0, 0, 246, 1], 128512],
		[[111, 0, 0, 0, 3, 0, 0, 246, 1], 128512]
	]) {
		const list = [108, 0, 0, 0, 1, 97, 65, ...tail];
		assert.deepEqual(unpacker.unpack(frame([104, 3, 97, 7, ...list, 97, 9])), [7, "A" + String.fromCodePoint(point), 9]);
		assert.deepEqual(new Unpacker({ decoding: { safebigint: "number" } }).unpack(frame(list)), [65, point]);
	}
	assert.equal(unpacker.unpack(frame([108, 0, 0, 0, 0, 97, 65])), "A");
});

test("character lists consume list and byte-string continuation tails", () => {
	for(const [tail, suffix] of [
		[[108, ...u32(1), 97, 66, 106], "B"],
		[[108, ...u32(0), 108, ...u32(1), 98, ...u32(128512), 106], "😀"],
		[[108, ...u32(1), 97, 66, 97, 67], "BC"],
		[[107, 0, 3, 66, 195, 169], "BÃ©"],
		[[107, 0, 0], ""],
		[[108, ...u32(0), 106], ""]
	]) {
		const list = [108, ...u32(1), 97, 65, ...tail];
		const expected = "A" + suffix;
		for(const nil of ["array", "null"]) {
			const unpacker = new Unpacker({ decoding: { list: "string", string: "utf8", nil } });
			assert.deepEqual(unpacker.unpack(frame([104, 3, 97, 7, ...list, 97, 9])), [7, expected, 9]);
		}
		assert.deepEqual(new Unpacker().unpack(frame([116, ...u32(1), ...list, 97, 7])), { [expected]: 7 });
	}
});

test("string-mode lists reject non-character data without affecting array mode", () => {
	const unpacker = new Unpacker({ decoding: { list: "string" } });
	const arrayUnpacker = new Unpacker();
	for(const point of [-1, 55296, 57343, 1114112]) {
		const packet = frame([108, 0, 0, 0, 2, 97, 65, 98, ...u32(point), 106]);
		assert.throws(() => unpacker.unpack(packet), RangeError);
		assert.deepEqual(arrayUnpacker.unpack(packet), [65, point]);
		const improper = frame([108, 0, 0, 0, 1, 97, 65, 98, ...u32(point)]);
		assert.throws(() => unpacker.unpack(improper), RangeError);
		assert.deepEqual(arrayUnpacker.unpack(improper), [65, point]);
	}
	for(const [term, expected] of [
		[[108, 0, 0, 0, 2, 97, 65, 107, 0, 1, 98, 106], [65, "b"]],
		[[108, 0, 0, 0, 1, 70, ...Buffer.from("4050400000000000", "hex"), 106], [65]],
		[[104, 3, 97, 7, 108, 0, 0, 0, 2, 97, 65, 104, 1, 97, 66, 106, 97, 9], [7, [65, [66]], 9]],
	]) {
		assert.throws(() => unpacker.unpack(frame(term)), TypeError);
		assert.deepEqual(arrayUnpacker.unpack(frame(term)), expected);
	}
	assert.equal(unpacker.unpack(frame([108, 0, 0, 0, 1, 97, 67, 106])), "C");
});

test("character-list keys become text independently of list values and protect prototypes", () => {
	const term = text => [108, ...u32(Array.from(text).length), ...Array.from(text, char => char.codePointAt(0)).flatMap(point => point < 256 ? [97, point] : [98, ...u32(point)]), 106];
	const value = term("AB");
	const packet = frame([116, 0, 0, 0, 3, ...term("café😀"), ...value, ...term("__proto__"), 97, 9, ...term(""), 97, 11]);
	for (const list of ["array", "string"]) {
		const object = new Unpacker({ decoding: { list } }).unpack(packet);
		assert.deepEqual(object["café😀"], list === "array" ? [65, 66] : "AB");
		assert.equal(Object.getPrototypeOf(object), Object.prototype);
		assert.equal(Object.hasOwn(object, "__proto__"), true);
		assert.equal(object.__proto__, 9);
		assert.equal(object[""], 11);
		assert.throws(() => new Unpacker({ decoding: { list } }).unpack(frame([116, 0, 0, 0, 1, 108, 0, 0, 0, 1, 98, 0, 0, 216, 0, 106, 97, 13])), RangeError);
		assert.deepEqual(new Unpacker({ decoding: { list } }).unpack(frame([116, 0, 0, 0, 2, 108, 0, 0, 0, 1, 97, 65, 97, 66, 97, 13, ...term("next"), 97, 17])), { AB: 13, next: 17 });
	}
});

test("special values support atoms, null substitution and ignoring", () => {
	const values = [[undefined, "undefined"], [NaN, "nan"], [Infinity, "infinity"], [-Infinity, "infinity"]];
	for (const useLegacyAtoms of [false, true]) {
		for (const [value, option] of values) {
			assert.deepEqual(roundtrip(value, { useLegacyAtoms }), value);
			for (const nullEncoding of ["atom", "nil"]) {
				const options = { useLegacyAtoms, encoding: { [option]: "null", null: nullEncoding }, decoding: { nil: "null" } };
				assert.equal(roundtrip(value, options), null);
				assert.deepEqual(roundtrip([value, { a: value }], options), [null, { a: null }]);
			}
			const options = { useLegacyAtoms, encoding: { [option]: "ignore" } };
			assert.deepEqual(new Packer(options).pack(value), frame([106]));
			assert.deepEqual(roundtrip({ keep: 7, omit: value }, options), { keep: 7 });
			for (const array of ["tuple", "list", "improperlist"]) {
				options.encoding.array = array;
				assert.deepEqual(roundtrip([value, 1, value, 2, value], options), [1, 2]);
				assert.deepEqual(roundtrip([value], options), []);
			}
		}
	}
	const ignored = () => assert.fail("functions must not be invoked");
	for (const array of ["tuple", "list", "improperlist"]) {
		assert.deepEqual(roundtrip([ignored, 1, ignored, [ignored, 2], ignored], { encoding: { array } }), [1, [2]]);
		assert.deepEqual(roundtrip({ ignored, keep: 1 }), { keep: 1 });
	}
	for (const length of [255, 256]) {
		const value = Array(length).fill(1);
		assert.deepEqual(roundtrip([ignored, ...value, ignored]), value);
	}
});

test("unsupported values are omitted without losing supported data", async () => {
	const unsupported = [
		new Map([["a", 1]]), new Set([1]), new Date(0), new Error("failure"),
		new ArrayBuffer(8), /pattern/, () => assert.fail("functions must not be invoked")
	];
	for (const compression of [false, "zlib", "compressionstream"]) {
		for (const array of ["tuple", "list", "improperlist"]) {
			const packer = new Packer({ poolSize: 24, compression, encoding: { array } });
			const unpacker = new Unpacker({ decoding: { nil: "array" } });
			for (const value of unsupported) {
				assert.deepEqual(await unpacker.unpack(await packer.pack(value)), []);
				assert.deepEqual(await unpacker.unpack(await packer.pack({ keep: 7, omit: value })), { keep: 7 });
				assert.deepEqual(await unpacker.unpack(await packer.pack([value, 1, value, { omit: value }, 2, value])), [1, {}, 2]);
				assert.deepEqual(await unpacker.unpack(await packer.pack([value])), []);
			}
			const custom = { keep: 7, toJSON() { assert.fail("toJSON must not be invoked"); } };
			assert.deepEqual(await unpacker.unpack(await packer.pack(custom)), { keep: 7 });
			assert.equal(await unpacker.unpack(await packer.pack(9)), 9);
		}
	}
});

test("omission cursors survive value compaction and key rollback", () => {
	const compacting = new Packer({ poolSize: 96, encoding: { string: "string" } });
	const prefix = compacting.pack("p".repeat(20));
	const value = { x: "v".repeat(21) };
	assert.deepEqual(new Unpacker().unpack(compacting.pack(value)), value);
	assert.equal(new Unpacker().unpack(prefix), "p".repeat(20));

	const omittedKey = "ignored".repeat(8);
	for (const array of ["tuple", "list", "improperlist"]) {
		for (const key of ["atom", "binary", "string", "char-string"]) {
			for (const cacheKeys of [false, true]) {
				const packer = new Packer({ poolSize: 96, cacheKeys, encoding: { array, key, undefined: "ignore", nan: "ignore", infinity: "ignore" } });
				const unpacker = new Unpacker({ decoding: { nil: "array", binary: "utf8" } });
				const previous = packer.pack("p".repeat(20));
				const input = { [omittedKey]: new Map(), keep: [undefined, {}, { [omittedKey]: NaN, value: 7 }, Infinity], tail: 9 };
				for (let i = 0; i < 2; i++) {
					assert.deepEqual(unpacker.unpack(packer.pack(input)), { keep: [{}, { value: 7 }], tail: 9 });
				}
				assert.equal(unpacker.unpack(previous), "p".repeat(20));
				assert.deepEqual(unpacker.unpack(packer.pack({ [omittedKey]: undefined })), {});
				assert.equal(unpacker.unpack(packer.pack(11)), 11);
			}
		}
	}
});

test("ignored properties still enforce key encoding limits", () => {
	for (const key of ["atom", "string", "char-string"]) {
		const packer = new Packer({ encoding: { key, undefined: "ignore" } });
		assert.throws(() => packer.pack({ ["a".repeat(65536)]: undefined }), RangeError);
		assert.deepEqual(new Unpacker().unpack(packer.pack({ keep: 7 })), { keep: 7 });
	}
});

test("UTF-8 encoding handles code points, BOM and unpaired surrogates", () => {
	for (const suffix of ["\0\x7F\u0080\u07FF\u0800\uFFFF", "\uFEFFé€😀", "\u{10000}\u{10FFFF}", "\uD800", "\uDC00", "\uD800a", "\uD800\uD800\uDC00", "\uDC00\uD800"]) {
		for (const length of [0, 29, 30, 31, 32]) {
			const text = "a".repeat(length) + suffix;
			const expected = Buffer.from(text).toString();
			for (const string of ["string", "binary"]) {
				const options = { poolSize: 24, encoding: { string }, decoding: { string: "utf8", binary: "utf8" } };
				assert.deepEqual(roundtrip([text, 65], options), [expected, 65]);
			}
			for (const key of ["atom", "string", "binary"]) {
				assert.deepEqual(roundtrip({ [text]: 65 }, { poolSize: 24, encoding: { key }, decoding: { stringKey: "utf8", binaryKey: "utf8" } }), { [expected]: 65 });
			}
		}
	}
});

test("char-string truncates UTF-16 code units and enforces the 16-bit byte limit", () => {
	const unpacker = new Unpacker({ decoding: { string: "array" } });
	for (const poolSize of [24, 128]) {
		const packer = new Packer({ poolSize, encoding: { string: "char-string" } });
		for (const [text, bytes] of [
			["", []],
			["\0éÿĀ😀", [0, 233, 255, 0, 61, 0]],
			["\uD800a\uDC00", [0, 97, 0]]
		]) {
			assert.deepEqual(packer.pack(text), frame([107, 0, bytes.length, ...bytes]));
			assert.deepEqual(unpacker.unpack(packer.pack([7, text, 9])), [7, bytes, 9]);
		}
		const previous = packer.pack("prefix");
		assert.deepEqual(unpacker.unpack(packer.pack("é".repeat(65535))), Array(65535).fill(233));
		assert.throws(() => packer.pack("a".repeat(65536)), RangeError);
		assert.throws(() => packer.pack("😀".repeat(32768)), RangeError);
		assert.deepEqual(unpacker.unpack(packer.pack({ before: 7, text: "Ā😀", after: 9 })), { before: 7, text: [0, 61, 0], after: 9 });
		assert.deepEqual(unpacker.unpack(previous), [112, 114, 101, 102, 105, 120]);
	}
});

test("char-list encodes Unicode scalar values with proper list tails", () => {
	const packer = new Packer({ poolSize: 24, encoding: { string: "char-list" } });
	const unpacker = new Unpacker();
	for (const [text, term, points] of [
		["", [108, 0, 0, 0, 0, 106], []],
		["\0éÿ", [108, 0, 0, 0, 3, 97, 0, 97, 233, 97, 255, 106], [0, 233, 255]],
		["Ā", [108, 0, 0, 0, 1, 98, 0, 0, 1, 0, 106], [256]],
		["a😀ÿ", [108, 0, 0, 0, 3, 97, 97, 98, 0, 1, 246, 0, 97, 255, 106], [97, 128512, 255]],
		["\uD800a\uDC00", [108, 0, 0, 0, 3, 98, 0, 0, 255, 253, 97, 97, 98, 0, 0, 255, 253, 106], [65533, 97, 65533]],
		["\uD800\uD800\uDC00", [108, 0, 0, 0, 2, 98, 0, 0, 255, 253, 98, 0, 1, 0, 0, 106], [65533, 65536]],
		["\uDC00\uD800", [108, 0, 0, 0, 2, 98, 0, 0, 255, 253, 98, 0, 0, 255, 253, 106], [65533, 65533]],
		["\uD7FF\uE000", [108, 0, 0, 0, 2, 98, 0, 0, 215, 255, 98, 0, 0, 224, 0, 106], [55295, 57344]],
		["\u{10FFFF}", [108, 0, 0, 0, 1, 98, 0, 16, 255, 255, 106], [1114111]]
	]) {
		assert.deepEqual(packer.pack(text), frame(term));
		assert.deepEqual(unpacker.unpack(packer.pack([7, text, 9])), [7, points, 9]);
	}
});

test("char-list preserves large element counts, surrounding terms and prior packets", () => {
	for (const poolSize of [24, 128]) {
		const packer = new Packer({ poolSize, encoding: { string: "char-list" } });
		const unpacker = new Unpacker();
		const previous = packer.pack([3, "prefix", 5]);
		for (const [text, points] of [
			["é".repeat(65535), Array(65535).fill(233)],
			["a".repeat(65536), Array(65536).fill(97)],
			["a".repeat(65535) + "😀", [...Array(65535).fill(97), 128512]],
			["😀".repeat(32768), Array(32768).fill(128512)]
		]) {
			assert.deepEqual(unpacker.unpack(packer.pack(text)), points);
			assert.deepEqual(unpacker.unpack(packer.pack({ before: 7, text, after: 9 })), { before: 7, text: points, after: 9 });
		}
		assert.deepEqual(unpacker.unpack(previous), [3, [112, 114, 101, 102, 105, 120], 5]);
		assert.deepEqual(unpacker.unpack(packer.pack("after")), [97, 102, 116, 101, 114]);
	}
});

test("UTF-8 decoding replaces invalid sequences without reading the next term", () => {
	const suffixes = [
		[0x80], [0xC0, 0xAF], [0xC2], [0xE2], [0xE2, 0x82], [0xF0], [0xF0, 0x9F], [0xF0, 0x9F, 0x91],
		[0xC2, 65], [0xE2, 0x82, 65], [0xF0, 0x9F, 65], [0xE0, 0x80, 0x80], [0xED, 0xA0, 0x80],
		[0xF0, 0x80, 0x80, 0x80], [0xF4, 0x90, 0x80, 0x80], [0xF5, 0x80, 0x80, 0x80],
		[0xC2, 0x80], [0xE0, 0xA0, 0x80], [0xED, 0x9F, 0xBF], [0xF4, 0x8F, 0xBF, 0xBF],
		[0x80, 65, 66, 67, 68, 69], [0xE2, 0x82, 65, 66, 67, 68, 69],
		[0xF0, 0x9F, 0x91, 0xA9, 65, 66, 67, 68, 0xC2]
	];
	const unpacker = new Unpacker({ decoding: { string: "utf8", binary: "utf8", bitbinary: "utf8", binaryKey: "utf8" } });
	for (const prefix of [...Array.from({ length: 18 }, (_, i) => i), 31, 32, 199, 200]) {
		for (const suffix of suffixes) {
			const bytes = [...Array(prefix).fill(97), ...suffix];
			const expected = Buffer.from(bytes).toString();
			for (const type of [107, 109, 77, 118, 119]) {
				const term = textTerm(type, bytes);
				assert.deepEqual(unpacker.unpack(frame([104, 3, ...term, ...textTerm(109, Array(32).fill(97)), 97, 65])), [expected, "a".repeat(32), 65]);
				assert.equal(unpacker.unpack(frame(term)), expected);
			}
			assert.deepEqual(unpacker.unpack(frame([116, 0, 0, 0, 1, ...textTerm(109, bytes), 97, 65])), { [expected]: 65 });
		}
	}
});

test("string, binary and bitbinary decoding modes preserve bytes and result types", () => {
	for (const [type, option] of [[107, "string"], [109, "binary"], [77, "bitbinary"]]) {
		for (const length of [...Array.from({ length: 18 }, (_, i) => i), 31, 32, 12001]) {
			const bytes = Uint8Array.from({ length }, (_, i) => i & 255);
			for (const mode of ["utf8", "latin1", "buffer", "uint8array", "array"]) {
				const unpacker = new Unpacker({ decoding: { [option]: mode } });
				const actual = unpacker.unpack(frame(textTerm(type, bytes)));
				const expected = mode === "utf8" || mode === "latin1" ? Buffer.from(bytes).toString(mode) : mode === "buffer" ? Buffer.from(bytes) : mode === "array" ? Array.from(bytes) : bytes;
				assert.deepEqual(actual, expected);
				if(mode === "uint8array") { assert.equal(Buffer.isBuffer(actual), false); }
				unpacker.unpack(frame(textTerm(type, new Uint8Array(length).fill(42))));
				assert.deepEqual(actual, expected);
			}
		}
	}
	for (const type of [107, 109]) {
		assert.equal(new Unpacker().unpack(frame(textTerm(type, []))), "");
	}
});

test("Latin-1 tails preserve exact byte values and the following term", () => {
	const unpacker = new Unpacker({ decoding: { binary: "latin1", binaryKey: "latin1", bitbinary: "latin1" } });
	for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 256, 257, 258, 259]) {
		const bytes = Array.from({ length }, (_, i) => [0x80, 0x9F, 0xFF, 0, 0xE9, 0x81, 0x7F, 0xFE, 0x91][i % 9]);
		const expected = String.fromCharCode(...bytes);
		for (const type of [100, 115, 107, 109, 77]) {
			if(type === 115 && length > 255) { continue; }
			const term = textTerm(type, bytes);
			assert.deepEqual(unpacker.unpack(frame([104, 2, ...term, 97, 65])), [expected, 65]);
			if(type !== 77) {
				assert.deepEqual(unpacker.unpack(frame([104, 2, 116, 0, 0, 0, 1, ...term, 97, 7, 97, 65])), [{ [expected]: 7 }, 65]);
			}
		}
	}
});

test("typed-array and DataView encoding respects byte offsets and byte lengths", () => {
	const storage = Uint8Array.from({ length: 64 }, (_, i) => i + 32);
	const views = [Buffer.from(storage.buffer, 8, 16), new DataView(storage.buffer, 8, 16)];
	for (const Type of [Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array]) {
		views.push(new Type(storage.buffer, 8, 16 / Type.BYTES_PER_ELEMENT));
	}
	for (const value of views) {
		const expected = new Uint8Array(storage.buffer, 8, 16);
		assert.deepEqual(roundtrip(value, { decoding: { binary: "uint8array" } }), expected);
		assert.equal(roundtrip(value, { encoding: { buffer: "string" } }), Buffer.from(expected).toString());
	}
});

test("bitbinary stores significant bits and shifts only the last byte", () => {
	const packer = new Packer({ encoding: { buffer: "bitbinary" } });
	assert.deepEqual(packer.pack(new Uint8Array()), frame([109, 0, 0, 0, 0]));
	for (let last = 0; last < 256; last++) {
		const bits = last.toString(2).length;
		assert.deepEqual(packer.pack(Uint8Array.of(65, last)), frame([77, 0, 0, 0, 2, bits, 65, (last << (8 - bits)) & 255]));
	}
	for (const length of [1, 5, 6, 12001]) {
		for (let bits = 1; bits <= 8; bits++) {
			const bytes = Array(length).fill(65);
			bytes[length - 1] = 255;
			const expected = [...bytes];
			expected[length - 1] >>>= 8 - bits;
			for (const bitbinary of ["utf8", "latin1", "buffer", "uint8array", "array"]) {
				const value = bitbinary === "utf8" || bitbinary === "latin1" ? Buffer.from(expected).toString(bitbinary) : bitbinary === "buffer" ? Buffer.from(expected) : bitbinary === "array" ? expected : Uint8Array.from(expected);
				const packet = frame([104, 2, 77, ...u32(length), bits, ...bytes, 97, 66]);
				const original = packet.slice();
				const unpacker = new Unpacker({ decoding: { bitbinary } });
				assert.deepEqual(unpacker.unpack(packet), [value, 66]);
				assert.deepEqual(packet, original);
				assert.deepEqual(unpacker.unpack(packet), [value, 66]);
			}
		}
	}
});

test("bitbinary text preserves UTF-8 boundaries when appending a partial byte", () => {
	for (const prefix of [[], [0xC3], [0xE2, 0x82], [0xF0, 0x9F, 0x98], [0x80], [0xEF, 0xBB, 0xBF]]) {
		for (const padding of [0, 19, 64, 12001]) {
			for (const bits of [1, 7, 8]) {
				const bytes = [...Array(padding).fill(65), ...prefix, 0xA9];
				const expected = [...bytes];
				expected[expected.length - 1] >>= 8 - bits;
				const unpacker = new Unpacker({ decoding: { bitbinary: "utf8" } });
				assert.deepEqual(unpacker.unpack(frame([104, 2, 77, ...u32(bytes.length), bits, ...bytes, 97, 66])), [Buffer.from(expected).toString("utf8"), 66]);
			}
		}
	}
});

test("decoder reuse handles scratch boundaries and offset Buffer/Uint8Array inputs", () => {
	for (const binary of ["utf8", "latin1"]) {
		const unpacker = new Unpacker({ decoding: { binary } });
		for (const length of [10, 12000, 12001, 10, 24000]) {
			const bytes = Buffer.alloc(length, 0xE9);
			const packet = Buffer.from(frame(textTerm(109, bytes)));
			const padded = Buffer.concat([Buffer.alloc(13, 255), packet, Buffer.alloc(7, 255)]);
			const buffer = padded.subarray(13, 13 + packet.length);
			for (const input of [buffer, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)]) {
				assert.equal(unpacker.unpack(input), bytes.toString(binary));
			}
		}
	}
});

test("string and binary key charsets are independent of value decoding", () => {
	for (const [type, option, keyOption, bytes] of [[107, "string", "stringKey", [99, 97, 102, 233]], [109, "binary", "binaryKey", [99, 97, 102, 195, 169]]]) {
		for (const mode of ["utf8", "latin1", "buffer", "uint8array", "array"]) {
			const packet = frame([116, 0, 0, 0, 1, ...textTerm(type, bytes), ...textTerm(type, [65, 66])]);
			const value = mode === "utf8" || mode === "latin1" ? "AB" : mode === "buffer" ? Buffer.from("AB") : mode === "array" ? [65, 66] : Uint8Array.of(65, 66);
			assert.deepEqual(new Unpacker({ decoding: { [option]: mode } }).unpack(packet), { café: value });
			for (const keyMode of ["utf8", "latin1"]) {
				const key = Buffer.from(bytes).toString(keyMode);
				assert.deepEqual(new Unpacker({ decoding: { [option]: mode, [keyOption]: keyMode } }).unpack(packet), { [key]: value });
			}
		}
	}
	const packet = frame([116, 0, 0, 0, 2, ...textTerm(107, [99, 97, 102, 195, 169]), ...textTerm(107, [233]), ...textTerm(109, [233]), ...textTerm(109, [195, 169])]);
	assert.deepEqual(new Unpacker({ decoding: { stringKey: "utf8", binaryKey: "latin1", binary: "utf8" } }).unpack(packet), { café: "é", é: "é" });
	const mixed = frame([116, 0, 0, 0, 3, ...textTerm(119, [110, 117, 108, 108]), 97, 1, ...textTerm(107, [97]), 97, 2, 104, 1, ...textTerm(109, [65, 66]), 97, 3]);
	assert.deepEqual(new Unpacker().unpack(mixed), { null: 1, a: 2, AB: 3 });
});

test("default atom substitutions apply to values, not keys", () => {
	const atoms = { true: true, false: false, undefined, null: null, nil: null, nan: NaN, infinity: Infinity, positive_infinity: Infinity, negative_infinity: -Infinity, NaN: "NaN", Infinity: "Infinity" };
	for (const type of [100, 115, 118, 119]) {
		const unpacker = new Unpacker();
		for (const [name, value] of Object.entries(atoms)) {
			const atom = textTerm(type, Buffer.from(name));
			const packet = frame([104, 2, ...atom, 116, 0, 0, 0, 1, ...atom, ...atom]);
			for (let repeat = 0; repeat < 2; repeat++) {
				assert.deepEqual(unpacker.unpack(packet), [value, { [name]: value }]);
			}
		}
	}
});

test("custom atom substitutions never change object key names", () => {
	const symbol = Symbol("key");
	const replacement = { custom: true };
	const names = ["", "\0", "a", "b", "c", "d", "e", "f", "é", "ÿ", "ab", "abc", "undef", "undefx", "café", "__proto__", "fresh", "fresx", "abcdefgh", "abcdefghi", "longSymbol", "longUndefined", "longNumber", "longProto", "longFresh", "longFresx", "ééééé", "ééééééééé"];
	for (const cacheKeys of [false, true]) for (const cacheAtoms of [false, true]) for (const type of [100, 115, 118, 119, 107, 109]) {
		const atomTable = { "": undefined, "\0": null, a: false, b: 0, c: "", d: null, e: symbol, f: replacement, "é": 17, "ÿ": false, ab: 42, abc: "longer", abcdefghi: false, longSymbol: replacement };
		const unpacker = new Unpacker({ atomTable, cacheKeys, cacheAtoms });
		for (const name of names) {
			const term = textTerm(type, Buffer.from(name, type === 100 || type === 115 || type === 107 ? "latin1" : "utf8"));
			const atom = type !== 107 && type !== 109;
			const value = atom && Object.hasOwn(atomTable, name) ? atomTable[name] : name;
			const packet = frame([104, 2, ...term, 116, 0, 0, 0, 1, ...term, ...term]);
			for (let repeat = 0; repeat < 2; repeat++) {
				assert.deepEqual(unpacker.unpack(packet), [value, { [name]: value }]);
			}
		}
	}
});

test("numeric key caches distinguish byte lengths, six-byte chunks and charsets", () => {
	for (const decoding of [{}, { stringKey: "utf8", binaryKey: "latin1" }]) {
		for (const cacheKeys of [false, true]) {
			const unpacker = new Unpacker({ cacheKeys, cacheAtoms: true, decoding });
			for (const length of [...Array.from({ length: 36 }, (_, i) => i), 63, 120, 250]) {
				const rows = [Buffer.alloc(length), Buffer.alloc(length, 255), Buffer.alloc(length, 128)];
				for (let i = 0; i < length; i += 6) {
					const bytes = Buffer.alloc(length, 255);
					bytes[i] = 254;
					rows.push(bytes);
				}
				for (const type of [100, 115, 118, 119, 107, 109]) {
					const charset = type === 100 || type === 115 ? "latin1" : type === 107 ? decoding.stringKey ?? "latin1" : type === 109 ? decoding.binaryKey ?? "utf8" : "utf8";
					const expected = {};
					const terms = [];
					for (let i = 0; i < rows.length; i++) {
						expected[rows[i].toString(charset)] = i;
						terms.push(...textTerm(type, rows[i]), 97, i);
					}
					const packet = frame([104, 2, 116, ...u32(rows.length), ...terms, 97, 193]);
					for (let repeat = 0; repeat < 3; repeat++) {
						assert.deepEqual(unpacker.unpack(packet), [expected, 193]);
					}
				}
			}
		}
	}
});

test("atom Map chains preserve substitutions and unknown atoms across encodings", () => {
	const values = [undefined, null, false, 0, "", NaN, Symbol("atom"), { replacement: true }];
	const names = ["", "\0", "é", "ÿ", "Ā", "😀", "__proto__", "constructor", ...Array.from({ length: 40 }, (_, i) => "a".repeat(i + 1)), "z".repeat(256)];
	const atomTable = Object.freeze(Object.fromEntries([...names.map((name, i) => [name, values[i % values.length]]), ["\uD800", 99]]));
	for (const cacheAtoms of [false, true]) {
		const unpacker = new Unpacker({ atomTable, cacheAtoms, cacheKeys: true });
		for (const type of [100, 115, 118, 119]) {
			const charset = type < 118 ? "latin1" : "utf8";
			const rows = names.filter(name => charset === "utf8" || [...name].every(char => char.codePointAt(0) <= 255)).map(name => Buffer.from(name, charset));
			rows.push(Buffer.from("fresh"), Buffer.from("hasOwnProperty"), Buffer.from("\uFFFD", charset));
			if(charset === "utf8") { rows.push(Buffer.from([255]), Buffer.from([192, 128])); }
			for (let repeat = 0; repeat < 3; repeat++) {
				for (const bytes of rows) {
					if((type === 115 || type === 119) && bytes.length > 255) { continue; }
					const name = bytes.toString(charset);
					const value = Object.hasOwn(atomTable, name) ? atomTable[name] : name;
					const term = textTerm(type, bytes);
					assert.deepEqual(unpacker.unpack(frame([104, 3, ...term, 116, 0, 0, 0, 1, ...term, 97, 7, 97, 193])), [value, { [name]: 7 }, 193]);
				}
			}
		}
	}
});

test("non-Latin1 atom names cannot overwrite Latin1 substitutions", () => {
	const atomTable = { "\0": "nul", "Ā": "wide", "abcdef\0": false, "abcdefĀ": true, "abcdef\0tail": 0, "abcdefĀtail": 1 };
	for (const cacheAtoms of [false, true]) {
		const unpacker = new Unpacker({ atomTable, cacheAtoms });
		for (const type of [100, 115]) {
			for (const [name, expected] of [["\0", "nul"], ["abcdef\0", false], ["abcdef\0tail", 0], ["unknown\0", "unknown\0"]]) {
				const bytes = Buffer.from(name, "latin1");
				for (let repeat = 0; repeat < 2; repeat++) {
					assert.equal(unpacker.unpack(frame(textTerm(type, bytes))), expected);
				}
			}
		}
	}
});

test("lone-surrogate atom names cannot replace valid UTF8 substitutions", () => {
	for (const explicitReplacement of [false, true]) {
		const atomTable = {
			"😀": "astral", "x😀y": "paired",
			...(explicitReplacement ? { "\uFFFD": false, "x\uFFFDy": 0, "abcdef\uFFFD": undefined } : {}),
			"\uD800": 99, "\uDC00": 99, "x\uD800y": 99, "abcdef\uDC00": 99, "\uD800\uD800": 99
		};
		for (const cacheAtoms of [false, true]) {
			const unpacker = new Unpacker({ atomTable, cacheAtoms });
			for (const type of [118, 119]) {
				for (const name of ["\uFFFD", "x\uFFFDy", "abcdef\uFFFD", "\uFFFD\uFFFD", "😀", "x😀y"]) {
					const expected = Object.hasOwn(atomTable, name) ? atomTable[name] : name;
					for (let repeat = 0; repeat < 2; repeat++) {
						assert.equal(unpacker.unpack(frame(textTerm(type, Buffer.from(name)))), expected);
					}
				}
			}
		}
	}
});

test("one-byte atoms, strings and binary keys preserve their charset", () => {
	for (const type of [100, 115, 118, 119, 107, 109]) {
		const unpacker = new Unpacker();
		for (let byte = 0; byte < 256; byte++) {
			const expected = Buffer.from([byte]).toString(type === 100 || type === 115 || type === 107 ? "latin1" : "utf8");
			const atom = textTerm(type, [byte]);
			assert.deepEqual(unpacker.unpack(frame([104, 2, ...atom, 116, 0, 0, 0, 1, ...atom, ...atom])), [expected, { [expected]: expected }]);
		}
		const empty = textTerm(type, []);
		assert.deepEqual(unpacker.unpack(frame([104, 3, ...empty, 116, 0, 0, 0, 1, ...empty, 97, 7, 97, 9])), ["", { "": 7 }, 9]);
	}
});

test("short key caches preserve zero and FF bytes at every byte position", () => {
	for (const type of [100, 115, 118, 119, 107, 109]) {
		const rows = [];
		for (let length = 2; length <= 8; length++) {
			rows.push(Array(length).fill(97));
			for (let depth = 0; depth < length; depth++) {
				for (const byte of [0, 255]) {
					const bytes = Array(length).fill(97);
					bytes[depth] = byte;
					rows.push(bytes);
				}
			}
		}
		const entries = rows.map((bytes, value) => ({
			key: Buffer.from(bytes).toString(type === 100 || type === 115 || type === 107 ? "latin1" : "utf8"),
			term: [...textTerm(type, bytes), 97, value]
		}));
		const expected = Object.fromEntries(entries.map(({ key }, value) => [key, value]));
		const map = [116, ...u32(entries.length), ...entries.flatMap(({ term }) => term)];
		const packet = frame([104, 3, ...map, ...map, 97, 9]);
		for (const cacheKeys of [false, true]) {
			const unpacker = new Unpacker({ cacheKeys });
			for (let repeat = 0; repeat < 3; repeat++) {
				assert.deepEqual(unpacker.unpack(packet), [expected, expected, 9]);
			}
		}
	}
});

test("character lists and other ETF keys become JavaScript property keys", () => {
	const unpacker = new Unpacker();
	for (const [term, key] of [
		[textTerm(107, [233]), "é"],
		[textTerm(109, [195, 169]), "é"],
		[textTerm(119, [195, 169]), "é"],
		[[108, 0, 0, 0, 1, 97, 233, 106], "é"],
		[[97, 42], "42"],
		[[104, 1, ...textTerm(109, [65])], "A"],
		[[106], ""],
		[textTerm(77, [65]), "65"]
	]) {
		const packet = frame([104, 2, 116, 0, 0, 0, 1, ...term, 97, 7, 97, 9]);
		for (let repeat = 0; repeat < 2; repeat++) {
			assert.deepEqual(unpacker.unpack(packet), [{ [key]: 7 }, 9]);
		}
	}
});

test("shared key caches distinguish Latin-1 bytes from UTF-8 and preserve malformed prefixes", () => {
	for (const cacheKeys of [false, true]) {
		const unpacker = new Unpacker({ cacheKeys, decoding: { stringKey: "latin1", binaryKey: "utf8" } });
		for (let repeat = 0; repeat < 3; repeat++) {
			for (const bytes of [[195, 169], [195], [195, 65], [97, 195], [97, 195, 65], [239, 191, 189]]) {
				for (const type of [107, 109, 100, 118]) {
					const expected = Buffer.from(bytes).toString(type === 107 || type === 100 ? "latin1" : "utf8");
					const packet = frame([104, 2, 116, 0, 0, 0, 1, ...textTerm(type, bytes), 97, 7, 97, 9]);
					assert.deepEqual(unpacker.unpack(packet), [{ [expected]: 7 }, 9]);
				}
			}
		}
	}
});

test("malformed UTF-8 keys preserve replacement characters across cache boundaries", () => {
	for (const cacheKeys of [false, true]) {
		const unpacker = new Unpacker({ cacheKeys, decoding: { stringKey: "utf8" } });
		for (let repeat = 0; repeat < 3; repeat++) {
			for (const bytes of [[128], [195], [239, 191, 189], [97, 195], [...Array(7).fill(97), 195], [...Array(8).fill(97), 195], [...Array(8).fill(97), 128]]) {
				const key = Buffer.from(bytes).toString("utf8");
				for (const type of [107, 109]) {
					const packet = frame([104, 2, 116, 0, 0, 0, 1, ...textTerm(type, bytes), 97, 7, 97, 9]);
					assert.deepEqual(unpacker.unpack(packet), [{ [key]: 7 }, 9]);
				}
			}
		}
	}
});

test("__proto__ map keys are own properties and cannot change object prototypes", () => {
	const payload = [116, 0, 0, 0, 1, ...textTerm(119, Buffer.from("isAdmin")), ...textTerm(119, Buffer.from("true"))];
	const keys = [100, 115, 118, 119, 107, 109].map(type => textTerm(type, Buffer.from("__proto__")));
	keys.push([104, 1, ...textTerm(107, Buffer.from("__proto__"))]);
	for (const key of keys) {
		for (const binary of ["utf8", "buffer"]) {
			const [object, next] = new Unpacker({ decoding: { binary } }).unpack(frame([104, 2, 116, 0, 0, 0, 1, ...key, ...payload, 97, 65]));
			assert.equal(Object.getPrototypeOf(object), Object.prototype);
			assert.equal(Object.hasOwn(object, "__proto__"), true);
			assert.deepEqual(object.__proto__, { isAdmin: true });
			assert.equal(object.isAdmin, undefined);
			assert.equal(next, 65);
		}
	}
});

test("cached keys preserve ETF bytes across encodings, pool reuse and failed writes", () => {
	const keys = ["", "abcd", "abcde", "abcdefgh", "abcdefghi", "__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "__defineGetter__", "\0éÿĀ😀\uD800a\uDC00", "é".repeat(31), "é".repeat(32), "中😀".repeat(40), "a".repeat(85), "a".repeat(86), "a".repeat(256)];
	const value = Object.fromEntries(keys.map(key => [key, 7]));
	value.ignoredLongKey = undefined;
	for (const key of [undefined, "atom", "binary", "string", "char-string"]) {
		const binary = key === undefined || key === "binary";
		for (const useLegacyAtoms of [false, true]) {
			const latin1 = key === "char-string" || key === "atom" && useLegacyAtoms;
			const charset = latin1 ? "latin1" : "utf8";
			const expected = Object.fromEntries(keys.map(name => [Buffer.from(name, charset).toString(charset), 7]));
			const options = { poolSize: 24, useLegacyAtoms, encoding: { key, undefined: "ignore" } };
			const reference = new Packer({ ...options, cacheKeys: false }).pack(value);
			const unpacker = new Unpacker({ decoding: { stringKey: key === "string" ? "utf8" : "latin1" } });
			assert.deepEqual(unpacker.unpack(reference), expected);
			for (const cacheKeys of [false, true]) {
				const packer = new Packer({ ...options, cacheKeys });
				const first = packer.pack(value);
				assert.deepEqual(first, reference);
				assert.deepEqual(unpacker.unpack(first), expected);
				for (let i = 0; i < 3; i++) {
					packer.pack("x".repeat(8192));
					assert.deepEqual(packer.pack(value), reference);
				}
				assert.deepEqual(first, reference);
				if(!binary) {
					assert.throws(() => packer.pack({ ["x".repeat(65536)]: 1 }), RangeError);
					assert.deepEqual(packer.pack(value), reference);
				}
			}
		}
	}
});

test("Latin-1 string keys use code-unit lengths and recover after overflow", () => {
	for (const cacheKeys of [false, true]) {
		const packer = new Packer({ poolSize: 24, cacheKeys, encoding: { key: "char-string" } });
		const unpacker = new Unpacker({ decoding: { string: "latin1" } });
		for (const key of ["é".repeat(65535), "😀".repeat(32767) + "ā"]) {
			const bytes = Buffer.from(key, "latin1");
			assert.deepEqual(packer.pack({ [key]: 7 }), frame([116, 0, 0, 0, 1, ...textTerm(107, [...bytes]), 97, 7]));
		}
		for (const key of ["é".repeat(65536), "😀".repeat(32768)]) {
			assert.throws(() => packer.pack({ [key]: 7 }), RangeError);
			assert.deepEqual(unpacker.unpack(packer.pack({ café: 9 })), { café: 9 });
		}
	}
});

test("16-bit text lengths use encoded bytes and reject overflow without corrupting reuse", () => {
	const boundaries = [
		["a".repeat(65535), "a".repeat(65536)],
		["é".repeat(32767) + "a", "é".repeat(32768)],
		["€".repeat(21845), "€".repeat(21845) + "a"],
		["😀".repeat(16383) + "aaa", "😀".repeat(16384)]
	];
	for (const [valid, overflow] of boundaries) {
		for (const key of ["atom", "string"]) {
			const packer = new Packer({ poolSize: 24, encoding: { key } });
			const unpacker = new Unpacker({ decoding: { stringKey: "utf8" } });
			assert.deepEqual(unpacker.unpack(packer.pack({ [valid]: 1 })), { [valid]: 1 });
			assert.throws(() => packer.pack({ [overflow]: 1 }), RangeError);
			assert.deepEqual(unpacker.unpack(packer.pack({ ok: 2 })), { ok: 2 });
		}
		const packer = new Packer({ poolSize: 24, encoding: { string: "string", buffer: "string" } });
		const unpacker = new Unpacker({ decoding: { string: "utf8" } });
		assert.equal(unpacker.unpack(packer.pack(valid)), valid);
		assert.throws(() => packer.pack(overflow), RangeError);
		assert.equal(unpacker.unpack(packer.pack(Buffer.from(valid))), valid);
		assert.throws(() => packer.pack(Buffer.from(overflow)), RangeError);
		assert.equal(roundtrip(overflow, { encoding: { string: "binary" }, decoding: { binary: "utf8" } }), overflow);
		assert.deepEqual(roundtrip({ [overflow]: 1 }), { [overflow]: 1 });
	}
	for (const useLegacyAtoms of [false, true]) {
		const packer = new Packer({ useLegacyAtoms, encoding: { key: "atom" } });
		const unpacker = new Unpacker();
		for (const length of [255, 256, 65535]) {
			const key = "a".repeat(length);
			assert.deepEqual(unpacker.unpack(packer.pack({ [key]: 1 })), { [key]: 1 });
		}
		assert.throws(() => packer.pack({ ["a".repeat(65536)]: 1 }), RangeError);
	}
	for (const length of [85, 86, 100]) {
		const key = "€".repeat(length);
		assert.deepEqual(roundtrip({ [key]: 1 }), { [key]: 1 });
	}
});

test("pool growth and compaction preserve packets, nested values and later writes", () => {
	const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i & 255);
	for (const poolSize of [24, 128]) {
		for (const array of ["tuple", "list", "improperlist"]) {
			const compacting = new Packer({ poolSize, encoding: { array } });
			const prefix = compacting.pack("a".repeat(20));
			const compacted = compacting.pack(["€".repeat(40), 65]);
			assert.deepEqual(new Unpacker({ decoding: { binary: "utf8" } }).unpack(compacted), ["€".repeat(40), 65]);
			assert.equal(new Unpacker({ decoding: { binary: "utf8" } }).unpack(prefix), "a".repeat(20));
			for (const string of ["string", "binary"]) {
				const packer = new Packer({ poolSize, encoding: { array, string } });
				const unpacker = new Unpacker({ decoding: { string: "utf8", binary: string === "binary" ? "utf8" : "uint8array" } });
				const value = { text: "€".repeat(1000), bytes: string === "binary" ? "bytes" : bytes, big: 1n << 8192n, nested: [true, { a: 7 }], list: Array(256).fill(3) };
				const packets = [packer.pack(7), packer.pack(value), packer.pack("next"), packer.pack(value)];
				assert.deepEqual(packets.map(packet => unpacker.unpack(packet)), [7, value, "next", value]);
			}
		}
	}
});

test("Node.js ESM without builtin loading rejects zlib but keeps other codecs usable", { skip: process.versions.bun ? "Bun supports require in ESM" : false }, () => {
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
		import assert from "node:assert/strict";
		import { deflateSync } from "node:zlib";
		import { Packer, Unpacker } from ${JSON.stringify(pathToFileURL(require.resolve("../esm/wetf.mjs")).href)};
		process.getBuiltinModule = undefined;
		const packet = Uint8Array.from([131, 80, 0, 0, 0, 2, ...deflateSync(Uint8Array.of(97, 7))]);
		const loaderError = error => error.constructor === Error;
		assert.throws(() => new Packer({ compression: "zlib" }), loaderError);
		assert.throws(() => new Unpacker({ decompression: "zlib" }).unpack(packet), loaderError);
		assert.throws(() => new Unpacker().unpack(packet), loaderError);
		const value = { text: "café 😀", count: 7 };
		assert.deepEqual(new Unpacker().unpack(new Packer().pack(value)), value);
		const compressed = await new Packer({ compression: "compressionstream" }).pack(value);
		assert.deepEqual(await new Unpacker({ decompression: "decompressionstream" }).unpack(compressed), value);
	`], { encoding: "utf8", timeout: 30000 });
	assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test("compression methods produce standard zlib frames with uncompressed sizes", async () => {
	const foreignDeflate = runInNewContext("data => Promise.resolve(codec(data))", { codec: deflateSync });
	const foreignInflate = runInNewContext("data => Promise.resolve(codec(data))", { codec: inflateSync });
	const cases = [
		[7, Buffer.from([97, 7])],
		["a".repeat(1000), Buffer.concat([Buffer.from([109, 0, 0, 3, 232]), Buffer.alloc(1000, 97)])],
		[new Uint8Array(70000).fill(97), Buffer.concat([Buffer.from([109, 0, 1, 17, 112]), Buffer.alloc(70000, 97)])]
	];
	for (const compression of [true, "zlib", "compressionstream", deflateSync, async data => deflateSync(data), foreignDeflate]) {
		const packer = new Packer({ poolSize: 128, compression });
		for (const [value, raw] of cases) {
			const packet = Buffer.from(await packer.pack(value));
			assert.deepEqual([...packet.subarray(0, 2)], [131, 80]);
			assert.equal(packet.readUInt32BE(2), raw.length);
			assert.deepEqual(inflateSync(packet.subarray(6)), raw);
		}
	}
	for (const [value, raw] of cases) {
		const packet = Buffer.concat([Buffer.from([131, 80, ...u32(raw.length)]), deflateSync(raw)]);
		for (const decompression of ["zlib", "decompressionstream", inflateSync, async data => inflateSync(data), foreignInflate]) {
			const unpacker = new Unpacker({ decompression, decoding: { binary: typeof value === "string" ? "utf8" : "uint8array" } });
			assert.deepEqual(await unpacker.unpack(packet), value);
			for (const size of [0, raw.length - 1, raw.length + 1, 0xFFFFFFFF]) {
				const invalid = Buffer.from(packet);
				invalid.writeUInt32BE(size, 2);
				await assert.rejects(async () => unpacker.unpack(invalid), RangeError);
			}
		}
	}
});

test("Web Streams decompression accepts shared input subviews", async () => {
	const raw = Buffer.from([109, 0, 0, 0, 6, ...Buffer.from("secret")]);
	const packet = Buffer.concat([Buffer.from([131, 80, ...u32(raw.length)]), deflateSync(raw)]);
	for(const backing of [
		new SharedArrayBuffer(packet.length + 16),
		runInNewContext("new SharedArrayBuffer(size)", { size: packet.length + 16 })
	]) {
		const input = new Uint8Array(backing, 7, packet.length);
		input.set(packet);
		const unpacker = new Unpacker({ decompression: "decompressionstream" });
		assert.equal(await unpacker.unpack(input), "secret");
	}
});

test("custom codec failures propagate and non-callable then properties are rejected", async () => {
	const packet = new Packer({ compression: true }).pack(7);
	const failure = new Error("codec failure");
	const reject = runInNewContext("() => Promise.reject(failure)", { failure });
	for (const codec of [reject, () => { throw failure; }]) {
		await assert.rejects(async () => new Packer({ compression: codec }).pack(7), error => error === failure);
		await assert.rejects(async () => new Unpacker({ decompression: codec }).unpack(packet), error => error === failure);
	}
	for (const then of [0, true, "not callable"]) {
		assert.throws(() => new Packer({ compression: () => ({ then }) }).pack(7), TypeError);
		assert.throws(() => new Unpacker({ decompression: () => ({ then }) }).unpack(packet), TypeError);
	}
	await assert.rejects(new Unpacker({ decompression: "decompressionstream" }).unpack(frame([80, 0, 0, 0, 2, 0])), TypeError);
});

test("out-of-order asynchronous compression keeps each packet's payload and size", async () => {
	const pending = [];
	const packer = new Packer({ poolSize: 128, compression: data => new Promise(resolve => {
		const compressed = deflateSync(data);
		pending.push(() => resolve(compressed));
	}) });
	const first = packer.pack(7);
	const second = packer.pack("a".repeat(1000));
	pending[1]();
	pending[0]();
	const packets = await Promise.all([first, second]);
	assert.deepEqual(packets.map(packet => Buffer.from(packet).readUInt32BE(2)), [2, 1005]);
	assert.deepEqual(packets.map(packet => new Unpacker({ decoding: { binary: "utf8" } }).unpack(packet)), [7, "a".repeat(1000)]);
});

test("classic-script bundles use TextEncoder/TextDecoder fallbacks and preserve UTF-8 BOM", async () => {
	for (const files of [["wetf"], ["packer", "unpacker"]]) {
		const context = { TextEncoder, TextDecoder, CompressionStream, DecompressionStream };
		for (const file of files) {
			runInNewContext(readFileSync(require.resolve(`../umd/${file}.js`), "utf8"), context);
		}
		const { Packer, Unpacker } = context.Wetf;
		for (const keyEncoding of [undefined, "atom", "char-string"]) {
			for (const useLegacyAtoms of [false, true]) {
				const key = "\0éÿĀ😀\uD800".repeat(10);
				const latin1 = keyEncoding === "char-string" || keyEncoding === "atom" && useLegacyAtoms;
				const bytes = [...Buffer.from(key, latin1 ? "latin1" : "utf8")];
				const type = keyEncoding === undefined ? 109 : keyEncoding === "char-string" ? 107 : useLegacyAtoms ? 115 : 119;
				const expected = [...frame([116, 0, 0, 0, 1, ...textTerm(type, bytes), 97, 7])];
				for (const cacheKeys of [false, true]) {
					const packer = new Packer({ cacheKeys, useLegacyAtoms, poolSize: 24, encoding: { key: keyEncoding } });
					assert.deepEqual([...packer.pack({ [key]: 7 })], expected);
					packer.pack(new Uint8Array(8192));
					assert.deepEqual([...packer.pack({ [key]: 7 })], expected);
				}
			}
		}
		for (const [string, text, expected] of [
			["char-string", "\0éÿĀ😀\uD800", [0, 233, 255, 0, 61, 0, 0]],
			["char-list", "\0éÿĀ😀\uD800", [0, 233, 255, 256, 128512, 65533]]
		]) {
			const packer = new Packer({ poolSize: 24, encoding: { string } });
			const unpacker = new Unpacker({ decoding: { string: "array" } });
			assert.equal(JSON.stringify(unpacker.unpack(packer.pack([7, text, 9]))), JSON.stringify([7, expected, 9]));
		}
		for (const browserStrictLatin1 of [undefined, false, true]) {
			for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 256, 257, 258, 259]) {
				const bytes = Array.from({ length }, (_, i) => browserStrictLatin1 === false ? (i * 41) & 127 : length === 256 ? i : [0x80, 0x9F, 0xFF, 0, 0xE9, 0x81, 0x7F, 0xFE, 0x91][i % 9]);
				const expected = Buffer.from(bytes).toString("latin1");
				const unpacker = new Unpacker({ browserStrictLatin1, decoding: { binary: "latin1", binaryKey: "latin1", bitbinary: "latin1" } });
				for (const type of [100, 107, 109, 77]) {
					const term = textTerm(type, bytes);
					assert.equal(JSON.stringify(unpacker.unpack(frame([104, 2, ...term, 97, 7]))), JSON.stringify([expected, 7]));
					if(type === 77) { continue; }
					const object = unpacker.unpack(frame([116, 0, 0, 0, 1, ...term, ...term]));
					assert.equal(object[expected], expected);
				}
			}
		}
		for (const text of ["héllo😀", "\uFEFF", "\uFEFF" + "é€😀".repeat(100), "\uD800", "a".repeat(32) + "\uD800"]) {
			const expected = Buffer.from(text).toString();
			assert.equal(new Unpacker().unpack(new Packer({ poolSize: 24 }).pack(text)), expected);
			for (const type of [118, 119]) {
				const bytes = Buffer.from(text);
				if(type === 119 && bytes.length > 255) { continue; }
				const atom = textTerm(type, bytes);
				const actual = new Unpacker().unpack(frame([104, 2, ...atom, 116, 0, 0, 0, 1, ...atom, ...atom]));
				assert.equal(JSON.stringify(actual), JSON.stringify([expected, { [expected]: expected }]));
			}
		}
		const value = { message: "héllo😀".repeat(100), count: 7, nested: { ok: true } };
		const packet = await new Packer({ compression: true }).pack(value);
		assert.equal(JSON.stringify(await new Unpacker().unpack(packet)), JSON.stringify(value));
	}
});

test("classic-script bundles decode malformed UTF-8 under a legacy script charset", () => {
	for(const files of [["wetf"], ["packer", "unpacker"]]) {
		const context = { TextEncoder, TextDecoder };
		const scriptDecoder = new TextDecoder("windows-1252");
		for(const file of files) {
			const source = readFileSync(require.resolve(`../umd/${file}.js`));
			runInNewContext(scriptDecoder.decode(source), context);
		}
		for(const cache of [false, true]) {
			const unpacker = new context.Wetf.Unpacker({ cacheKeys: cache, cacheAtoms: cache });
			for(const bytes of [[0xC3], [0xFF], [0xE0, 0x80, 0x80], [0xED, 0xA0, 0x80], [0xF0, 0x9F, 0x98]]) {
				const expected = new TextDecoder().decode(Uint8Array.from(bytes));
				for(const type of [109, 118, 119]) {
					const term = textTerm(type, bytes);
					assert.equal(unpacker.unpack(frame(term)), expected);
					const object = unpacker.unpack(frame([116, ...u32(1), ...term, 97, 7]));
					assert.equal(Object.keys(object)[0], expected);
					assert.equal(object[expected], 7);
				}
			}
		}
	}
});

test("browser decoding accepts large shared input subviews across realms", () => {
	class BrowserTextDecoder extends TextDecoder {
		decode(input, options) {
			// Browser TextDecoder rejects shared views; Node's TextDecoder accepts them.
			if(input && Object.prototype.toString.call(input.buffer) === "[object SharedArrayBuffer]") {
				throw new TypeError("TextDecoder input must not be shared");
			}
			return super.decode(input, options);
		}
	}
	for(const files of [["wetf"], ["packer", "unpacker"]]) {
		const context = { TextEncoder, TextDecoder: BrowserTextDecoder };
		for(const file of files) {
			runInNewContext(readFileSync(require.resolve(`../umd/${file}.js`), "utf8"), context);
		}
		for(const latin1 of [false, true]) {
			const unpacker = new context.Wetf.Unpacker({
				browserStrictLatin1: false,
				decoding: { binary: latin1 ? "latin1" : "utf8", binaryKey: latin1 ? "latin1" : "utf8" }
			});
			for(const length of [11994, 11995, 11996, 14000]) {
				const bytes = Buffer.alloc(length, latin1 ? 233 : 97);
				const text = bytes.toString(latin1 ? "latin1" : "utf8");
				for(const term of [
					textTerm(109, bytes),
					[116, ...u32(1), ...textTerm(109, bytes), 97, 7]
				]) {
					const packet = frame(term);
					for(const backing of [
						new SharedArrayBuffer(packet.length + 16),
						runInNewContext("new SharedArrayBuffer(size)", { size: packet.length + 16 })
					]) {
						const input = new Uint8Array(backing, 7, packet.length);
						input.set(packet);
						const actual = unpacker.unpack(input);
						assert.equal(typeof actual === "string" ? actual : Object.keys(actual)[0], text);
						if(typeof actual !== "string") { assert.equal(actual[text], 7); }
					}
				}
			}
		}
	}
});
