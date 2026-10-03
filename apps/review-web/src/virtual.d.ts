// The plugin's virtual modules, as the server entry uses them.
declare module "virtual:solid-server-function-manifest" {}
declare module "virtual:solid-server-function-handler" {
  export function handleServerFunctionRequest(request: Request, options?: Record<string, unknown>): Promise<Response>;
}
