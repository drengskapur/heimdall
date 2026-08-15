export function respondJson(response, content, status = 200, headers = {}) {
  const normalizedContent = typeof content === "object" ? JSON.stringify(content) : content;
  respond(response, normalizedContent, "application/json", status, headers);
}

export function respondText(response, content, status = 200, headers = {}) {
  respond(response, content, "text/plain", status, headers);
}

export function respond(response, content, contentType, status = 200, headers = {}) {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.setHeader("Content-Type", contentType);
  response.statusCode = status;
  response.end(content);
}
