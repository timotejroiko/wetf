const Wetf = {
    Packer: require("./src/packer"),
    Unpacker: require("./src/unpacker")
};

module.exports = {
    Wetf,
    default: Wetf,
    Packer: Wetf.Packer,
    Unpacker: Wetf.Unpacker,
};
