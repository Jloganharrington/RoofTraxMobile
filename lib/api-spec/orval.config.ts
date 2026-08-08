import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
        operations: {
          // Portal endpoints live at /portal/..., not /api/portal/...
          // Use the portalFetch mutator to strip the /api prefix for these.
          getPortalContract:             { mutator: { path: path.resolve(apiClientReactSrc, "portal-fetch.ts"), name: "portalFetch" } },
          portalSelectProduct:           { mutator: { path: path.resolve(apiClientReactSrc, "portal-fetch.ts"), name: "portalFetch" } },
          getPortalContractDocument:     { mutator: { path: path.resolve(apiClientReactSrc, "portal-fetch.ts"), name: "portalFetch" } },
          portalGenerateContractDocument:{ mutator: { path: path.resolve(apiClientReactSrc, "portal-fetch.ts"), name: "portalFetch" } },
          portalSignContract:            { mutator: { path: path.resolve(apiClientReactSrc, "portal-fetch.ts"), name: "portalFetch" } },
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          // "auto" mis-detects as v4 here because api-zod/package.json
          // pins zod via the pnpm catalog (a literal "catalog:" string,
          // not a resolved semver) — force v3 explicitly to match the
          // zod@3.25.76 actually installed in this workspace.
          version: 3,
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
