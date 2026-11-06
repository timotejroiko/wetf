const { spawnSync } = require("node:child_process");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { performance } = require("node:perf_hooks");
const { parseArgs } = require("node:util");
const { Packer } = require("../index");

const samplesPath = join(__dirname, "samples");
const libraries = ["wetf", "wetf-npm", "etf.js", "erlpackjs", "erlang_js", "@devsnek/earl", "@typescord/ftee", "erlpack"];

function configurations(library, operation) {
	if(library === "wetf") {
		if(operation === "pack") {
			return [{ name: "binary keys, cacheKeys=true", key: "binary", cacheKeys: true }];
		}
		return [{ name: "cacheKeys=true, cacheAtoms=true", cacheKeys: true, cacheAtoms: true }];
	}
	if(library === "wetf-npm") {
		return operation === "pack"
			? [{ name: "binary keys, binary text, safeInt=bigint, array=tuple" }]
			: [{ name: "atomRegistration=true, binary=utf8, nil=array, safebigint=number" }];
	}
	if(library === "@typescord/ftee" && operation === "pack") {
		return [{ name: "bufferSize=4096", bufferSize: 4096 }];
	}
	return [{ name: "default" }];
}

function codec(library, config, operation) {
	switch(library) {
	case "wetf": {
		const { Packer, Unpacker } = require("../index");
		if(operation === "pack") {
			const packer = new Packer({ cacheKeys: config.cacheKeys, encoding: { key: config.key } });
			return value => packer.pack(value);
		}
		const unpacker = new Unpacker({ cacheKeys: config.cacheKeys, cacheAtoms: config.cacheAtoms });
		return packet => unpacker.unpack(packet);
	}
	case "wetf-npm": {
		const { Packer, Unpacker } = require(library);
		if(operation === "pack") {
			const packer = new Packer({ encoding: { key: "binary", string: "binary", safeInt: "bigint", array: "tuple" } });
			return value => packer.pack(value);
		}
		const unpacker = new Unpacker({ atomRegistration: true, decoding: { binary: "utf8", nil: "array", safebigint: "number" } });
		return packet => unpacker.unpack(packet);
	}
	case "etf.js":
	case "erlpack":
	case "erlpackjs":
	case "@devsnek/earl":
		return require(library)[operation];
	case "@typescord/ftee": {
		const { encode, decode } = require(library);
		return operation === "pack" ? value => encode(value, config.bufferSize) : decode;
	}
	case "erlang_js": {
		const { Erlang } = require(library);
		if(operation === "pack") {
			const onResult = error => { if(error) { throw error; } };
			return input => Erlang.term_to_binary(input, onResult);
		}
		Erlang.set_undefined("nil");
		function access(value) {
			if(value instanceof Erlang.OtpErlangBinary) {
				value.value.toString("utf8");
				return;
			}
			if(value instanceof Erlang.OtpErlangMap) {
				for(const [key, entry] of value.value) {
					access(key);
					access(entry);
				}
				return;
			}
			if(value instanceof Erlang.OtpErlangAtom || value instanceof Erlang.OtpErlangAtomLarge) {
				if(value.utf8) { Buffer.from(value.value, "latin1").toString("utf8"); }
				return;
			}
			const array = value instanceof Erlang.OtpErlangList ? value.value : value;
			if(Array.isArray(array)) {
				for(let i = 0; i < array.length; i++) { access(array[i]); }
			}
		}
		const onResult = (error, value) => {
			if(error) { throw error; }
			access(value);
		};
		return input => Erlang.binary_to_term(input, onResult);
	}
	default:
		throw new Error(`Unknown library: ${library}`);
	}
}

const { values, tokens } = parseArgs({
	tokens: true,
	options: {
		sample: { type: "string" },
		samples: { type: "string" },
		lib: { type: "string" },
		libs: { type: "string" },
		operation: { type: "string", default: "both" },
		iterations: { type: "string", default: "100000" },
		rounds: { type: "string", default: "1" },
		help: { type: "boolean" }
	}
});
for(const token of tokens) {
	if(token.kind !== "option") { continue; }
	if(token.name === "sample" || token.name === "samples") { values.sample = token.value; }
	if(token.name === "lib" || token.name === "libs") { values.lib = token.value; }
}
const sampleFiles = readdirSync(samplesPath).filter(name => /\.(json|js)$/.test(name)).sort();
const sampleNames = sampleFiles.map(name => name.replace(/\.(json|js)$/, ""));
if(values.help) {
	console.log(`Usage: npm run benchmark -- --sample <name|all> --lib <library|all> [--operation pack|unpack|both] [--iterations 100000] [--rounds 1]\nAliases: --samples = --sample; --libs = --lib. If repeated, the last value wins.\nEach sample/library combination runs sequentially in a fresh Node process.\nLibraries: ${libraries.join(", ")}\nSamples: ${sampleNames.join(", ")}`);
	process.exit(0);
}
if(!values.sample || values.lib !== "all" && !libraries.includes(values.lib)) {
	throw new Error("Specify --sample <name|all> and --lib <library|all> (aliases: --samples, --libs); see --help");
}
if(!["pack", "unpack", "both"].includes(values.operation)) { throw new Error("Operation must be pack, unpack, or both"); }
const iterations = Number(values.iterations);
const rounds = Number(values.rounds);
if(!Number.isSafeInteger(iterations) || iterations < 1 || !Number.isSafeInteger(rounds) || rounds < 1) {
	throw new Error("Iterations and rounds must be positive safe integers");
}
if(values.sample === "all" || values.lib === "all") {
	for(const sample of values.sample === "all" ? sampleNames : [values.sample]) {
		for(const library of values.lib === "all" ? libraries : [values.lib]) {
			const result = spawnSync(process.execPath, [
				__filename, "--sample", sample, "--lib", library,
				"--operation", values.operation, "--iterations", String(iterations), "--rounds", String(rounds)
			], { stdio: "inherit" });
			if(result.error) { throw result.error; }
			if(result.status !== 0) { process.exit(result.status ?? 1); }
		}
	}
	process.exit(0);
}
const sample = values.sample.replace(/\.(json|js)$/, "");
const sampleFile = sampleFiles.find(name => name === values.sample)
	?? sampleFiles.find(name => name.replace(/\.(json|js)$/, "") === sample);
if(!sampleFile) { throw new Error(`Unknown sample: ${values.sample}; see --help`); }
const samplePath = join(samplesPath, sampleFile);
const value = sampleFile.endsWith(".js") ? require(samplePath) : JSON.parse(readFileSync(samplePath, "utf8"));
// These profiles are independent of the library under test.
const discord = sample.startsWith("discord-");
const packet = values.operation === "pack" ? null : Buffer.from(new Packer({
	useLegacyAtoms: true,
	compression: false,
	encoding: {
		key: discord ? "atom" : "binary",
		string: "binary",
		array: "list",
		null: "atom",
		safeInt: discord ? "bigint" : "float"
	}
}).pack(value));
for(const direction of values.operation === "both" ? ["pack", "unpack"] : [values.operation]) {
	const input = direction === "pack" ? value : packet;
	for(const config of configurations(values.lib, direction)) {
		try {
			const run = codec(values.lib, config, direction);
			const warmupIterations = Math.min(iterations, 10000);
			console.error("starting...");
			for(let i = 0; i < warmupIterations; i++) { run(input); }
			for(let round = 1; round <= rounds; round++) {
				const start = performance.now();
				for(let i = 0; i < iterations; i++) { run(input); }
				const ms = performance.now() - start;
				console.log(JSON.stringify({ sample, library: values.lib, operation: direction, config: config.name, iterations, round, ms }));
			}
		} catch(error) {
			console.error(JSON.stringify({ sample, library: values.lib, operation: direction, config: config.name, error: error.message }));
		}
	}
}
