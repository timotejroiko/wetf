const { readFileSync, writeFileSync, mkdirSync, readdirSync } = require("fs");
const uglify = require("uglify-js");
const uglifyOptions = { mangle: { properties: { reserved: ["Packer", "Unpacker", "pack", "unpack", "Wetf"] } } };
const package = require("../package.json");
const pkg = capitalize(package.name);
const src = readdirSync("./src").map(x => ({ name: x.split(".")[0], content: readFileSync(`./src/${x}`, "utf-8") }));

makeUMD();
makeESM();
makeCJS();

function makeUMD() {
	mkdirSync("./umd", { recursive: true });
	const umd = `
	(
		function (global, factory) {
			typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
			typeof define === 'function' && define.amd ? define(['exports'], factory) :
			(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global));
		}
		(
			this, (
				function (exports) {
					'use strict';
					const o = exports.${pkg} || (exports.${pkg} = {})
					%
				}
			)
		)
	);`;
	let combined = "";
	src.forEach(({ name, content }) => {
		const modified = content.slice(0, content.indexOf("module.exports"));
		const code = `o.${capitalize(name)} = ${uglify.minify(modified, uglifyOptions).code}`;
		combined += `${code}\n`;
		writeFileSync(`./umd/${name}.min.js`, uglify.minify(umd.replace("%", code), uglifyOptions).code);
	});
	writeFileSync(`./umd/${package.name}.min.js`, uglify.minify(umd.replace("%", combined), uglifyOptions).code);
}

function makeESM() {
	mkdirSync("./esm", { recursive: true });
	const names = [];
	src.forEach(({ name, content }) => {
		const modified = content.slice(0, content.indexOf("module.exports")).replace("class ", "export class ");
		writeFileSync(`./esm/${name}.js`, modified);
		names.push(capitalize(name));
	});
	const index = 
	`
${names.map(x => `import { ${x} } from "./${x.toLowerCase()}.js";`).join("\n")}	
const ${pkg} = { ${names.join(", ")} };
export { ${names.join(", ")}, ${pkg} };
export default { ${names.join(", ")} };
	`;
	writeFileSync("./esm/wetf.js", index);
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
