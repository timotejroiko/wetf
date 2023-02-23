class Unpacker {
	/**
	 * 
	 * @param {{
	 * 		decompression?: "zlib" | "decompressionstream" | ((data: Uint8Array | Buffer) => Uint8Array | Buffer | Promise<Uint8Array> | Promise<Buffer>);
	 * 		decoding?: {
	 * 			nil?: "null" | "array";
	 * 			string?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
	 * 			binary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
	 * 			bitbinary?: "utf8" | "latin1" | "buffer" | "uint8array" | "array";
	 * 			safebigint?: "number" | "bigint" | "string";
	 * 			bigint?: "bigint" | "string";
	 * 		};
	 * 		atomTable?: Record<string, any>;
	 * }} options 
	 */
	constructor(options = {}) {
		/** @private */ this._decompressor = options.decompression;
		/** @private */ this._nilDecoding = ["null", "array"].indexOf(options.decoding?.nil?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._stringDecoding = ["utf8", "latin1", "buffer", "uint8array", "array"].indexOf(options.decoding?.string?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._binaryDecoding = ["utf8", "latin1", "buffer", "uint8array", "array"].indexOf(options.decoding?.binary?.toLowerCase() ?? "") + 1 || 4;
		/** @private */ this._bitbinaryDecoding = ["utf8", "latin1", "buffer", "uint8array", "array"].indexOf(options.decoding?.bitbinary?.toLowerCase() ?? "") + 1 || 4;
		/** @private */ this._safebigintDecoding = ["number", "bigint", "string"].indexOf(options.decoding?.safebigint?.toLowerCase() ?? "") + 1 || 2;
		/** @private */ this._bigintDecoding = ["bigint", "string"].indexOf(options.decoding?.bigint?.toLowerCase() ?? "") + 1 || 1;

		if(typeof process !== "undefined" && typeof process?.versions?.node === "string") {
			const { StringDecoder } = require('node:string_decoder');
			const utfDecoder = new StringDecoder("utf8");
			const latinDecoder = new StringDecoder("latin1");
			/** @private */ this._u = utfDecoder.write.bind(utfDecoder);
			/** @private */ this._l = latinDecoder.write.bind(latinDecoder);
			/** @private */ this._T = 15; // StringDecoder is super fast
			if(!this._decompressor) { this._decompressor = "zlib"; }
		} else {
			const utfDecoder = new TextDecoder("utf8");
			const latinDecoder = new TextDecoder("latin1");
			this._u = utfDecoder.decode.bind(utfDecoder);
			this._l = latinDecoder.decode.bind(latinDecoder);
			this._T = 32;
			if(typeof navigator === "object") {
				const agent = navigator.userAgent;
				if(agent.includes("Firefox")) { this._T = 4; } // for some reason firefox is stupid slow at manual decoding
				else if(agent.includes("Chrome")) { this._T = 200; } // manual decoding is super fast in chrome
			}
			if(!this._decompressor) { this._decompressor = "decompressionstream"; }
		}
		/** @private */ this._d = new Uint8Array(0);
		/** @private */ this._v = new DataView(this._d.buffer, this._d.byteOffset, this._d.length);
		/** @private */ this._sd = new Uint8Array(12000);
		/** @private */ this._sv = new DataView(this._sd.buffer, this._sd.byteOffset, this._sd.length);
		/** @private */ this._i = 0;

		/** @private */ this._atoms = options.atomTable ?? {
			true: true,
			false: false,
			undefined: undefined,
			null: null,
			nil: null,
			nan: NaN,
			infinity: Infinity,
			positive_infinity: Infinity,
			negative_infinity: -Infinity
		};

		const encoder = new TextEncoder();
		/** @private */ this._atomTableLatin = Object.entries(this._atoms).reduce((a,o) => {
			const [key, val] = o;
			let t = a[key.length] ??= [];
			for(let i = 0; i < key.length; i++) {
				const char = key.charCodeAt(i);
				t = t[char] ??= i === key.length - 1 ? val : [];
			}
			return a;
		}, /** @type {any[]} */ ([]));

		/** @private */ this._atomTableUtf = Object.entries(this._atoms).reduce((a,o) => {
			const [key, val] = o;
			const codes = encoder.encode(key);
			let t = a[codes.length] ??= [];
			for(let i = 0; i < codes.length; i++) {
				const char = codes[i];
				t = t[char] ??= i === codes.length - 1 ? val : [];
			}
			return a;
		}, /** @type {any[]} */ ([]));
	}

	/**
	 * 
	 * @param {Buffer | Uint8Array} data 
	 * @return {any}
	 */
	unpack(data) {
		const i = data[0] === 131 ? 1 : 0;
		if(data[i] === 80) {
			const size = (data[i + 1] << 24) + (data[i + 2] << 16) + (data[i + 3] << 8) + data[i + 4];
			const raw = data.subarray(i + 5, i + 5 + size);
			if(this._decompressor === "zlib") {
				const zlib = require("zlib");
				const decomp = zlib.inflateSync(raw);
				return this.unpack(decomp);
			} else if(this._decompressor === "decompressionstream") {
				//@ts-expect-error missing from webstreams types?
				const decompression = new DecompressionStream("deflate");
				const reader = decompression.readable.getReader();
				const writer = decompression.writable.getWriter();
				writer.ready.then(() => writer.write(raw)).then(() => writer.ready).then(() => writer.close());
				return this._decompressorStreamOut(reader).then(data => this.unpack(data));
			} else if(typeof this._decompressor === "function") {
				let decomp = this._decompressor(raw);
				if(decomp instanceof Promise) {
					return decomp.then(data => this.unpack(data));
				}
				return this.unpack(decomp);
			}
		}
		this._i = i;
		if(data.length <= this._sd.length) {
			this._sd.set(data);
			this._d = this._sd;
			this._v = this._sv;
		} else {
			this._d = data;
			this._v = new DataView(data.buffer, data.byteOffset, data.length);
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
				return this._resolveAtom(length, type < 118);
			}
			case 108: { // list
				const length = this._v.getUint32(this._i);
				this._i += 4;
				const array = Array(length);
				for(let i = 0; i < length; i++) {
					array[i] = this._loop();
				}
				if(this._d[this._i] === 106) { // proper list
					this._i++;
				} else { // improper list
					array.push(this._loop());
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
					const byte = this._d[this._i + length - 1];
					this._d[this._i + length - 1] = byte >> (8 - bits);
					this._i += 5;
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
					} else {
						const uint8 = new Uint8Array(length);
						uint8.set(slice);
						return uint8;
					}
				} else {
					return code === 2 ? this._latin(length) : this._utf(length);
				}
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
				/** @type {Record<string, any>} */ const obj = {};
				const length = this._v.getUint32(this._i);
				this._i += 4;
				for(let i = 0; i < length; i++) {
					const key = this._loop();
					obj[key] = this._loop();
				}
				return obj;
			}
		}
		throw new Error(`Missing etf type: ${type}`);
	}

	/**
	 * @private
	 * @param {number} length 
	 * @param {boolean} utf 
	 * @returns 
	 */
	_resolveAtom(length, utf) {
		const r = utf ? this._atomTableUtf : this._atomTableLatin;
		if(length in r) {
			let t = r[length];
			let i = this._i;
			for(let n = 0; n < length; n++) {
				const v = this._d[i++];
				if(v in t) {
					if(n === length - 1) {
						this._i += length;
						return t[v];
					} else {
						t = t[v];
					}
				} else {
					break;
				}
			}
		}
		return utf ? this._utf(length) : this._latin(length);
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
				let byte = this._d[i++];
				if(byte < 128) { str += String.fromCharCode(byte); }
				else if(byte < 224) { str += String.fromCharCode(((byte & 31) << 6) + (data[i++] & 63)); }
				else if(byte < 240) { str += String.fromCharCode(((byte & 15) << 12) + ((data[i++] & 63) << 6) + (data[i++] & 63)); }
				else {
					const point = ((byte & 7) << 18) + ((data[i++] & 63) << 12) + ((data[i++] & 63) << 6) + (data[i++] & 63);
					const c1 = 55296 + ((point - 65536) >> 10);
					const c2 = 55296 + ((point - 65536) & 1023);
					str += String.fromCharCode(c1, c2);
				}
			}
		} else {
			str = this._u(data.subarray(i, i + length));
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
		let i = this._i;
		const data = this._d;
		if(length < this._T) {
			for(let n = i; n < i + length; n++) {
				str += String.fromCharCode(data[n]);
			}
		} else {
			str = this._l(data.subarray(i, i + length));
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

module.exports = Unpacker;