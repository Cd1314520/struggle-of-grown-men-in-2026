import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["eslint.config.mjs", "node_modules/", "data/", "artifacts/", "basic-resume/", ".playwright-mcp/", ".claude/"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  { files: ["ui/**/*.tsx", "ui/**/*.ts"], ...reactHooks.configs.flat["recommended-latest"] },
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Numbers interpolate unambiguously; everything else must be converted explicitly.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // `text || fallback` deliberately treats "" as missing.
      "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
);
