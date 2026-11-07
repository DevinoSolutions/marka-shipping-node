/**
 * Marka Shipping: every Marka carrier SDK in one package.
 *
 * Each carrier is also published on its own (for example `@joinmarka/canada-post`). This package
 * re-exports them: carrier namespaces (`canadaPost`) plus, for convenience, the Canada Post API at
 * the top level.
 *
 * @packageDocumentation
 */
export * as canadaPost from "@joinmarka/canada-post";
export * from "@joinmarka/canada-post";
