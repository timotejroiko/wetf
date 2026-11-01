export class Unpacker {
	constructor(options = {}) {
		this._decompressor = options.decompression;
		this._cacheKeys = Boolean(options.cacheKeys);
		this._cacheAtoms = Boolean(options.cacheAtoms);
		this._nilDecoding = [ "null", "array" ].indexOf(options.decoding?.nil?.toLowerCase() ?? "") + 1 || 2;
		this._stringDecoding = [ "utf8", "latin1", "buffer", "uint8array", "array" ].indexOf(options.decoding?.string?.toLowerCase() ?? "") + 1 || 2;
		this._stringKeyDecoding = [ "utf8", "latin1" ].indexOf(options.decoding?.stringKey?.toLowerCase() ?? "") + 1 || 2;
		this._binaryDecoding = [ "utf8", "latin1", "buffer", "uint8array", "array" ].indexOf(options.decoding?.binary?.toLowerCase() ?? "") + 1 || 1;
		this._binaryKeyDecoding = [ "utf8", "latin1" ].indexOf(options.decoding?.binaryKey?.toLowerCase() ?? "") + 1 || 1;
		this._bitbinaryDecoding = [ "utf8", "latin1", "buffer", "uint8array", "array" ].indexOf(options.decoding?.bitbinary?.toLowerCase() ?? "") + 1 || 4;
		this._safebigintDecoding = [ "number", "bigint", "string" ].indexOf(options.decoding?.safebigint?.toLowerCase() ?? "") + 1 || 1;
		this._bigintDecoding = [ "bigint", "string" ].indexOf(options.decoding?.bigint?.toLowerCase() ?? "") + 1 || 1;
		this._listDecoding = [ "array", "string" ].indexOf(options.decoding?.list?.toLowerCase() ?? "") + 1 || 1;
		this._browserStrictLatin1 = Boolean(options.browserStrictLatin1 ?? true);
		this._d = new Uint8Array(0);
		this._v = new DataView(this._d.buffer, this._d.byteOffset, this._d.length);
		this._sd = new Uint8Array(12e3);
		this._sv = new DataView(this._sd.buffer, this._sd.byteOffset, this._sd.length);
		this._sb = null;
		this._b = null;
		this._i = 0;
		if (typeof process !== "undefined" && typeof process?.versions?.node === "string") {
			this._sb = Buffer.from(this._sd.buffer, this._sd.byteOffset, this._sd.length);
			this._b = this._sb;
			this._T = typeof process.versions.bun === "string" ? 8 : 20;
			this._TL = typeof process.versions.bun === "string" ? 8 : 13;
			if (!this._decompressor) {
				this._decompressor = "zlib";
			}
		} else {
			const utfDecoder = new TextDecoder("utf8", {
				ignoreBOM: true
			});
			const latinDecoder = new TextDecoder("latin1");
			this._u = utfDecoder.decode.bind(utfDecoder);
			this._l = latinDecoder.decode.bind(latinDecoder);
			this._T = 32;
			this._TL = 32;
			if (typeof navigator === "object") {
				const agent = navigator.userAgent;
				if (agent.includes("Firefox")) {
					this._T = 32;
					this._TL = 40;
				} else if (agent.includes("Chrome")) {
					this._T = 64;
					this._TL = 128;
				}
			}
			if (!this._decompressor) {
				this._decompressor = "decompressionstream";
			}
		}
		this._atoms = options.atomTable ?? {
			true: true,
			false: false,
			undefined: void 0,
			null: null,
			nil: null,
			nan: NaN,
			infinity: Infinity,
			positive_infinity: Infinity,
			negative_infinity: -Infinity
		};
		this._atomTableLatin = [];
		this._atomTableUtf = [];
		this._keyTableLatin = [];
		this._keyTableUtf = [];
		if (this._cacheAtoms) {
			const encoder = new TextEncoder();
			for (const [ key, value ] of Object.entries(this._atoms)) {
				if (/[\uD800-\uDFFF]/u.test(key)) {
					continue;
				}
				for (const utf of [ true, false ]) {
					const bytes = utf ? encoder.encode(key) : Uint16Array.from({
						length: key.length
					}, (_, i) => key.charCodeAt(i));
					const table = utf ? this._atomTableUtf : this._atomTableLatin;
					const limit = utf || this._browserStrictLatin1 || this._sb ? 255 : 127;
					let node = table[bytes.length] ??= new Map();
					let id = 0;
					let i = 0;
					for (;i < bytes.length; i++) {
						if (bytes[i] > limit) {
							break;
						}
						id = id * 256 + bytes[i];
						if ((i + 1) % 6 === 0 && i + 1 < bytes.length) {
							if (!node.has(id)) {
								node.set(id, new Map());
							}
							node = node.get(id);
							id = 0;
						}
					}
					if (i === bytes.length) {
						node.set(id, value);
					}
				}
			}
		}
	}
	unpack(data) {
		const i = data[0] === 131 ? 1 : 0;
		if (data[i] === 80) {
			const size = data[i + 1] * 16777216 + (data[i + 2] << 16) + (data[i + 3] << 8) + data[i + 4];
			const raw = data.subarray(i + 5);
			if (this._decompressor === "zlib") {
				const zlib = typeof process?.getBuiltinModule === "function" ? process.getBuiltinModule("node:zlib") : require("node:zlib");
				const decomp = zlib.inflateSync(raw);
				if (decomp.length !== size) {
					throw new RangeError("Decompressed size does not match ETF header");
				}
				return this.unpack(decomp);
			} else if (this._decompressor === "decompressionstream") {
				const decompression = new DecompressionStream("deflate");
				const reader = decompression.readable.getReader();
				const writer = decompression.writable.getWriter();
				const write = writer.ready.then(() => writer.write(raw)).then(() => writer.ready).then(() => writer.close());
				return Promise.all([ write, this._decompressorStreamOut(reader) ]).then(([ , d ]) => {
					if (d.length !== size) {
						throw new RangeError("Decompressed size does not match ETF header");
					}
					return this.unpack(d);
				});
			} else if (typeof this._decompressor === "function") {
				const decomp = this._decompressor(raw);
				if ("then" in decomp) {
					if (typeof decomp.then !== "function") {
						throw new TypeError("Custom decompressor returned a non-callable then");
					}
					return decomp.then(d => {
						if (d.length !== size) {
							throw new RangeError("Decompressed size does not match ETF header");
						}
						return this.unpack(d);
					});
				}
				if (decomp.length !== size) {
					throw new RangeError("Decompressed size does not match ETF header");
				}
				return this.unpack(decomp);
			}
		}
		this._i = i;
		if (data.length <= this._sd.length) {
			this._sd.set(data);
			this._d = this._sd;
			this._v = this._sv;
			this._b = this._sb;
		} else {
			if (this._sb && Buffer.isBuffer(data)) {
				this._b = data;
				this._d = new Uint8Array(data.buffer, data.byteOffset, data.length);
			} else {
				this._d = data;
				this._b = this._sb ? Buffer.from(data.buffer, data.byteOffset, data.length) : null;
			}
			this._v = new DataView(this._d.buffer, this._d.byteOffset, this._d.length);
		}
		return this._loop();
	}
	_loop() {
		const type = this._d[this._i++];
		switch (type) {
		case 70:
			{
				const float = this._v.getFloat64(this._i);
				this._i += 8;
				return float;
			}

		case 97:
			{
				return this._d[this._i++];
			}

		case 98:
			{
				const int = this._v.getInt32(this._i);
				this._i += 4;
				return int;
			}

		case 100:
		case 115:
		case 118:
		case 119:
			{
				const length = type === 100 || type === 118 ? (this._d[this._i++] << 8) + this._d[this._i++] : this._d[this._i++];
				if (this._cacheAtoms) {
					return this._lookup(length, type >= 118 ? this._atomTableUtf : this._atomTableLatin);
				}
				const atom = type >= 118 ? this._utf(length) : this._latin(length);
				return Object.prototype.hasOwnProperty.call(this._atoms, atom) ? this._atoms[atom] : atom;
			}

		case 104:
		case 105:
		case 108:
			{
				let length;
				if (type === 104) {
					length = this._d[this._i++];
				} else {
					length = this._v.getUint32(this._i);
					this._i += 4;
				}
				if (type === 108 && this._listDecoding === 2) {
					return this._charList(length);
				}
				const array = Array(length);
				for (let i = 0; i < length; i++) {
					array[i] = this._loop();
				}
				if (type === 108) {
					if (this._d[this._i] !== 106) {
						array.push(this._loop());
						return array;
					}
					this._i++;
				}
				return array;
			}

		case 106:
			{
				return this._nilDecoding === 2 ? [] : null;
			}

		case 107:
		case 109:
		case 77:
			{
				let length;
				let code;
				let bits = 8;
				if (type === 107) {
					length = (this._d[this._i++] << 8) + this._d[this._i++];
					code = this._stringDecoding;
				} else if (type === 109) {
					length = this._v.getUint32(this._i);
					code = this._binaryDecoding;
					this._i += 4;
				} else {
					length = this._v.getUint32(this._i);
					code = this._bitbinaryDecoding;
					bits = this._d[this._i + 4];
					this._i += 5;
					if (bits < 8 && length && code < 3) {
						const last = this._d[this._i + length - 1] >> 8 - bits;
						const string = code === 2 ? this._latin(length - 1) : this._utf(length - 1);
						this._i++;
						return string + String.fromCharCode(last);
					}
				}
				if (code === 5) {
					const array = Array(length);
					for (let i = 0; i < length; i++) {
						array[i] = this._d[this._i + i];
					}
					if (bits < 8 && length) {
						array[length - 1] >>= 8 - bits;
					}
					this._i += length;
					return array;
				} else if (code > 2) {
					const slice = this._d.subarray(this._i, this._i + length);
					this._i += length;
					if (code === 3) {
						const buffer = Buffer.allocUnsafe(length);
						buffer.set(slice);
						if (bits < 8 && length) {
							buffer[length - 1] >>= 8 - bits;
						}
						return buffer;
					}
					const uint8 = new Uint8Array(length);
					uint8.set(slice);
					if (bits < 8 && length) {
						uint8[length - 1] >>= 8 - bits;
					}
					return uint8;
				}
				return code === 2 ? this._latin(length) : this._utf(length);
			}

		case 110:
		case 111:
			{
				let length;
				if (type === 110) {
					length = this._d[this._i++];
				} else {
					length = this._v.getUint32(this._i);
					this._i += 4;
				}
				if (length === 0) {
					this._i += 1;
					return this._safebigintDecoding === 3 ? "0" : this._safebigintDecoding === 1 ? 0 : 0n;
				}
				if (length === 1 && this._d[this._i + 1] === 0) {
					this._i += 2;
					return this._safebigintDecoding === 3 ? "0" : this._safebigintDecoding === 1 ? 0 : 0n;
				}
				const sign = this._d[this._i++];
				if (length < 7 || length === 7 && this._d[this._i + 6] < 32) {
					let num = 0;
					if (length === 1) {
						num = this._d[this._i];
					} else if (length === 2) {
						num = (this._d[this._i + 1] << 8) + this._d[this._i];
					} else if (length === 3) {
						num = (this._d[this._i + 2] << 16) + (this._d[this._i + 1] << 8) + this._d[this._i];
					} else if (length === 4) {
						num = this._v.getUint32(this._i, true);
					} else if (length === 5) {
						num = this._d[this._i + 4] * 4294967296 + this._v.getUint32(this._i, true);
					} else if (length === 6) {
						num = ((this._d[this._i + 5] << 8) + this._d[this._i + 4]) * 4294967296 + this._v.getUint32(this._i, true);
					} else {
						num = ((this._d[this._i + 6] << 16) + (this._d[this._i + 5] << 8) + this._d[this._i + 4]) * 4294967296 + this._v.getUint32(this._i, true);
					}
					this._i += length;
					if (sign) {
						num = -num;
					}
					return this._safebigintDecoding === 3 ? num.toString() : this._safebigintDecoding === 1 ? num : BigInt(num);
				}
				let num;
				if (length === 8) {
					num = this._v.getBigUint64(this._i, true);
				} else {
					let left = length;
					num = 0n;
					while (left > 0) {
						if (left >= 8) {
							num <<= 64n;
							num += this._v.getBigUint64(this._i + (left -= 8), true);
						} else if (left >= 4) {
							num <<= 32n;
							num += BigInt(this._v.getUint32(this._i + (left -= 4), true));
						} else if (left >= 2) {
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
				if (sign) {
					num = -num;
				}
				return this._bigintDecoding === 2 ? num.toString() : num;
			}

		case 116:
			{
				const obj = {};
				const length = this._v.getUint32(this._i);
				this._i += 4;
				for (let i = 0; i < length; i++) {
					const key = this._key();
					if (key === "__proto__") {
						Object.defineProperty(obj, key, {
							value: this._loop(),
							writable: true,
							enumerable: true,
							configurable: true
						});
					} else {
						obj[key] = this._loop();
					}
				}
				return obj;
			}
		}
		throw new Error(`Unexpected byte: ${type}`);
	}
	_key() {
		const keyType = this._d[this._i];
		if (keyType === 107 || keyType === 109) {
			const opt = keyType === 107 ? this._stringKeyDecoding : this._binaryKeyDecoding;
			const length = keyType === 107 ? (this._d[this._i + 1] << 8) + this._d[this._i + 2] : this._v.getUint32(this._i + 1);
			this._i += keyType === 107 ? 3 : 5;
			if (length === 0) {
				return "";
			}
			if (length === 1) {
				const byte = this._d[this._i++];
				return opt === 1 && byte >= 128 ? "�" : String.fromCharCode(byte);
			}
			if (this._cacheKeys && length < 30) {
				return this._lookup(length, opt === 1 ? this._keyTableUtf : this._keyTableLatin);
			}
			return opt === 2 ? this._latin(length) : this._utf(length);
		}
		if (keyType === 100 || keyType === 115 || keyType === 118 || keyType === 119) {
			const wide = keyType === 100 || keyType === 118;
			const length = wide ? (this._d[this._i + 1] << 8) + this._d[this._i + 2] : this._d[this._i + 1];
			this._i += wide ? 3 : 2;
			if (length === 0) {
				return "";
			}
			if (length === 1) {
				const byte = this._d[this._i++];
				return keyType >= 118 && byte >= 128 ? "�" : String.fromCharCode(byte);
			}
			if (this._cacheKeys && length < 30) {
				return this._lookup(length, keyType >= 118 ? this._keyTableUtf : this._keyTableLatin);
			}
			return keyType >= 118 ? this._utf(length) : this._latin(length);
		}
		if (keyType === 108) {
			const keyLength = this._v.getUint32(this._i + 1);
			this._i += 5;
			return this._charList(keyLength);
		}
		const key = this._loop();
		return typeof key === "string" || typeof key === "symbol" ? key : String(key);
	}
	_lookup(length, table) {
		const d = this._d;
		const v = this._v;
		const s = this._i;
		let n = table[length];
		let id = 0;
		if (n) {
			let i = s;
			const end = s + length;
			for (;n && i + 6 < end; i += 6) {
				n = n.get(v.getUint32(i) * 65536 + v.getUint16(i + 4));
			}
			if (n) {
				switch (end - i) {
				case 1:
					id = d[i];
					break;

				case 2:
					id = v.getUint16(i);
					break;

				case 3:
					id = d[i] * 65536 + v.getUint16(i + 1);
					break;

				case 4:
					id = v.getUint32(i);
					break;

				case 5:
					id = v.getUint32(i) * 256 + d[i + 4];
					break;

				case 6:
					id = v.getUint32(i) * 65536 + v.getUint16(i + 4);
					break;
				}
				const value = n.get(id);
				if (typeof value !== "undefined" || n.has(id)) {
					this._i += length;
					return value;
				}
			}
		}
		const utf = table === this._keyTableUtf || table === this._atomTableUtf;
		const atom = table === this._atomTableLatin || table === this._atomTableUtf;
		const text = utf ? this._utf(length) : this._latin(length);
		const value = atom && Object.prototype.hasOwnProperty.call(this._atoms, text) ? this._atoms[text] : text;
		let node = table[length] ??= new Map();
		const end = this._i;
		let i = s;
		for (;i + 6 < end; i += 6) {
			id = v.getUint32(i) * 65536 + v.getUint16(i + 4);
			let next = node.get(id);
			if (!next) {
				next = new Map();
				node.set(id, next);
			}
			node = next;
		}
		id = 0;
		for (;i < end; i++) {
			id = id * 256 + d[i];
		}
		node.set(id, value);
		return value;
	}
	_charList(length) {
		let string = "";
		for (let i = 0; i <= length; i++) {
			const pointType = this._d[this._i];
			if (i === length && pointType === 106) {
				this._i++;
				break;
			}
			if (pointType !== 97 && pointType !== 98 && pointType !== 110 && pointType !== 111) {
				throw new TypeError("Character list elements must be integers");
			}
			const point = Number(this._loop());
			if (!Number.isInteger(point) || point < 0 || point > 1114111 || point >= 55296 && point <= 57343) {
				throw new RangeError("Character list element is not a Unicode scalar value");
			}
			string += String.fromCodePoint(point);
		}
		return string;
	}
	_utf(length) {
		let str = "";
		let i = this._i;
		const data = this._d;
		if (length < this._T) {
			const l = i + length;
			let byte1 = 0, byte2 = 0, byte3 = 0, byte4 = 0, byte5 = 0, byte6 = 0, byte7 = 0, byte8 = 0;
			while (i < l) {
				if ((byte1 = data[i++]) < 128) {
					if (i < l && (byte2 = data[i]) < 128) {
						if (i + 1 < l && (byte3 = data[i + 1]) < 128) {
							if (i + 2 < l && (byte4 = data[i + 2]) < 128) {
								if (i + 3 < l && (byte5 = data[i + 3]) < 128) {
									if (i + 4 < l && (byte6 = data[i + 4]) < 128) {
										if (i + 5 < l && (byte7 = data[i + 5]) < 128) {
											if (i + 6 < l && (byte8 = data[i + 6]) < 128) {
												str += String.fromCharCode(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
												i += 7;
												continue;
											} else {
												str += String.fromCharCode(byte1, byte2, byte3, byte4, byte5, byte6, byte7);
												i += 6;
												byte1 = byte8;
											}
										} else {
											str += String.fromCharCode(byte1, byte2, byte3, byte4, byte5, byte6);
											i += 5;
											byte1 = byte7;
										}
									} else {
										str += String.fromCharCode(byte1, byte2, byte3, byte4, byte5);
										i += 4;
										byte1 = byte6;
									}
								} else {
									str += String.fromCharCode(byte1, byte2, byte3, byte4);
									i += 3;
									byte1 = byte5;
								}
							} else {
								str += String.fromCharCode(byte1, byte2, byte3);
								i += 2;
								byte1 = byte4;
							}
						} else {
							str += String.fromCharCode(byte1, byte2);
							i++;
							byte1 = byte3;
						}
					} else {
						str += String.fromCharCode(byte1);
						byte1 = byte2;
					}
					if (i === l) {
						break;
					}
					i++;
				}
				if (byte1 < 194 || byte1 > 244) {
					str += "�";
					continue;
				}
				const second = i < l ? data[i] : 0;
				if ((second & 192) !== 128 || byte1 === 224 && second < 160 || byte1 === 237 && second > 159 || byte1 === 240 && second < 144 || byte1 === 244 && second > 143) {
					str += "�";
					continue;
				}
				i++;
				let point = (byte1 & (byte1 < 224 ? 31 : byte1 < 240 ? 15 : 7)) << 6 | second & 63;
				if (byte1 >= 224) {
					const third = i < l ? data[i] : 0;
					if ((third & 192) !== 128) {
						str += "�";
						continue;
					}
					i++;
					point = point << 6 | third & 63;
					if (byte1 >= 240) {
						const fourth = i < l ? data[i] : 0;
						if ((fourth & 192) !== 128) {
							str += "�";
							continue;
						}
						i++;
						point = point << 6 | fourth & 63;
					}
				}
				str += point < 65536 ? String.fromCharCode(point) : String.fromCharCode(55296 + (point - 65536 >> 10), 56320 + (point - 65536 & 1023));
			}
		} else {
			str = this._b ? this._b.toString("utf8", i, i + length) : this._u(data.subarray(i, i + length));
		}
		this._i += length;
		return str;
	}
	_latin(length) {
		let str = "";
		const i = this._i;
		const data = this._d;
		if (length < this._TL || this._browserStrictLatin1 && !this._b) {
			let n = i;
			const end = i + length;
			for (;n + 8 < end; n += 8) {
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2], data[n + 3], data[n + 4], data[n + 5], data[n + 6], data[n + 7]);
			}
			switch (end - n) {
			case 1:
				str += String.fromCharCode(data[n]);
				break;

			case 2:
				str += String.fromCharCode(data[n], data[n + 1]);
				break;

			case 3:
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2]);
				break;

			case 4:
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2], data[n + 3]);
				break;

			case 5:
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2], data[n + 3], data[n + 4]);
				break;

			case 6:
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2], data[n + 3], data[n + 4], data[n + 5]);
				break;

			case 7:
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2], data[n + 3], data[n + 4], data[n + 5], data[n + 6]);
				break;

			case 8:
				str += String.fromCharCode(data[n], data[n + 1], data[n + 2], data[n + 3], data[n + 4], data[n + 5], data[n + 6], data[n + 7]);
				break;
			}
		} else {
			str = this._b ? this._b.toString("latin1", i, i + length) : this._l(data.subarray(i, i + length));
		}
		this._i += length;
		return str;
	}
	async _decompressorStreamOut(reader) {
		const chunks = [];
		let size = 0;
		while (true) {
			const {
				done,
				value
			} = await reader.read();
			if (value) {
				chunks.push(value);
				size += value.length;
			}
			if (done) {
				break;
			}
		}
		const out = new Uint8Array(size);
		let n = 0;
		for (let i = 0; i < chunks.length; i++) {
			const c = chunks[i];
			out.set(c, n);
			n += c.length;
		}
		return out;
	}
}

Unpacker.Unpacker = Unpacker;

Unpacker.default = Unpacker;

export default Unpacker;