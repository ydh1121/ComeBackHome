export async function onRequest(context) {
  const service = context.env?.CBH_RUNTIME;
  if (!service || typeof service.fetch !== 'function') {
    return Response.json(
      { error: 'Backend service binding is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return service.fetch(context.request);
}
