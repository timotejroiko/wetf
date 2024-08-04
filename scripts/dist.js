const { readFileSync, writeFileSync, mkdirSync, readdirSync } = require("fs");
const uglify = require("uglify-js");
const package = require("../package.json");
const pkg = capitalize(package.name);
const src = readdirSync("./src").map(x => ({ name: x.split(".")[0], content: readFileSync(`./src/${x}`, "utf-8") }));

const options = {
	output: {
		comments: false,
		beautify: true,
		/** @type {*} */ indent_level: "\t"
	},
	mangle: false,
	/** @type {false} */ compress: false,
};

makeUMD();
makeESM();
makeCJS();

function makeUMD() {
	mkdirSync("./umd", { recursive: true });
	const umd = `
(
	function (global, factory) {
		typeof exports === "object" && typeof module !== "undefined" ? factory(exports) :
		typeof define === "function" && define.amd ? define(["exports"], factory) :
		(global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global));
	}(
		this, function (exports) {
			"use strict";
			const o = exports.${pkg} || (exports.${pkg} = {});
%
		}
	)
);`;
	let combined = "";
	src.forEach(({ name, content }) => {
		const modified = content.slice(0, content.indexOf("module.exports"));
		const code = `o.${capitalize(name)} = ${modified}`;
		combined += `${code}\n`;
		writeFileSync(`./umd/${name}.js`, uglify.minify(umd.replace("%", code), options).code);
	});
	writeFileSync(`./umd/${package.name}.js`, uglify.minify(umd.replace("%", combined), options).code);
}

function makeESM() {
	mkdirSync("./esm", { recursive: true });
	const names = [];
	src.forEach(({ name, content }) => {
		const modified = content.slice(0, content.indexOf("module.exports")).replace("class ", "export class ") + `\nexport default ${name[0].toUpperCase() + name.slice(1)};\n\n`;
		writeFileSync(`./esm/${name}.mjs`, uglify.minify(modified, options).code);
		names.push(capitalize(name));
	});
	const index = 
	`
${names.map(x => `import { ${x} } from "./${x.toLowerCase()}.mjs";`).join("\n")}
const ${pkg} = { ${names.join(", ")} };
export { ${names.join(", ")}, ${pkg} };
export default { ${names.join(", ")} };
`;
	writeFileSync("./esm/wetf.mjs", index);
}

function makeCJS() {
	const names = src.map(x => capitalize(x.name));
	const index = 
	`
${names.map(x => `const ${x} = require("./src/${x.toLowerCase()}.js");`).join("\n")}
const ${pkg} = { ${names.join(", ")} };
module.exports = {
	${pkg},
	default: ${pkg},
	${names.join(",\n\t")}
};
`;
	writeFileSync("./index.js", index);
}

function capitalize(str) {
	return str[0].toUpperCase() + str.slice(1);
}
