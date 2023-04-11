
const Packer = require("./src/packer.js");
const Unpacker = require("./src/unpacker.js");	
const Wetf = { Packer, Unpacker };
module.exports = {
	Wetf,
	default: Wetf,
	Packer,
	Unpacker
};
	