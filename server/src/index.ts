import { app } from './app';
import { env } from './config/env';
import { configuredProviders } from './lib/oauth/providers';

// Without a provider there is no way to sign in at all, and the failure would
// only surface when the first person tried. Fail at boot instead.
if (configuredProviders().length === 0) {
  throw new Error(
    'No OAuth provider configured. Set GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET.',
  );
}

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});
