import {
  extractBearerToken,
  verifyCustomerSessionToken,
  type CustomerSessionPayload,
} from "./customerAppSession.ts";

export async function requireCustomerSession(
  req: Request,
): Promise<CustomerSessionPayload | Response> {
  const token = extractBearerToken(req);
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const session = await verifyCustomerSessionToken(token);
  if (!session) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

export function isSessionResponse(
  value: CustomerSessionPayload | Response,
): value is Response {
  return value instanceof Response;
}
