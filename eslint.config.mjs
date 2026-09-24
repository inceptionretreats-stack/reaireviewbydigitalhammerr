import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Review-policy guard (12_QA_Acceptance_Criteria.md AC-025).
 *
 * The product may only ever report that Google was *opened*. Claiming a review was
 * *submitted* is something the platform cannot verify and Google's fake-engagement
 * policy treats as misrepresentation, so it is a build error rather than a QA note.
 * See 13_Security_Privacy_Compliance.md rule 8 and D-028 in the Decision Log.
 */
const FORBIDDEN_SUBMISSION_CLAIM = /review\s+submitted|submitted\s+(?:your|the|a)\s+review/i;

const reviewPolicyRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `Literal[value=${FORBIDDEN_SUBMISSION_CLAIM}]`,
      message:
        'AC-025: never claim a review was submitted — the platform only knows Google was opened. Use "Google review page opened".',
    },
    {
      selector: `TemplateElement[value.raw=${FORBIDDEN_SUBMISSION_CLAIM}]`,
      message:
        'AC-025: never claim a review was submitted — the platform only knows Google was opened. Use "Google review page opened".',
    },
    {
      selector: `JSXText[value=${FORBIDDEN_SUBMISSION_CLAIM}]`,
      message:
        'AC-025: never claim a review was submitted — the platform only knows Google was opened. Use "Google review page opened".',
    },
  ],
};

export default tseslint.config(
  {
    // tmp/ is gitignored scratch work and .agents/ is vendored third-party skill material:
    // neither is ours to lint, and 262 no-undef errors there kept the gate permanently red,
    // which is how an unformatted route reached main unnoticed.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/drizzle/**',
      'tmp/**',
      '.agents/**',
      '.dev/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      ...reviewPolicyRules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Build and CI scripts are Node programs: they legitimately use console and process, and
    // reporting to stdout is their entire purpose.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
);
