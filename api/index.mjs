import server from "../server.js";

export default function handler(req, res) {
  return server.handleRequest(req, res);
}
