/**
 * `@postgear/scheduling`: the contract between the API and the worker.
 *
 * The API starts, signals and cancels workflows; the worker runs them. Neither
 * imports the other, so everything they must agree on lives here: workflow and
 * signal names, how a workflow id is derived from a row id, the retry policy
 * (which the worker enforces and the API only describes), and the shape of the
 * publish status the worker writes into `Post.error` for the UI to read.
 *
 * Deliberately **pure**: no Temporal import, no Prisma, no Node built-ins. The
 * worker's workflow code is bundled into a sandbox that allows none of those,
 * and keeping this package free of them is what lets a workflow import it.
 */
export * from './automations';
export * from './publish-status';
export * from './retry-policy';
export * from './workflows';
