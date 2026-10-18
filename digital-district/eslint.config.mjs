import next from "eslint-config-next";

const config = [
  ...next,
  {
    rules: {
      // API downloads (CSV exports, files) must be plain links, not client-side navigation.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  { ignores: [".next/**", "node_modules/**", "storage/**", "storage-test/**", "playwright-report/**", "test-results/**", "*.tmp.*"] },
];

export default config;
