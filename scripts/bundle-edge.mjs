import { build } from 'esbuild';

// A single-file artifact for the Supabase dashboard, built from tested source.
await build({
  entryPoints: ['supabase/functions/forge-api/index.ts'],
  outfile: 'outputs/forge-api/index.ts',
  bundle: true, minify: true, platform: 'neutral', format: 'esm', target: 'es2022',
  plugins: [{
    name: 'supabase-edge-imports',
    setup(builder) {
      builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'npm:@supabase/supabase-js@2.112.3', external: true }));
      builder.onResolve({ filter: /^jsr:.*edge-runtime\.d\.ts$/ }, () => ({ path: 'edge-types', namespace: 'empty-types' }));
      builder.onLoad({ filter: /.*/, namespace: 'empty-types' }, () => ({ contents: '' }));
    },
  }],
});
