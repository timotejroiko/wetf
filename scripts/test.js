// very basic integrity test, need to increase coverage but for now its fine
// also should probably test against actual erlpack data, not against js

const { Packer, Unpacker } = require("../");

const packer = new Packer({ encoding: { safeBigInt: "bigint" } });
const unpacker = new Unpacker({});

const a = [];
const b = [];
const c = [];
const d = [];
const e = [];

for (let i = 0; i < 100000; i++) {
	const o = {
		a: Math.random(),
		b: Math.random().toString(),
		c: [i, i, i.toString()],
		d: {
			[i]: "wefwef" + i,
			n: BigInt(i * 347928347)
		},
		t: i % 2 ? true: false,
		f: i % 3 ? false : true,
		n: i % 4 ? null : undefined,
		u: i % 5 ? undefined : null,
		z: 97394857982374598234062746823469n + BigInt(i)
	};
	a.push(o);
	b.push(JSON.stringify(o, (k, v) => typeof v === "bigint" ? v.toString() : v));
	c.push(packer.pack(o));
}

for (let i = 0; i < 100000; i++) {
	let unpacked;
	try {
		// @ts-ignore
		unpacked = unpacker.unpack(c[i]);
	} catch(e) {
		console.log(e, a[i], b[i], c[i], d[i], e[i]);
		process.exit(1);
	}
	
	d.push(unpacked);
	e.push(JSON.stringify(unpacked, (k, v) => typeof v === "bigint" ? v.toString() : v));
}

for (let i = 0; i < 100000; i++) {
	if(b[i] !== e[i]) {
		console.log(a[i], b[i], c[i], d[i], e[i]);
		throw new Error("result not equal");
	}
}

console.log("PASS!");