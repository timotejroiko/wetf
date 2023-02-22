const { readFileSync, writeFileSync, mkdirSync } = require("fs");
const uglify = require("uglify-js");
const packageName = "Wetf";

const packer = readFileSync("./src/packer.js", "utf-8");
const unpacker = readFileSync("./src/unpacker.js", "utf-8");
const packerSliced = packer.slice(0, packer.indexOf("module.exports"));
const unpackerSliced = unpacker.slice(0, unpacker.indexOf("module.exports"));

const code = `
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.${packageName} = global.${packageName} || {})));
}(this, function (exports) {
    'use strict';
	%
}));
`;

const packerUMD = code.replace("%", `exports.Packer = ${packerSliced}`);
const unpackerUMD = code.replace("%", `exports.Unpacker = ${unpackerSliced}`);
const allUMD = code.replace("%", `exports.Packer = ${packerSliced}; exports.Unpacker = ${unpackerSliced}`);

mkdirSync("./umd", { recursive: true })
writeFileSync("./umd/packer.min.js", uglify.minify(packerUMD).code);
writeFileSync("./umd/unpacker.min.js", uglify.minify(unpackerUMD).code);
writeFileSync(`./umd/${packageName.toLowerCase()}.min.js`, uglify.minify(allUMD).code);
