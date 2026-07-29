import { httpServerHandler } from "cloudflare:node";
import apiModule from "../netlify/functions/api.js";

const app = apiModule?.app;
const runWithDatabaseRequestContext = apiModule?.runWithDatabaseRequestContext;

if (!app || typeof runWithDatabaseRequestContext !== "function") {
    throw new Error("Shared Express app or request context export is unavailable");
}

app.listen(3000);

const expressWorker = httpServerHandler({ port: 3000 });

export default {
    fetch(request, env, context) {
        return runWithDatabaseRequestContext(
            () => expressWorker.fetch(request, env, context)
        );
    }
};
