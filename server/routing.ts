export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export function isKubernetesHttpPath(path: string) {
  return (
    path === "/version" ||
    path === "/openapi/v3" ||
    path.startsWith("/openapi/v3/") ||
    path.startsWith("/api/") ||
    path.startsWith("/apis/")
  );
}
export type InferParam<T extends string, PathParams extends Record<string, string>> = T extends `{${infer P}?}`
  ? PathParams & Partial<Record<P, string>>
  : T extends `{${infer P}}`
    ? PathParams & Record<P, string>
    : PathParams;
export type InferParamFromPath<P extends string> = P extends `${string}/{${infer B}*}${infer Tail}`
  ? Tail extends ""
    ? Record<B, string>
    : never
  : P extends `${infer A}/${infer B}`
    ? InferParam<A, Record<string, string> & InferParamFromPath<B>>
    : InferParam<P, {}>;
export interface LensApiRequest<Path extends string = string> {
  path: Path;
  payload: unknown;
  params: InferParamFromPath<Path>;
  cluster?: unknown;
  query: URLSearchParams;
  raw: { req: Request };
}
export interface ClusterLensApiRequest<Path extends string = string> extends LensApiRequest<Path> {
  cluster: unknown;
}
export interface LensApiResult<T> {
  statusCode?: number;
  response?: T;
  error?: unknown;
  contentType?: LensApiResultContentType;
  headers?: Record<string, string>;
  proxy?: Response;
}
export type RouteResponse<T> = LensApiResult<T> | void;
export interface RouteHandler<TResponse, Path extends string> {
  (request: LensApiRequest<Path>): RouteResponse<TResponse> | Promise<RouteResponse<TResponse>>;
}
export interface BaseRoutePaths<Path extends string> {
  path: Path;
  method: HttpMethod;
}
export interface PayloadValidator<Payload> {
  validate(payload: unknown): { value: Payload; error?: unknown };
}
export interface ValidatorBaseRoutePaths<Path extends string, Payload> extends BaseRoutePaths<Path> {
  payloadValidator: PayloadValidator<Payload>;
}
export interface Route<T = unknown, Path extends string = string> extends BaseRoutePaths<Path> {
  handler: RouteHandler<T, Path>;
}
export interface BindHandler<Path extends string> {
  <TResponse>(handler: RouteHandler<TResponse, Path>): Route<TResponse, Path>;
}
export interface LensApiResultContentType {
  resultMapper: (result: LensApiResult<unknown>) => {
    statusCode: number;
    content: unknown;
    headers: Record<string, string>;
  };
}
const resultMapperFor =
  (value: string): LensApiResultContentType["resultMapper"] =>
  ({ response, error, statusCode = error ? 400 : 200, headers = {} }) => ({
    statusCode,
    content: error ?? response,
    headers: { ...headers, "Content-Type": value },
  });
export const contentTypes = {
  json: {
    resultMapper: (result: LensApiResult<unknown>) => {
      const mapped = resultMapperFor("application/json")(result);
      return {
        ...mapped,
        content:
          typeof mapped.content === "object" && mapped.content !== null
            ? JSON.stringify(mapped.content)
            : mapped.content,
      };
    },
  },
  txt: { resultMapper: resultMapperFor("text/plain") },
  html: { resultMapper: resultMapperFor("text/html") },
  css: { resultMapper: resultMapperFor("text/css") },
  gif: { resultMapper: resultMapperFor("image/gif") },
  jpg: { resultMapper: resultMapperFor("image/jpeg") },
  png: { resultMapper: resultMapperFor("image/png") },
  svg: { resultMapper: resultMapperFor("image/svg+xml") },
  js: { resultMapper: resultMapperFor("application/javascript") },
  woff2: { resultMapper: resultMapperFor("font/woff2") },
  ttf: { resultMapper: resultMapperFor("font/ttf") },
};
export function route<Path extends string>(parts: BaseRoutePaths<Path>): BindHandler<Path> {
  return handler => ({ ...parts, handler });
}
export interface ClusterRouteHandler<ResponseType, Path extends string> {
  (request: ClusterLensApiRequest<Path>): RouteResponse<ResponseType> | Promise<RouteResponse<ResponseType>>;
}
export interface BindClusterHandler<Path extends string> {
  <TResponse>(handler: ClusterRouteHandler<TResponse, Path>): Route<TResponse, Path>;
}
export function clusterRoute<Path extends string>(parts: BaseRoutePaths<Path>): BindClusterHandler<Path> {
  return handler => ({
    ...parts,
    handler: request =>
      request.cluster ? handler(request as ClusterLensApiRequest<Path>) : { error: "Cluster missing", statusCode: 400 },
  });
}
export interface ValidatedClusterLensApiRequest<Path extends string, Payload> extends ClusterLensApiRequest<Path> {
  payload: Payload;
}
export interface ValidatedClusterRouteHandler<Payload, ResponseType, Path extends string> {
  (
    request: ValidatedClusterLensApiRequest<Path, Payload>,
  ): RouteResponse<ResponseType> | Promise<RouteResponse<ResponseType>>;
}
export interface BindValidatedClusterHandler<Path extends string, Payload> {
  <ResponseType>(handler: ValidatedClusterRouteHandler<Payload, ResponseType, Path>): Route<ResponseType, Path>;
}
export function payloadValidatedClusterRoute<Path extends string, Payload>({
  payloadValidator,
  ...parts
}: ValidatorBaseRoutePaths<Path, Payload>): BindValidatedClusterHandler<Path, Payload> {
  const bind = clusterRoute(parts);
  return handler =>
    bind(({ payload, ...rest }) => {
      const checked = payloadValidator.validate(payload);
      return checked.error ? { error: checked.error, statusCode: 400 } : handler({ ...rest, payload: checked.value });
    });
}
function match(pattern: string, path: string) {
  const expected = pattern.split("/").filter(Boolean),
    actual = path.split("/").filter(Boolean),
    params: Record<string, string | undefined> = {};
  for (let index = 0; index < expected.length; index++) {
    const part = expected[index],
      rest = part.match(/^\{(.+)\*\}$/),
      optional = part.match(/^\{(.+)\?\}$/),
      required = part.match(/^\{(.+)\}$/);
    if (rest) {
      params[rest[1]] = decodeURIComponent(actual.slice(index).join("/"));
      return params;
    }
    if (optional) {
      if (actual[index] !== undefined) params[optional[1]] = decodeURIComponent(actual[index]);
      continue;
    }
    if (required) {
      if (actual[index] === undefined) return;
      params[required[1]] = decodeURIComponent(actual[index]);
      continue;
    }
    if (part !== actual[index]) return;
  }
  return actual.length <= expected.length ? params : undefined;
}
async function payload(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("json"))
    return request
      .clone()
      .json()
      .catch(() => undefined);
  if (contentType.includes("form")) return Object.fromEntries(new URLSearchParams(await request.clone().text()));
  return request
    .clone()
    .text()
    .catch(() => undefined);
}
const specificity = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .reduce((score, part) => score + (part.startsWith("{") ? (part.includes("*") ? 0 : 1) : 10), 0);
export class Router {
  constructor(private readonly routes: Route[] = []) {
    this.routes.sort((a, b) => specificity(b.path) - specificity(a.path));
  }
  add<T, Path extends string>(entry: Route<T, Path>) {
    this.routes.push(entry as unknown as Route);
    this.routes.sort((a, b) => specificity(b.path) - specificity(a.path));
    return this;
  }
  async route(request: Request, cluster?: unknown): Promise<Response | null> {
    const url = new URL(request.url),
      method = request.method.toLowerCase();
    for (const entry of this.routes) {
      const params = entry.method === method ? match(entry.path, url.pathname) : undefined;
      if (!params) continue;
      const lensRequest: LensApiRequest = {
        path: url.pathname,
        payload: await payload(request),
        params,
        cluster,
        query: url.searchParams,
        raw: { req: request },
      };
      try {
        const result = await entry.handler(lensRequest);
        if (!result) {
          const mapped = contentTypes.txt.resultMapper({ statusCode: 204 });
          return new Response(mapped.content as BodyInit | null, {
            status: mapped.statusCode,
            headers: mapped.headers,
          });
        }
        if (result.proxy) return result.proxy;
        const mapped = (result.contentType || contentTypes.json).resultMapper(result);
        return new Response(mapped.content as BodyInit | null, { status: mapped.statusCode, headers: mapped.headers });
      } catch (error) {
        const mapped = contentTypes.txt.resultMapper({
          statusCode: 500,
          error: error ? String(error) : "unknown error",
        });
        return new Response(mapped.content as BodyInit, { status: mapped.statusCode, headers: mapped.headers });
      }
    }
    return null;
  }
}
