import 'dotenv/config';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { buildApp } from './app.js';

// Enable HTTP proxy for outgoing fetch (Google OAuth needs proxy in China)
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Server running at http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
