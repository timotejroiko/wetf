class Packer {
	/**
	 * 
	 * @param {{
	 *      poolSize?: number;
	 *      compression?: boolean | "zlib" | "compressionstream" | ((data: Uint8Array) => Uint8Array | Promise<Uint8Array>);
	 *      encoding?: {
	 *          string?: "binary" | "string";
	 *          key?: "binary" | "string" | "atom";
	 *          safeInt?: "bigint" | "float";
	 *          safeBigInt?: "number" | "bigint";
	 *          null?: "atom" | "nil";
	 *          buffer?: "binary" | "bitbinary" | "string";
	 *          undefined?: "atom" | "null" | "ignore";
	 *          infinity?: "atom" | "null" | "ignore";
	 *          nan?: "atom" | "null" | "ignore";
	 *          array?: "list" | "improperlist" | "tuple";
	 *      };
	 *      useLegacyAtoms?: boolean;
	 * }} options 
	 * @returns 
	 */
	constructor(options = {}) {
		/** @private */ this._compressor = options.compression ?? false;		
		/** @private */ this._stringEncoding = ["string", "binary"].indexOf(options.encoding?.string?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._keyEncoding = ["atom", "binary", "string"].indexOf(options.encoding?.key?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._safeIntEncoding = ["bigint", "float"].indexOf(options.encoding?.safeInt?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._safeBigIntEncoding = ["number", "bigint"].indexOf(options.encoding?.safeBigInt?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._nullEncoding = ["atom", "nil"].indexOf(options.encoding?.null?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._bufferEncoding = ["binary", "bitbinary", "string"].indexOf(options.encoding?.buffer?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._undefinedEncoding = ["atom", "null", "ignore"].indexOf(options.encoding?.undefined?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._infinityEncoding = ["atom", "null", "ignore"].indexOf(options.encoding?.infinity?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._nanEncoding = ["atom", "null", "ignore"].indexOf(options.encoding?.nan?.toLowerCase() ?? "") + 1 || 1;
		/** @private */ this._arrayEncoding = ["list", "improperlist", "tuple"].indexOf(options.encoding?.array?.toLowerCase() ?? "") + 1 || 3;
		/** @private */ this._useLegacyAtoms = Boolean(options.useLegacyAtoms);
		/** @private */ this._poolSize = Number(options.poolSize) || 1024 * 1024;
		/** @private */ this._u = new Uint8Array(this._poolSize);
		/** @private */ this._v = new DataView(this._u.buffer);
		/** @private */ this._i = 0;
		/** @private */ this._o = 0;
		/** @private */ this._r = 0;

		if(typeof process !== "undefined" && typeof process?.versions?.node === "string") {
			/** @private */ this._b = Buffer.from(this._u.buffer);
			// @ts-expect-error this._b will never be null here
			/** @private */ this._e = (/** @type {string} */ string, /** @type {number} */ index) => this._b.write(string, index);
			/** @private */ this._T = 32; // buffer.write is super fast
			if(this._compressor === true) { this._compressor = "zlib"; }
		} else {
			const encoder = new TextEncoder();
			this._e = (/** @type {string} */ string, /** @type {number} */ index) => encoder.encodeInto(string, this._u.subarray(index)).written ?? 0;
			this._b = null;
			this._T = 32;
			if(this._compressor === true) { this._compressor = "compressionstream"; }
			if(typeof navigator === "object") {
				const agent = navigator.userAgent;
				if(agent.includes("Firefox")) { this._T = 128; } // firefox is slower at manual encoding
				else if(agent.includes("Chrome")) { this._T = 540; } // manual encoding is super fast in chrome
			}
		}

		if(this._compressor) {
			if(this._compressor === "zlib") {
				const zlib = require("zlib");
				/** @private */ this._z = (/** @type {Uint8Array} */ raw) => {
					const comp = zlib.deflateSync(raw);
					return this._compressorOut(comp);
				};
			} else if(this._compressor === "compressionstream") {
				this._z = (/** @type {Uint8Array} */ raw) => {
					// @ts-expect-error missing from webstreams types?
					// eslint-disable-next-line no-undef
					const compression = new CompressionStream("deflate");
					const reader = compression.readable.getReader();
					const writer = compression.writable.getWriter();
					writer.ready.then(() => writer.write(raw)).then(() => writer.ready).then(() => writer.close());
					return this._compressorStreamOut(reader);
				};
			} else if(typeof this._compressor === "function") {
				const fn = this._compressor;
				this._z = (/** @type {Uint8Array} */ raw) => {
					let comp = fn(raw);
					if(comp instanceof Promise) {
						return comp.then(this._compressorOut);
					}
					return this._compressorOut(comp);
				};
			}
		}
	}

	/**
	 * 
	 * @param {*} data 
	 * @returns 
	 */
	pack(data) {
		this._o = this._i;
		this._r = 0;
		this._expand(10);
		if(this._z) {
			this._loop(data);
			const raw = this._u.subarray(this._o, this._i);
			return this._z(raw);
		}
		this._u[this._i++] = 131;
		this._loop(data);
		return this._u.subarray(this._o, this._i);
	}

	/**
	 * @private
	 * @param {*} obj 
	 */
	_loop(obj) {
		const type = typeof obj;
		switch(type) {
			case "undefined": {
				if(this._undefinedEncoding === 3) { break; }
				this._expand(11);
				this._u[this._i] = this._useLegacyAtoms ? 115 : 119;
				this._u[this._i + 1] = 9;
				this._u[this._i + 2] = 117;
				this._v.setUint32(this._i + 3, 1852073318);
				this._v.setUint32(this._i + 7, 1768842596);
				this._i += 11;
				break;
			}
			case "boolean": {
				this._expand(7);
				this._u[this._i] = this._useLegacyAtoms ? 115 : 119;
				if(obj) {
					this._u[this._i + 1] = 4;
					this._v.setUint32(this._i + 2, 1953658213);
					this._i += 6;
				} else {
					this._u[this._i + 1] = 5;
					this._u[this._i + 2] = 102;
					this._v.setUint32(this._i + 3, 1634497381);
					this._i += 7;
				}
				break;
			}
			case "string": case "symbol": {
				if(type === "symbol") {
					obj = obj.toString();
				}
				if(this._stringEncoding === 2) {
					this._expand(obj.length * 2 + 5);
					this._u[this._i++] = 109;
					const temp_i = this._i;
					this._i += 4;
					const written = this._utf(obj);
					this._v.setUint32(temp_i, written);
				} else {
					this._expand(obj.length * 2 + 3);
					this._u[this._i++] = 107;
					const temp_i = this._i;
					this._i += 2;
					const written = this._utf(obj);
					this._u[temp_i] = written >> 8;
					this._u[temp_i + 1] = written & 255;
				}
				break;
			}
			case "number": {
				if(Number.isFinite(obj)) {
					this._expand(11);
					if(Number.isInteger(obj)) {
						const abs = Math.abs(obj);
						const neg = obj < 0;
						if(obj < 256 && !neg) {
							this._u[this._i++] = 97;
							this._u[this._i++] = obj;
						} else if(abs < 2147483648) {
							this._u[this._i] = 98;
							this._v.setInt32(this._i + 1, obj);
							this._i += 5;
						} else if(abs <= Number.MAX_SAFE_INTEGER && this._safeIntEncoding === 1) {
							this._u[this._i] = 110;
							this._u[this._i + 2] = Number(neg);
							if(abs < 4294967296) {
								this._v.setUint32(this._i + 3, abs, true);
								this._u[this._i + 1] = 4;
								this._i += 7;
							} else {
								const lower = abs >>> 0;
								const upper = Math.floor(abs / 4294967296);
								this._v.setUint32(this._i + 3, lower, true);
								if(upper < 256) {
									this._u[this._i + 1] = 5;
									this._u[this._i + 7] = upper;
									this._i += 8;
								} else if(upper < 65536) {
									this._u[this._i + 1] = 6;
									this._u[this._i + 7] = upper & 255;
									this._u[this._i + 8] = upper >> 8;
									this._i += 9;
								} else {
									this._u[this._i + 1] = 7;
									this._u[this._i + 7] = upper & 255;
									this._u[this._i + 8] = (upper >> 8) & 255;
									this._u[this._i + 9] = upper >> 16;
									this._i += 10;
								}
							}
						} else {
							this._u[this._i++] = 70;
							this._v.setFloat64(this._i, obj);
							this._i += 8;
						}
					} else {
						this._u[this._i++] = 70;
						this._v.setFloat64(this._i, obj);
						this._i += 8;
					}
				} else if(Number.isNaN(obj)) {
					if(this._nanEncoding === 3) { break; }
					this._expand(4);
					this._u[this._i] = this._useLegacyAtoms ? 115 : 119;
					this._u[this._i + 1] = 110;
					this._u[this._i + 2] = 97;
					this._u[this._i + 3] = 110;
					this._i += 4;
				} else {
					if(this._infinityEncoding === 3) { break; }
					this._expand(18);
					this._u[this._i] = this._useLegacyAtoms ? 115 : 119;
					if(obj < 0) {
						this._v.setUint32(this._i + 1, 1852139361);
					} else {
						this._v.setUint32(this._i + 1, 1886352233);
					}
					this._u[this._i + 5] = 95;
					this._v.setUint32(this._i + 6, 1769366879);
					this._v.setUint32(this._i + 10, 1768842857);
					this._v.setUint32(this._i + 14, 1852404857);
					this._i += 18;
				}
				break;
			}
			case "bigint": {
				if(obj === 0n) {
					this._expand(3);
					if(this._safeBigIntEncoding === 2) {
						this._u[this._i++] = 110;
						this._u[this._i++] = 0;
						this._u[this._i++] = 0;
					} else {
						this._u[this._i++] = 97;
						this._u[this._i++] = 0;
					}
				} else {
					const neg = obj < 0n;
					const abs = neg ? -obj : obj;
					if(abs < 18446744073709551616n) {
						this._expand(11);
						if(this._safeBigIntEncoding === 1 && abs < 2147483648n) {
							this._u[this._i] = 98;
							this._v.setBigUint64(this._i + 1, abs);
							if(neg) {
								const n = this._u[this._i + 1];
								this._u[this._i + 1] = n | 128;
							}
							this._i += 5;
						} else {
							this._u[this._i] = 110;
							this._u[this._i + 2] = Number(neg);
							this._v.setBigUint64(this._i + 3, abs, true);
							for(let n = 10; n > 3; n--) {
								if(this._u[this._i + n] !== 0) {
									this._u[this._i + 1] = n - 2;
									this._i += n + 1;
									break;
								}
							}
						}
						
					} else if(abs < 340282366920938463463374607431768211456n) {
						this._expand(19);
						this._u[this._i] = 110;
						this._u[this._i + 2] = Number(neg);
						this._v.setBigUint64(this._i + 3, abs & 18446744073709551615n, true);
						this._v.setBigUint64(this._i + 11, abs >> 64n, true);
						for(let n = 18; n > 11; n--) {
							if(this._u[this._i + n] !== 0) {
								this._u[this._i + 1] = n - 2;
								this._i += n + 1;
								break;
							}
						}
					} else if(abs < 115792089237316195423570985008687907853269984665640564039457584007913129639936n) {
						this._expand(35);
						this._u[this._i] = 110;
						this._u[this._i + 2] = Number(neg);
						this._v.setBigUint64(this._i + 3, abs & 18446744073709551615n, true);
						this._v.setBigUint64(this._i + 11, (abs >> 64n) & 18446744073709551615n, true);
						this._v.setBigUint64(this._i + 19, (abs >> 128n) & 18446744073709551615n, true);
						this._v.setBigUint64(this._i + 27, abs >> 192n, true);
						for(let n = 34; n > 27; n--) {
							if(this._u[this._i + n] !== 0) {
								this._u[this._i + 1] = n - 2;
								this._i += n + 1;
								break;
							}
						}
					} 
					
					/*
					else if(abs < 13407807929942597099574024998205846127479365820592393377723561443721764030073546976801874298166903427690031858186486050853753882811946569946433649006084096n) {

					} else if(abs < 179769313486231590772930519078902473361797697894230657273430081157732675805500963132708477322407536021120113879871393357658789768814416622492847430639474124377767893424865485276302219601246094119453082952085005768838150682342462881473913110540827237163350510684586298239947245938479716304835356329624224137216n) {

					} else if(abs < 126238304966058622268417487065116999845484776053576109500509161826268184136202698801551568013761380717534054534851164138648904527931605160527688095259563605939964364716019515983399209962459578542172100149937763938581219604072733422507180056009672540900709554109516816573779593326332288314873251559077853068444977864803391962580800682760017849589281937637993445539366428356761821065267423102149447628375691862210717202025241630303118559188678304314076943801692528246980959705901641444238894928620825482303431806955690226308773426829503900930529395181208739591967195841536053143145775307050594328881077553168201547776) {

					} else {

					}
					*/
					
					else {
						// room for optimization but not worth it because numbers this big are rarely used
						let n = abs;
						const a = [];
						// eslint-disable-next-line no-constant-condition
						while(true) {
							let k = n & 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
							let k1 = k >> 128n;
							let k2 = k & 340282366920938463463374607431768211455n;
							// eslint-disable-next-line no-cond-assign
							if(n >>= 256n) {
								a.push(k2 & 18446744073709551615n, k2 >> 64n, k1 & 18446744073709551615n, k1 >> 64n);
							} else {
								const n1 = k2 & 18446744073709551615n;
								const n2 = k2 >> 64n;
								const n3 = k1 & 18446744073709551615n;
								const n4 = k1 >> 64n;
								if(n4 > 0n) {
									a.push(n1, n2, n3, n4);
								} else if(n3 > 0n) {
									a.push(n1, n2, n3);
								} else if(n2 > 0n) {
									a.push(n1, n2);
								} else {
									a.push(n1);
								}
								break;
							}
						}
						const size = a.length * 8;
						this._expand(size + 6);
						if(size < 256) {
							this._u[this._i] = 110;
							this._u[this._i + 1] = size;
							this._u[this._i + 2] = Number(neg);
							this._i += 3;
						} else {
							this._u[this._i] = 111;
							this._v.setUint32(this._i + 1, size);
							this._u[this._i + 5] = Number(neg);
							this._i += 6;
						}
						for(let i = 0; i < a.length; i++) {
							const val = a[i];
							const offset = this._i + i * 8;
							this._v.setBigUint64(offset, val, true);
						}
						this._i += size;
					}
				}
				break;
			}
			case "object": {
				if(obj === null) {
					this._expand(5);
					if(this._nullEncoding === 2) {
						this._u[this._i++] = 106;
					} else {
						this._u[this._i] = this._useLegacyAtoms ? 115 : 119;
						this._v.setUint32(this._i + 1, 57567596);
						this._i += 5;
					}
				} else if(Array.isArray(obj)) {
					this._expand(5);
					if(obj.length === 0) {
						if(this._arrayEncoding === 3) {
							this._u[this._i++] = 104;
							this._u[this._i++] = 0;
						} else {
							this._u[this._i++] = 106;
						}
					} else {
						let size = obj.length;
						let index = this._i + 1;
						let type = 1;
						const r = this._r;
						if(this._arrayEncoding === 3) {
							if(obj.length < 256) {
								this._u[this._i] = 104;
								this._i += 2;
							} else {
								this._u[this._i] = 105;
								this._i += 5;
								type = 2;
							}
						} else {
							this._u[this._i] = 108;
							this._i += 5;
							if(this._arrayEncoding === 2) {
								size--;
								type = 3;
							} else {
								type = 4;
							}
						}
						for(let i = 0; i < obj.length; i++) {
							let val = obj[i];
							const checkVal = this._notIgnoreOrNull(val);
							if(!checkVal) {
								if(checkVal === null) {
									val = null;
								} else {
									size--;
									continue;
								}
							}
							this._loop(val);
						}
						if(r !== this._r) {
							index -= this._r;
						}
						switch(type) {
							case 1: this._u[index] = size; break;
							case 2: case 3: this._v.setUint32(index, size); break;
							case 4: this._v.setUint32(index, size); this._u[this._i++] = 106; break;
						}
					}
				} else if(ArrayBuffer.isView(obj)) {
					//@ts-ignore BYTES_PER_ELEMENT not typed
					/** @type {ArrayLike<number>} */ const data = obj.BYTES_PER_ELEMENT !== 1 ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength) : obj;
					const length = data.length;
					let isBitBinary = false;
					if(this._bufferEncoding === 3) {
						this._expand(length + 3);
						this._u[this._i] = 107;
						this._u[this._i + 1] = length >> 8;
						this._u[this._i + 2] = length & 255;
						this._i += 3;
					} else if(this._bufferEncoding === 2) {
						this._expand(length + 6);
						this._u[this._i] = 77;
						this._v.setUint32(this._i + 1, length);
						this._u[this._i + 5] = 0;
						this._i += 6;
						isBitBinary = true;
					} else {
						this._expand(length + 5);
						this._u[this._i] = 109;
						this._v.setUint32(this._i + 1, length);
						this._i += 5;
					}
					if(length) {
						this._u.set(data, this._i);
						if(isBitBinary) {
							const val = this._u[this._i + length - 1];
							const bitLength = Math.floor(Math.log2(val) + 1);
							this._u[this._i + length - 1] = val << 8 - bitLength;
							this._u[this._i - 1] = bitLength;
						}
					}
					this._i += length;
				} else {
					this._expand(6);
					this._u[this._i++] = 116;
					const keys = Object.keys(obj);
					let length = keys.length;
					let index = this._i;
					const r = this._r;
					this._i += 4;
					for(let n = 0; n < keys.length; n++) {
						const key = keys[n];
						let val = obj[key];
						const checkVal = this._notIgnoreOrNull(val);
						if(!checkVal) {
							if(checkVal === null) {
								val = null;
							} else {
								length--;
								continue;
							}
						}
						const keyLength = key.length;
						if(this._keyEncoding === 1 && this._useLegacyAtoms) {
							if(keyLength < 256) {
								this._expand(keyLength + 2);
								this._u[this._i++] = 115;
								this._u[this._i++] = keyLength;
							} else {
								this._expand(keyLength + 3);
								this._u[this._i++] = 100;
								this._u[this._i++] = keyLength >> 8;
								this._u[this._i++] = keyLength & 255;
							}
							for(let k = 0; k < keyLength; k++) {
								this._u[this._i++] = key.charCodeAt(k);
							}
						} else {
							const possibleLength = keyLength * 2;
							let size = 0;
							this._expand(possibleLength + 5);
							if(this._keyEncoding === 2) {
								this._u[this._i] = 109;
								size = 4;
							} else if(this._keyEncoding === 3) {
								this._u[this._i] = 107;
								size = 2;
							} else {
								if(possibleLength < 256) {
									this._u[this._i] = 119;
									size = 1;
								} else {
									this._u[this._i] = 118;
									size = 2;
								}
							}
							const temp_i = this._i + 1;
							this._i += size + 1;
							const written = this._utf(key);
							if(size === 1) {
								this._u[temp_i] = written;
							} else if(size === 2) {
								this._u[temp_i] = written >> 8;
								this._u[temp_i + 1] = written & 255;
							} else {
								this._v.setUint32(temp_i, written);
							}
						}
						this._loop(val);
					}
					if(r !== this._r) {
						index -= this._r;
					}
					this._v.setUint32(index, length);
				}
				break;
			}
		}
	}

	/**
	 * 
	 * @param {*} val 
	 * @returns 
	 */
	_notIgnoreOrNull(val) {
		const type = typeof val;
		if(type === "undefined") {
			if(this._undefinedEncoding === 2) {
				return null;
			} else if(this._undefinedEncoding === 3) {
				return false;
			}
		}
		if(type === "number" && !Number.isFinite(val)) {
			if(Number.isNaN(val)) {
				if(this._nanEncoding === 2) {
					return null;
				} else if(this._nanEncoding === 3) {
					return false;
				}
			} else {
				if(this._infinityEncoding === 2) {
					return null;
				} else if(this._infinityEncoding === 3) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * @private
	 * @param {number} r 
	 */
	_expand(r) {
		const n = this._i + r;
		if(n >= this._poolSize) {
			let old;
			if(this._o === 0) {
				this._poolSize *= 2;
				old = this._u;
				this._u = new Uint8Array(this._poolSize);
			} else {
				old = this._u.subarray(this._o, this._i);
				this._u = new Uint8Array(this._poolSize);
				this._i = old.length;
				this._r = this._o;
				this._o = 0;
			}
			this._v = new DataView(this._u.buffer);
			if(this._b) {
				this._b = Buffer.from(this._u.buffer);
			}
			this._u.set(old);
		}
	}
	
	/**
	 * @private
	 * @param {string} string 
	 */
	_utf(string) {
		const length = string.length;
		if(length < this._T) {
			const actualLength = this._i;
			for(let n = 0; n < length; n++) {
				const c = string.charCodeAt(n);
				if(c < 128) {
					this._u[this._i++] = c;
				} else if(c < 2048) {
					this._u[this._i++] = 192 + (c >> 6);
					this._u[this._i++] = 128 + (c & 63);
				} else if(c < 55296 || c > 57343) {
					this._u[this._i++] = 224 + (c >> 12);
					this._u[this._i++] = 128 + ((c >> 6) & 63);
					this._u[this._i++] = 128 + (c & 63);
				} else {
					const c2 = 65536 + ((c & 1023) << 10) + (string.charCodeAt(++n) & 1023);
					this._u[this._i++] = 240 + (c2 >> 18);
					this._u[this._i++] = 128 + ((c2 >> 12) & 63);
					this._u[this._i++] = 128 + ((c2 >> 6) & 63);
					this._u[this._i++] = 128 + (c2 & 63);
				}
			}
			return this._i - actualLength;
		} else {
			const written = this._e(string, this._i);
			this._i += written;
			return written;
		}
	}

	/**
	 * @private
	 * @param {Uint8Array | Buffer} comp 
	 */
	_compressorOut(comp) {
		const size = comp.length;

		const out = new Uint8Array(size + 6);
		out[0] = 131;
		out[1] = 80;
		out[2] = size >> 24;
		out[3] = (size >> 16) & 255;
		out[4] = (size >> 8) & 255;
		out[5] = size & 255;
		out.set(comp, 6);

		return out;
	}

	/**
	 * @private
	 * @param {ReadableStreamDefaultReader} reader 
	 */
	async _compressorStreamOut(reader) {
		const chunks = [];
		let size = 0;
		// eslint-disable-next-line no-constant-condition
		while(true) {
			const { done, value } = await reader.read();
			if(value) {
				chunks.push(value);
				size += value.length;
			}
			if(done) { break; }
		}
		const out = new Uint8Array(size + 6);
		out[0] = 131;
		out[1] = 80;
		out[2] = size >> 24;
		out[3] = (size >> 16) & 255;
		out[4] = (size >> 8) & 255;
		out[5] = size & 255;
		let n = 6;
		for(let i = 0; i < chunks.length; i++) {
			const c = chunks[i];
			out.set(c, n);
			n += c.length;
		}
		return out;
	}
}

module.exports = Packer;
