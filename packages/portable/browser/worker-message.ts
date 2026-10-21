/** A separate MessageChannel per request prevents cross-talk between callers. */
export function requestWorkerAcknowledgement(
  worker: Pick<ServiceWorker, 'postMessage'>,
  message: unknown,
  options: { timeoutMs?: number; timeoutMessage?: string; failureMessage?: string } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error(options.timeoutMessage ?? 'Worker response timed out.'));
    }, options.timeoutMs ?? 4000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.ok) resolve();
      else reject(new Error(options.failureMessage ?? 'Worker rejected the request.'));
    };
    try { worker.postMessage(message, [channel.port2]); }
    catch (error) { clearTimeout(timer); channel.port1.close(); channel.port2.close(); reject(error); }
  });
}
