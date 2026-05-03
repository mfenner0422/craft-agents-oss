interface RpcResult<T> {
  result?: T;
  error?: { message?: string };
}

export async function rpcCall<T>(channel: string, ...args: unknown[]): Promise<T> {
  const rpcPort = process.env.CRAFT_RPC_PORT ?? '48211';
  const url = process.env.CRAFT_SERVER_URL ?? `ws://127.0.0.1:${rpcPort}`;
  const token = process.env.CRAFT_SERVER_TOKEN;
  const workspaceId = process.env.CRAFT_WORKSPACE_ID ?? 'ws_rockyii';
  if (!token) throw new Error('CRAFT_SERVER_TOKEN is not set');

  const ws = new WebSocket(url);
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`RPC timeout: ${channel}`));
    }, 30_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        type: 'handshake',
        protocolVersion: '1.0',
        workspaceId,
        token,
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type: string;
        id?: string;
        result?: unknown;
        error?: { message?: string };
      };

      if (message.type === 'handshake_ack') {
        const id = crypto.randomUUID();
        pending.set(id, {
          resolve(value) {
            clearTimeout(timeout);
            ws.close();
            resolve(value as T);
          },
          reject(error) {
            clearTimeout(timeout);
            ws.close();
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, type: 'request', channel, args }));
        return;
      }

      if (message.type === 'error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(message.error?.message ?? 'RPC handshake failed'));
        return;
      }

      if (message.type === 'response' && message.id) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        const response = message as RpcResult<T>;
        if (response.error) {
          entry.reject(new Error(response.error.message ?? `RPC failed: ${channel}`));
        } else {
          entry.resolve(response.result);
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`RPC connection failed: ${url}`));
    };
  });
}
