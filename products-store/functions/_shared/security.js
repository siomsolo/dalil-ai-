const encoder = new TextEncoder();

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (!left || !right || left.length > 4096 || right.length > 4096) return false;
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    difference |= (a[i] || 0) ^ (b[i] || 0);
  }
  return difference === 0;
}

export function isSameOriginMutation(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function adminAuthorized(request, env) {
  return constantTimeEqual(request.headers.get("x-admin-token") || "", env.ADMIN_PASSWORD || "");
}

export function cronAuthorized(request, env) {
  return constantTimeEqual(request.headers.get("x-factory-cron") || "", env.FACTORY_CRON_SECRET || "");
}

export function mutationGuard(request) {
  return isSameOriginMutation(request)
    ? null
    : Response.json({ error: "Cross-origin request rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
