import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Convenção do projeto: parâmetros não usados (ex: `formData` em
      // server actions vinculadas via `.bind(null, id)`) são prefixados
      // com `_` em vez de suprimidos individualmente.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // .claude/worktrees/** are separate nested git checkouts (each with its
    // own tsconfig/source tree) used for isolated feature work — linting
    // them from the main repo root double-scans the same files under a
    // different working directory and produces spurious parser errors.
    ".claude/**",
    // Pastas soltas, não relacionadas ao app (mesmo motivo do exclude do
    // tsconfig.json) — repos de referência externos que acabaram na raiz
    // do projeto, nunca fizeram parte do código do Puzzle Records.
    "Agent-Skills-for-Context-Engineering/**",
    "claude-remotion-skill/**",
    "marketingskills/**",
  ]),
]);

export default eslintConfig;
