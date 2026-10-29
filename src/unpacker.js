class Unpacker {
	/**
	 * 
	 * @param {{
	 * 		decompression?: "zlib" | "decompressionstream" | ((data: Uint8Array | Buffer) => Uint8Array | Buffer | Promise<Uint8Array> | Promise<Buffer>);
	 * 		decoding?: {
	 * 			nil?: "null" | "array";
	 * 			string?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
	 * 			binary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
	 * 			binaryKey?: "utf8" | "latin1";
	 * 			bitbinary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
	 * 			safebigint?: "number" | "bigint" | "string";
	 * 			bigint?: "bigint" | "string";
	 * 		};
	 * 		atomTable?: Record<string, any>;
	 * 		atomKeyTable?: Record<string, any>;
	 * 		atomRegistration?: boolean
	 * }} options 
	 */
	constructor(options = {}) {
		/** @private */ this._decompressor = options.decompression;
		/** @private */ this._nilDecoding = ["null", "array"].indexOf(options.decoding?.nil?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._stringDecoding = ["utf8", "latin1", "buffer", "uint8array", "array"].indexOf(options.decoding?.string?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._binaryDecoding = ["utf8", "latin1", "buffer", "uint8array", "array"].indexOf(options.decoding?.binary?.toLowerCase() ?? "") + 1 || 4;
		/** @private */ this._binaryKeyDecoding = ["utf8", "latin1"].indexOf(options.decoding?.binaryKey?.toLowerCase() ?? "") + 1;
		/** @private */ this._bitbinaryDecoding = ["utf8", "latin1", "buffer", "uint8array", "array"].indexOf(options.decoding?.bitbinary?.toLowerCase() ?? "") + 1 || 4;
		/** @private */ this._safebigintDecoding = ["number", "bigint", "string"].indexOf(options.decoding?.safebigint?.toLowerCase() ?? "") + 1 || 2;
		/** @private */ this._bigintDecoding = ["bigint", "string"].indexOf(options.decoding?.bigint?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._atomRegistration = Boolean(options.atomRegistration ?? true);
		/** @private */ this._d = new Uint8Array(0);
		/** @private */ this._v = new DataView(this._d.buffer, this._d.byteOffset, this._d.length);
		/** @private */ this._sd = new Uint8Array(12000);
		/** @private */ this._sv = new DataView(this._sd.buffer, this._sd.byteOffset, this._sd.length);
		/** @private @type {Buffer | null} */ this._sb = null;
		/** @private @type {Buffer | null} */ this._b = null;
		/** @private */ this._i = 0;

		if(typeof process !== "undefined" && typeof process?.versions?.node === "string") {
			this._sb = Buffer.from(this._sd.buffer, this._sd.byteOffset, this._sd.length);
			this._b = this._sb;
			/** @private */ this._T = 15;
			if(!this._decompressor) { this._decompressor = "zlib"; }
		} else {
			const utfDecoder = new TextDecoder("utf8", { ignoreBOM: true });
			const latinDecoder = new TextDecoder("latin1");
			/** @private @type {TextDecoder["decode"]} */ this._u = utfDecoder.decode.bind(utfDecoder);
			/** @private @type {TextDecoder["decode"]} */ this._l = latinDecoder.decode.bind(latinDecoder);
			this._T = 32;
			if(typeof navigator === "object") {
				const agent = navigator.userAgent;
				if(agent.includes("Firefox")) { this._T = 4; } // for some reason firefox is stupid slow at manual decoding
				else if(agent.includes("Chrome")) { this._T = 200; } // manual decoding is super fast in chrome
			}
			if(!this._decompressor) { this._decompressor = "decompressionstream"; }
		}

		/** @private */ this._atoms = options.atomTable ?? {
			true: true,
			false: false,
			// eslint-disable-next-line no-undefined
			undefined: undefined,
			null: null,
			nil: null,
			nan: NaN,
			infinity: Infinity,
			positive_infinity: Infinity,
			negative_infinity: -Infinity
		};
		// Atom keys have no default substitutions.
		/** @private */ this._atomKeys = options.atomKeyTable ?? {};

		// Empty atoms resolve through trie slot 0.
		/** @private @type {*[]} */ this._atomTableLatin = [""];
		/** @private @type {*[]} */ this._atomTableUtf = [""];
		/** @private @type {*[]} */ this._atomKeyTableLatin = [""];
		/** @private @type {*[]} */ this._atomKeyTableUtf = [""];

		const encoder = new TextEncoder();
		for(const isKey of [false, true]) {
			/** @type {Record<string, any>} */ const atoms = isKey ? this._atomKeys : this._atoms;
			const latin = isKey ? this._atomKeyTableLatin : this._atomTableLatin;
			const utf = isKey ? this._atomKeyTableUtf : this._atomTableUtf;
			for(const [key, val] of Object.entries(atoms)) {
				if(key.length === 0) { latin[0] = utf[0] = val; continue; }
				const codes = encoder.encode(key);
				let t1 = latin[key.length] ??= [];
				let t2 = utf[codes.length] ??= [];
				for(let i = 0; i < key.length; i++) {
					const char1 = key.charCodeAt(i);
					t1 = t1[char1] ??= i === key.length - 1 ? val : [];
				}
				for(let i = 0; i < codes.length; i++) {
					const char2 = codes[i];
					t2 = t2[char2] ??= i === codes.length - 1 ? val : [];
				}
			}
			// Every one-byte atom is cached; explicit substitutions take precedence.
			const t1 = latin[1] ??= [];
			const t2 = utf[1] ??= [];
			for(let i = 0; i < 256; i++) {
				const char = String.fromCharCode(i);
				if(!(i in t1)) { t1[i] = char; }
				if(!(i in t2)) { t2[i] = i < 128 ? char : "\uFFFD"; }
			}
		}
	}

	/**
	 * 
	 * @param {Buffer | Uint8Array} data 
	 * @return {any}
	 */
	unpack(data) {
		const i = data[0] === 131 ? 1 : 0;
		if(data[i] === 80) {
			const size = data[i + 1] * 16777216 + (data[i + 2] << 16) + (data[i + 3] << 8) + data[i + 4];
			const raw = data.subarray(i + 5);
			if(this._decompressor === "zlib") {
				// @ts-ignore
				const zlib = typeof process?.getBuiltinModule === "function" ? process.getBuiltinModule("node:zlib") : require("node:zlib");
				const decomp = zlib.inflateSync(raw);
				if(decomp.length !== size) { throw new RangeError("Decompressed size does not match ETF header"); }
				return this.unpack(decomp);
			} else if(this._decompressor === "decompressionstream") {
				const decompression = new DecompressionStream("deflate");
				const reader = decompression.readable.getReader();
				const writer = decompression.writable.getWriter();
				const write = writer.ready.then(() => writer.write(raw)).then(() => writer.ready).then(() => writer.close());
				return Promise.all([write, this._decompressorStreamOut(reader)]).then(([, d]) => {
					if(d.length !== size) { throw new RangeError("Decompressed size does not match ETF header"); }
					return this.unpack(d);
				});
			} else if(typeof this._decompressor === "function") {
				const decomp = this._decompressor(raw);
				if("then" in decomp) {
					if(typeof decomp.then !== "function") { throw new TypeError("Custom decompressor returned a non-callable then"); }
					return decomp.then(d => {
						if(d.length !== size) { throw new RangeError("Decompressed size does not match ETF header"); }
						return this.unpack(d);
					});
				}
				if(decomp.length !== size) { throw new RangeError("Decompressed size does not match ETF header"); }
				return this.unpack(decomp);
			}
		}
		this._i = i;
		if(data.length <= this._sd.length) {
			this._sd.set(data);
			this._d = this._sd;
			this._v = this._sv;
			this._b = this._sb;
		} else {
			this._d = data;
			this._v = new DataView(data.buffer, data.byteOffset, data.length);
			if(this._b) { this._b = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.length); }
		}
		return this._loop();
	}

	/**
	 * @private 
	 */
	_loop() {
		const type = this._d[this._i++];
		switch(type) {
			case 70: { // float
				const float = this._v.getFloat64(this._i);
				this._i += 8;
				return float;
			}
			case 97: { // small int
				return this._d[this._i++];
			}
			case 98: { // int
				const int = this._v.getInt32(this._i);
				this._i += 4;
				return int;
			}
			case 100: case 115: case 118: case 119: { // atom
				const length = type === 100 || type === 118 ? (this._d[this._i++] << 8) + this._d[this._i++] : this._d[this._i++];
				return this._resolveAtom(length, type >= 118);
			}
			case 104: case 105: case 108: { // tuple / large tuple / list
				let length;
				if(type === 104) {
					length = this._d[this._i++];
				} else {
					length = this._v.getUint32(this._i);
					this._i += 4;
				}
				const array = Array(length);
				for(let i = 0; i < length; i++) {
					array[i] = this._loop();
				}
				if(type === 108) {
					if(this._d[this._i] === 106) { // proper list
						this._i++;
					} else { // improper list
						array.push(this._loop());
					}
				}
				return array;
			}
			case 106: { // nil
				return this._nilDecoding === 2 ? [] : null;
			}
			case 107: case 109: case 77: { // string / binary / bitbinary
				let length;
				let code;
				if(type === 107) {
					length = (this._d[this._i++] << 8) + this._d[this._i++];
					code = this._stringDecoding;
				} else if(type === 109) {
					length = this._v.getUint32(this._i);
					code = this._binaryDecoding;
					this._i += 4;
				} else {
					length = this._v.getUint32(this._i);
					code = this._bitbinaryDecoding;
					const bits = this._d[this._i + 4];
					this._i += 5;
					const byte = this._d[this._i + length - 1];
					this._d[this._i + length - 1] = byte >> (8 - bits);
				}
				if(code === 5) {
					const array = Array(length);
					for(let i = 0; i < length; i++) {
						array[i] = this._d[this._i + i];
					}
					this._i += length;
					return array;
				} else if(code > 2) {
					const slice = this._d.subarray(this._i, this._i + length);
					this._i += length;
					if(code === 3) {
						const buffer = Buffer.allocUnsafe(length);
						buffer.set(slice);
						return buffer;
					}
					const uint8 = new Uint8Array(length);
					uint8.set(slice);
					return uint8;
				}
				return code === 2 ? this._latin(length) : this._utf(length);
			}
			case 110: case 111: { // bigint / bigbigint
				let length;
				if(type === 110) {
					length = this._d[this._i++];
				} else {
					length = this._v.getUint32(this._i);
					this._i += 4;
				}
				if(length === 0) {
					this._i += 1;
					return this._safebigintDecoding === 3 ? "0" : this._safebigintDecoding === 1 ? 0 : 0n;
				}
				if(length === 1 && this._d[this._i + 1] === 0) {
					this._i += 2;
					return this._safebigintDecoding === 3 ? "0" : this._safebigintDecoding === 1 ? 0 : 0n;
				}
				const sign = this._d[this._i++];
				if(length < 7 || (length === 7 && this._d[this._i + 6] < 32)) {
					let num = 0;
					if(length === 1) {
						num = this._d[this._i];
					} else if(length === 2) {
						num = (this._d[this._i + 1] << 8) + this._d[this._i];
					} else if(length === 3) {
						num = (this._d[this._i + 2] << 16) + (this._d[this._i + 1] << 8) + this._d[this._i];
					} else if(length === 4) {
						num = this._v.getUint32(this._i, true);
					} else if(length === 5) {
						num = (this._d[this._i + 4] * 4294967296) + this._v.getUint32(this._i, true);
					} else if(length === 6) {
						num = (((this._d[this._i + 5] << 8) + this._d[this._i + 4]) * 4294967296) + this._v.getUint32(this._i, true);
					} else {
						num = (((this._d[this._i + 6] << 16) + (this._d[this._i + 5] << 8) + this._d[this._i + 4] ) * 4294967296) + this._v.getUint32(this._i, true);
					}
					this._i += length;
					if(sign) { num = -num; }
					return this._safebigintDecoding === 3 ? num.toString() : this._safebigintDecoding === 1 ? num : BigInt(num);
				}
				let num;
				if(length === 8) {
					num = this._v.getBigUint64(this._i, true);
				} else {
					let left = length;
					num = 0n;
					while(left > 0) {
						if(left >= 8) {
							num <<= 64n;
							num += this._v.getBigUint64(this._i + (left -= 8), true);
						} else if(left >= 4) {
							num <<= 32n;
							num += BigInt(this._v.getUint32(this._i + (left -= 4), true));
						} else if(left >= 2) {
							num <<= 16n;
							num += BigInt(this._v.getUint16(this._i + (left -= 2), true));
						} else {
							num <<= 8n;
							num += BigInt(this._d[this._i]);
							left--;
						}
					}
				}
				this._i += length;
				if(sign) { num = -num; }
				return this._bigintDecoding === 2 ? num.toString() : num;
			}
			case 116: { // object
				/** @type {Record<PropertyKey, any>} */ const obj = {};
				const length = this._v.getUint32(this._i);
				this._i += 4;
				for(let i = 0; i < length; i++) {
					let key;
					const keyType = this._d[this._i];
					if(this._binaryKeyDecoding && keyType === 109) {
						const keyLength = this._v.getUint32(this._i + 1);
						this._i += 5;
						key = this._binaryKeyDecoding === 2 ? this._latin(keyLength) : this._utf(keyLength);
					} else {
						if(keyType === 100 || keyType === 115 || keyType === 118 || keyType === 119) {
							const wide = keyType === 100 || keyType === 118;
							const keyLength = wide ? (this._d[this._i + 1] << 8) + this._d[this._i + 2] : this._d[this._i + 1];
							this._i += wide ? 3 : 2;
							key = this._resolveAtom(keyLength, keyType >= 118, true);
						} else {
							key = this._loop();
						}
						if(typeof key !== "string" && typeof key !== "symbol") { key = String(key); }
					}
					// Preserve __proto__ as map data instead of invoking the inherited setter.
					if(key === "__proto__") {
						Object.defineProperty(obj, key, { value: this._loop(), writable: true, enumerable: true, configurable: true });
					} else {
						obj[key] = this._loop();
					}
				}
				return obj;
			}
		}
		// console.log(this._d.slice(this._i - 20, this._i + 20));
		throw new Error(`Unexpected byte: ${type}`);
	}

	/**
	 * @private
	 * @param {number} length 
	 * @param {boolean} utf 
	 * @param {boolean} [key]
	 * @returns 
	 */
	_resolveAtom(length, utf, key = false) {
		const r = key ? (utf ? this._atomKeyTableUtf : this._atomKeyTableLatin) : (utf ? this._atomTableUtf : this._atomTableLatin);
		if(length === 1) { return r[1][this._d[this._i++]]; }
		if(length in r) {
			let t = r[length];
			let i = this._i;
			let n = 0;
			for(; n < length; n++) {
				const v = this._d[i++];
				const next = t[v];
				if(typeof next === "undefined" && !(v in t)) { break; }
				t = next;
			}
			if(n === length) {
				this._i += length;
				return t;
			}
		}
		if(this._atomRegistration) {
			return this._registerAtom(length, utf, key);
		}
		return utf ? this._utf(length) : this._latin(length);
	}

	/**
	 * @private
	 * @param {number} length 
	 * @param {boolean} utf 
	 * @param {boolean} [key]
	 * @returns {string}
	 */
	_registerAtom(length, utf, key = false) {
		const r = key ? (utf ? this._atomKeyTableUtf : this._atomKeyTableLatin) : (utf ? this._atomTableUtf : this._atomTableLatin);
		if(!(length in r)) {
			r[length] = [];
		}
		let t = r[length];
		let i = this._i;
		for(let n = 0; n < length; n++) {
			const v = this._d[i++];
			if(v in t) {
				t = t[v];
			} else if(n === length - 1) {
				t = t[v] = utf ? this._utf(length) : this._latin(length);
			} else {
				t = t[v] = [];
			}
		}
		if(key && t === "__proto__") {
			Object.defineProperty(this._atomKeys, t, { value: t, writable: true, enumerable: true, configurable: true });
		} else {
			(key ? this._atomKeys : this._atoms)[t] = t;
		}
		return t;
	}

	/**
	 * @private
	 * @param {number} length 
	 */
	_utf(length) {
		let str = "";
		let i = this._i;
		const data = this._d;
		if(length < this._T) {
			const l = i + length;
			while(i < l) {
				const byte = this._d[i++];
				if(byte < 128) {
					str += String.fromCharCode(byte);
					continue;
				}
				// Consume only a valid UTF-8 prefix; leave a bad continuation for the next iteration.
				if(byte < 194 || byte > 244) {
					str += "\uFFFD";
					continue;
				}
				const second = i < l ? data[i] : 0;
				if((second & 192) !== 128 ||
					(byte === 224 && second < 160) || (byte === 237 && second > 159) ||
					(byte === 240 && second < 144) || (byte === 244 && second > 143)) {
					str += "\uFFFD";
					continue;
				}
				i++;
				let point = ((byte & (byte < 224 ? 31 : byte < 240 ? 15 : 7)) << 6) | (second & 63);
				if(byte >= 224) {
					const third = i < l ? data[i] : 0;
					if((third & 192) !== 128) {
						str += "\uFFFD";
						continue;
					}
					i++;
					point = (point << 6) | (third & 63);
					if(byte >= 240) {
						const fourth = i < l ? data[i] : 0;
						if((fourth & 192) !== 128) {
							str += "\uFFFD";
							continue;
						}
						i++;
						point = (point << 6) | (fourth & 63);
					}
				}
				str += point < 65536 ? String.fromCharCode(point) : String.fromCodePoint(point);
			}
		} else {
			str = this._b ? this._b.toString("utf8", i, i + length) : this._u(data.subarray(i, i + length));
		}
		this._i += length;
		return str;
	}

	/**
	 * @private
	 * @param {number} length 
	 */
	_latin(length) {
		let str = "";
		const i = this._i;
		const data = this._d;
		if(length < this._T) {
			for(let n = i; n < i + length; n++) {
				str += String.fromCharCode(data[n]);
			}
		} else {
			str = this._b ? this._b.toString("latin1", i, i + length) : this._l(data.subarray(i, i + length));
		}
		this._i += length;
		return str;
	}

	/**
	 * @private
	 * @param {ReadableStreamDefaultReader} reader 
	 * @returns 
	 */
	async _decompressorStreamOut(reader) {
		const chunks = [];
		let size = 0;
		while(true) {
			const { done, value } = await reader.read();
			if(value) {
				chunks.push(value);
				size += value.length;
			}
			if(done) { break; }
		}
		const out = new Uint8Array(size);
		let n = 0;
		for(let i = 0; i < chunks.length; i++) {
			const c = chunks[i];
			out.set(c, n);
			n += c.length;
		}
		return out;
	}
}

Unpacker.Unpacker = Unpacker;
Unpacker.default = Unpacker;

module.exports = Unpacker;
