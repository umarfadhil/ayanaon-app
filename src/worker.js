import { httpServerHandler } from "cloudflare:node";
import apiModule from "../netlify/functions/api.js";

const app = apiModule?.app;

if (!app) {
    throw new Error("Shared Express app export is unavailable");
}

app.listen(3000);

export default httpServerHandler({ port: 3000 });
