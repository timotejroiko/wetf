const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node
            }
        },
        "rules": {
            "no-loss-of-precision": "error",
            "no-promise-executor-return": "error",
            "no-template-curly-in-string": "error",
            "no-unreachable-loop": "error",
            "no-useless-backreference": "error",
            "require-atomic-updates": "error",
            "accessor-pairs": "warn",
            "array-callback-return": "error",
            "block-scoped-var":"error",
            "curly":"error",
            "dot-notation": "error",
            "eqeqeq":"error",
            "grouped-accessor-pairs":"error",
            "no-alert":"error",
            "no-caller":"error",
            "no-constructor-return":"error",
            "no-div-regex":"error",
            "no-else-return":"error",
            "no-eq-null":"error",
            "no-extend-native":"error",
            "no-extra-bind":"error",
            "no-extra-label":"error",
            "no-implicit-coercion":"error",
            "no-implicit-globals":"error",
            "no-implied-eval":"error",
            "no-invalid-this":"error",
            "no-iterator":"error",
            "no-labels":"error",
            "no-lone-blocks":"error",
            "no-loop-func":"error",
            "no-multi-str":"error",
            "no-new":"error",
            "no-new-func":"error",
            "no-new-wrappers":"error",
            "no-octal-escape":"error",
            "no-param-reassign":"error",
            "no-proto":"error",
            "no-return-assign":["error", "except-parens"],
            "no-script-url":"error",
            "no-self-compare":"error",
            "no-throw-literal":"error",
            "no-undefined": "error",
            "no-unmodified-loop-condition":"error",
            "no-unused-expressions":"error",
            "no-useless-call":"error",
            "no-useless-concat":"error",
            "no-useless-return":"error",
            "prefer-const":"error",
            "prefer-promise-reject-errors":"error",
            "prefer-regex-literals":"error",
            "require-await":"error",
            "yoda":"error",
            "strict":"error",
            "no-shadow":"error",
            "new-cap":"error",
            "no-lonely-if":"error",
            "no-object-constructor":"error",
            "no-unneeded-ternary":"error",
            "operator-assignment":["error", "always"],
            "prefer-exponentiation-operator":"error",
            "prefer-object-spread":"error",
            "no-useless-computed-key":"error",
            "no-useless-constructor":"error",
            "no-var":"error",
            "prefer-arrow-callback":["error", { "allowNamedFunctions": true }],
            "prefer-numeric-literals":"error",
            "prefer-spread":"error",
            "prefer-template":"error",
            "symbol-description":"error"
        }
    }
];